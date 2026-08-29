/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import {
  AppFunctionDefinition,
  AppFunctionExecutionOptions,
  AppFunctionExecutionResult,
} from '../types/appfunctions';
import { ShellResult } from '../types/adb';
import { escapeShellArg, sanitizeJsonForShell } from '../utils/sanitize';
import { stripAnsiCodes } from './parser';
import { logger } from '../utils/logger';

const DEFAULT_EXECUTION_TIMEOUT_MS = 10000;

/**
 * Custom error class representing an AppFunction execution error.
 */
export class AppFunctionExecutionError extends Error {
  readonly packageName?: string;
  readonly functionId?: string;
  readonly rawOutput?: string;
  readonly originalError?: unknown;

  constructor(
    message: string,
    options?: {
      packageName?: string;
      functionId?: string;
      rawOutput?: string;
      originalError?: unknown;
    }
  ) {
    super(message);
    this.name = 'AppFunctionExecutionError';
    this.packageName = options?.packageName;
    this.functionId = options?.functionId;
    this.rawOutput = options?.rawOutput;
    this.originalError = options?.originalError;
  }
}

/**
 * Result of parsing raw execution CLI output.
 */
export interface ParsedExecutionOutput {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Recursively unwraps single-element arrays from properties in execution result objects,
 * while preserving multi-element arrays.
 *
 * @param payload Raw payload to unwrap.
 * @returns Unwrapped data structure.
 */
export function unwrapExecutionPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => unwrapExecutionPayload(item));
  }

  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        if (value.length === 1 && (typeof value[0] !== 'object' || value[0] === null)) {
          result[key] = value[0];
        } else if (value.length === 1 && typeof value[0] === 'object' && !Array.isArray(value[0])) {
          result[key] = unwrapExecutionPayload(value[0]);
        } else {
          result[key] = value.map((v) => unwrapExecutionPayload(v));
        }
      } else if (typeof value === 'object' && value !== null) {
        result[key] = unwrapExecutionPayload(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  return payload;
}

/**
 * Parses raw CLI output or JSON response from `cmd app_function execute-app-function`
 * into a structured success/data or error result.
 *
 * @param rawOutput Raw stdout/stderr string from the Android device.
 * @returns Structured ParsedExecutionOutput.
 */
export function parseExecutionOutput(rawOutput: string): ParsedExecutionOutput {
  if (!rawOutput) {
    return { success: true, data: null };
  }

  const cleaned = stripAnsiCodes(rawOutput).trim();
  if (!cleaned) {
    return { success: true, data: null };
  }

  const lower = cleaned.toLowerCase();

  // Check for common CLI error prefixes and runtime exceptions
  const isExplicitError =
    cleaned.startsWith('Error:') ||
    cleaned.startsWith('Exception:') ||
    cleaned.startsWith('java.lang.') ||
    cleaned.startsWith('android.os.') ||
    cleaned.startsWith('Unknown command:') ||
    cleaned.startsWith("cmd: Can't find service") ||
    lower.includes('securityexception') ||
    lower.includes('nullpointerexception') ||
    lower.includes('illegalargumentexception');

  if (isExplicitError) {
    return {
      success: false,
      error: cleaned,
    };
  }

  // Attempt direct JSON parse
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    // Scan for potential JSON boundaries: '{' or '['
    for (let i = 0; i < cleaned.length; i++) {
      const startChar = cleaned[i];
      if (startChar === '{' || startChar === '[') {
        const endChar = startChar === '{' ? '}' : ']';
        let endIdx = cleaned.lastIndexOf(endChar);
        while (endIdx > i) {
          const candidate = cleaned.slice(i, endIdx + 1);
          try {
            parsedJson = JSON.parse(candidate);
            break;
          } catch {
            endIdx = cleaned.lastIndexOf(endChar, endIdx - 1);
          }
        }
        if (parsedJson !== undefined) {
          break;
        }
      }
    }
  }

  if (parsedJson !== undefined) {
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      !Array.isArray(parsedJson)
    ) {
      const obj = parsedJson as Record<string, unknown>;

      // Check for explicit failure flags
      if (obj.success === false) {
        const errorMsg =
          typeof obj.error === 'string'
            ? obj.error
            : typeof obj.errorMessage === 'string'
              ? obj.errorMessage
              : typeof obj.message === 'string'
                ? obj.message
                : JSON.stringify(obj);
        return { success: false, error: errorMsg, data: obj };
      }

      // Check for status indicating error
      if (
        typeof obj.status === 'string' &&
        (obj.status.toUpperCase() === 'ERROR' ||
          obj.status.toUpperCase() === 'FAILED')
      ) {
        const errorMsg =
          typeof obj.message === 'string'
            ? obj.message
            : typeof obj.error === 'string'
              ? obj.error
              : typeof obj.errorMessage === 'string'
                ? obj.errorMessage
                : JSON.stringify(obj);
        return { success: false, error: errorMsg, data: obj };
      }

      // Check for error/errorMessage property without success: true
      if (
        (obj.error !== undefined || obj.errorMessage !== undefined) &&
        obj.success !== true
      ) {
        const errorMsg =
          typeof obj.error === 'string'
            ? obj.error
            : typeof obj.errorMessage === 'string'
              ? obj.errorMessage
              : String(obj.error ?? obj.errorMessage);
        return { success: false, error: errorMsg, data: obj };
      }

      // Check for androidAppfunctionsReturnValue property (Android 16 AppFunctions execution format)
      if (obj.androidAppfunctionsReturnValue !== undefined) {
        const rawReturn = obj.androidAppfunctionsReturnValue;
        if (Array.isArray(rawReturn)) {
          if (
            rawReturn.length === 1 &&
            typeof rawReturn[0] === 'object' &&
            rawReturn[0] !== null &&
            !Array.isArray(rawReturn[0])
          ) {
            return {
              success: true,
              data: unwrapExecutionPayload(rawReturn[0]),
            };
          }
          if (
            rawReturn.length === 1 &&
            (typeof rawReturn[0] !== 'object' || rawReturn[0] === null)
          ) {
            return { success: true, data: rawReturn[0] };
          }
          return { success: true, data: unwrapExecutionPayload(rawReturn) };
        }
        return { success: true, data: unwrapExecutionPayload(rawReturn) };
      }

      // Return result field if present, otherwise the entire object
      const resultData = obj.result !== undefined ? obj.result : obj;
      return { success: true, data: unwrapExecutionPayload(resultData) };
    }

    // Primitives or arrays
    return { success: true, data: unwrapExecutionPayload(parsedJson) };
  }

  // Non-JSON plain text handling
  if (
    lower.includes('failed') ||
    lower.includes('error') ||
    lower.includes('exception')
  ) {
    return {
      success: false,
      error: cleaned,
    };
  }

  return {
    success: true,
    data: cleaned,
  };
}

/**
 * Options for configuring an AppFunctionsExecutor instance.
 */
export interface AppFunctionsExecutorOptions {
  /**
   * Default timeout in milliseconds for command execution (default: 10000ms).
   */
  defaultTimeoutMs?: number;
}

/**
 * Execution engine that formats, sanitizes, and dispatches AppFunction calls
 * over ADB shell to connected Android 16+ devices.
 */
export class AppFunctionsExecutor {
  private adbManager: AdbManager;
  private defaultTimeoutMs: number;

  constructor(
    adbManager: AdbManager,
    options: AppFunctionsExecutorOptions = {}
  ) {
    this.adbManager = adbManager;
    this.defaultTimeoutMs =
      options.defaultTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  /**
   * Returns the underlying AdbManager instance.
   */
  getAdbManager(): AdbManager {
    return this.adbManager;
  }

  /**
   * Constructs the shell command to execute an AppFunction.
   *
   * @param packageName Target Android package name.
   * @param functionId Target function identifier (e.g. 'NotesService#createNote').
   * @param parameters Function arguments (object, array, primitive, or JSON string).
   * @returns Formatted and sanitized shell command string.
   */
  static buildCommand(
    packageName: string,
    functionId: string,
    parameters?: unknown
  ): string {
    const trimmedPkg = packageName?.trim();
    if (!trimmedPkg) {
      throw new Error('Package name is required to execute an AppFunction.');
    }

    const trimmedFunc = functionId?.trim();
    if (!trimmedFunc) {
      throw new Error(
        'Function identifier is required to execute an AppFunction.'
      );
    }

    const sanitizedParams = sanitizeJsonForShell(parameters);

    return `cmd app_function execute-app-function --package ${escapeShellArg(
      trimmedPkg
    )} --function ${escapeShellArg(trimmedFunc)} --parameters ${sanitizedParams}`;
  }

  /**
   * Constructs the shell command to enable, disable, or reset an AppFunction's state.
   *
   * @param packageName Target Android package name.
   * @param functionId Target function identifier.
   * @param state Target state ('enable', 'disable', or 'default').
   * @returns Formatted and sanitized shell command string.
   */
  static buildSetEnabledCommand(
    packageName: string,
    functionId: string,
    state: 'enable' | 'disable' | 'default'
  ): string {
    const trimmedPkg = packageName?.trim();
    if (!trimmedPkg) {
      throw new Error(
        'Package name is required to configure AppFunction state.'
      );
    }

    const trimmedFunc = functionId?.trim();
    if (!trimmedFunc) {
      throw new Error(
        'Function identifier is required to configure AppFunction state.'
      );
    }

    return `cmd app_function set-enabled --package ${escapeShellArg(
      trimmedPkg
    )} --function ${escapeShellArg(trimmedFunc)} --state ${escapeShellArg(
      state
    )}`;
  }

  /**
   * Dispatches and executes an AppFunction on the connected Android device.
   *
   * @param packageName Target Android package name (e.g. 'com.example.notes').
   * @param functionId Target function identifier (e.g. 'NotesService#createNote').
   * @param parameters Function arguments.
   * @param options Execution options (timeoutMs, signal).
   * @returns Structured AppFunctionExecutionResult.
   */
  async execute<T = unknown>(
    packageName: string,
    functionId: string,
    parameters?: unknown,
    options: AppFunctionExecutionOptions = {}
  ): Promise<AppFunctionExecutionResult<T>> {
    if (!this.adbManager.isConnected()) {
      throw new AppFunctionExecutionError(
        `Cannot execute AppFunction '${functionId}': ADB connection is not ready (current state: ${this.adbManager.getState()}).`,
        { packageName, functionId }
      );
    }

    const command = AppFunctionsExecutor.buildCommand(
      packageName,
      functionId,
      parameters
    );

    logger.info(
      'EXEC',
      `Executing AppFunction '${functionId}' on package '${packageName}'...`
    );

    const startTime = Date.now();

    try {
      const shellResult = await this.adbManager.execShell(command, {
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        signal: options.signal,
      });

      const executionTimeMs = Date.now() - startTime;

      if (shellResult.exitCode !== 0 && shellResult.stderr) {
        const stderr = shellResult.stderr.trim();
        let errorMsg = `Failed to execute AppFunction '${functionId}': ${stderr}`;

        if (stderr.includes('SecurityException')) {
          errorMsg = `Permission denied executing AppFunction '${functionId}' on package '${packageName}': ${stderr}`;
        } else if (
          stderr.includes('Unknown command') ||
          stderr.includes('not found') ||
          stderr.includes("Can't find service")
        ) {
          errorMsg = `AppFunctions service error on Android device: ${stderr}`;
        }

        logger.error('EXEC', errorMsg, shellResult.stderr, executionTimeMs);

        return {
          success: false,
          error: errorMsg,
          executionTimeMs,
          rawOutput: shellResult.raw,
        };
      }

      const outputToParse = shellResult.stdout || shellResult.raw;
      const parsed = parseExecutionOutput(outputToParse);

      if (!parsed.success) {
        logger.warn(
          'EXEC',
          `AppFunction '${functionId}' execution returned an error: ${parsed.error}`,
          parsed.error,
          executionTimeMs
        );
        return {
          success: false,
          error: parsed.error,
          data: parsed.data as T,
          executionTimeMs,
          rawOutput: shellResult.raw,
        };
      }

      logger.info(
        'EXEC',
        `AppFunction '${functionId}' executed successfully in ${executionTimeMs}ms.`,
        parsed.data,
        executionTimeMs
      );

      return {
        success: true,
        data: parsed.data as T,
        executionTimeMs,
        rawOutput: shellResult.raw,
      };
    } catch (err) {
      const executionTimeMs = Date.now() - startTime;
      logger.error('EXEC', `Execution failed for '${functionId}':`, err, executionTimeMs);
      throw err;
    }
  }

  /**
   * Convenience method to execute an AppFunction given its AppFunctionDefinition.
   *
   * @param def Discovered AppFunctionDefinition.
   * @param parameters Function arguments.
   * @param options Execution options.
   * @returns Structured AppFunctionExecutionResult.
   */
  async executeFunction<T = unknown>(
    def: AppFunctionDefinition,
    parameters?: unknown,
    options: AppFunctionExecutionOptions = {}
  ): Promise<AppFunctionExecutionResult<T>> {
    return this.execute<T>(
      def.packageName,
      def.functionId,
      parameters,
      options
    );
  }

  /**
   * Sets the enabled state of an AppFunction on the connected Android device.
   *
   * @param packageName Target Android package name.
   * @param functionId Target function identifier.
   * @param state State to apply ('enable', 'disable', or 'default').
   * @param options Execution options.
   * @returns ShellResult from the command.
   */
  async setEnabled(
    packageName: string,
    functionId: string,
    state: 'enable' | 'disable' | 'default',
    options: AppFunctionExecutionOptions = {}
  ): Promise<ShellResult> {
    if (!this.adbManager.isConnected()) {
      throw new AppFunctionExecutionError(
        `Cannot configure AppFunction state: ADB connection is not ready (current state: ${this.adbManager.getState()}).`,
        { packageName, functionId }
      );
    }

    const command = AppFunctionsExecutor.buildSetEnabledCommand(
      packageName,
      functionId,
      state
    );

    return this.adbManager.execShell(command, {
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      signal: options.signal,
    });
  }

  /**
   * Sets the enabled state of an AppFunction given its AppFunctionDefinition.
   *
   * @param def AppFunctionDefinition.
   * @param state State to apply ('enable', 'disable', or 'default').
   * @param options Execution options.
   * @returns ShellResult from the command.
   */
  async setFunctionEnabled(
    def: AppFunctionDefinition,
    state: 'enable' | 'disable' | 'default',
    options: AppFunctionExecutionOptions = {}
  ): Promise<ShellResult> {
    return this.setEnabled(def.packageName, def.functionId, state, options);
  }

  /**
   * Creates a WebMCP-compliant ToolExecuteCallback that invokes this executor.
   *
   * @param def Discovered AppFunctionDefinition.
   * @param defaultOptions Execution options (e.g. timeoutMs).
   * @returns WebMCP.ToolExecuteCallback function.
   */
  createToolExecuteHandler(
    def: AppFunctionDefinition,
    defaultOptions?: AppFunctionExecutionOptions
  ): WebMCP.ToolExecuteCallback;

  /**
   * Creates a WebMCP-compliant ToolExecuteCallback for the given package and function.
   *
   * @param packageName Android package name.
   * @param functionId AppFunction identifier.
   * @param defaultOptions Execution options.
   * @returns WebMCP.ToolExecuteCallback function.
   */
  createToolExecuteHandler(
    packageName: string,
    functionId: string,
    defaultOptions?: AppFunctionExecutionOptions
  ): WebMCP.ToolExecuteCallback;

  createToolExecuteHandler(
    defOrPackage: AppFunctionDefinition | string,
    functionIdOrOptions?: string | AppFunctionExecutionOptions,
    defaultOptions?: AppFunctionExecutionOptions
  ): WebMCP.ToolExecuteCallback {
    let packageName: string;
    let functionId: string;
    let baseOptions: AppFunctionExecutionOptions | undefined;

    if (typeof defOrPackage === 'object' && defOrPackage !== null) {
      packageName = defOrPackage.packageName;
      functionId = defOrPackage.functionId;
      baseOptions =
        typeof functionIdOrOptions === 'object'
          ? functionIdOrOptions
          : defaultOptions;
    } else {
      packageName = defOrPackage;
      functionId =
        typeof functionIdOrOptions === 'string' ? functionIdOrOptions : '';
      baseOptions = defaultOptions;
    }

    return async (
      inputObject: Record<string, unknown>,
      options: WebMCP.ToolExecuteCallbackOptions
    ): Promise<unknown> => {
      const result = await this.execute(packageName, functionId, inputObject, {
        signal: options?.signal ?? baseOptions?.signal,
        timeoutMs: baseOptions?.timeoutMs ?? this.defaultTimeoutMs,
      });

      if (!result.success) {
        throw new AppFunctionExecutionError(
          result.error ||
            `AppFunction '${functionId}' execution failed on package '${packageName}'.`,
          {
            packageName,
            functionId,
            rawOutput: result.rawOutput,
          }
        );
      }

      return result.data !== undefined ? result.data : { success: true };
    };
  }
}
