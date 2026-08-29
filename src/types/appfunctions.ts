/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supported primitive and structural data types for Android AppFunctions.
 */
export type AppFunctionDataType =
  | 'string'
  | 'int'
  | 'long'
  | 'float'
  | 'double'
  | 'boolean'
  | 'bytes'
  | 'array'
  | 'object'
  | 'unit'
  | 'unknown';

/**
 * Parameter definition for an AppFunction.
 */
export interface AppFunctionParameter {
  /**
   * Name of the parameter (e.g. 'title', 'query', 'noteId').
   */
  name: string;

  /**
   * Normalized data type of the parameter.
   */
  dataType: AppFunctionDataType;

  /**
   * Original raw type string from Android schema (e.g. 'java.lang.String', 'List<Int>').
   */
  rawType?: string;

  /**
   * Documentation / description of what this parameter represents.
   */
  description?: string;

  /**
   * Whether this parameter is required for invocation.
   */
  isRequired: boolean;

  /**
   * Default value if the parameter is optional.
   */
  defaultValue?: unknown;

  /**
   * Schema descriptor for array items (if dataType is 'array').
   */
  items?: AppFunctionParameter;

  /**
   * Map of child properties (if dataType is 'object').
   */
  properties?: Record<string, AppFunctionParameter>;
}

/**
 * Response/return type specification for an AppFunction.
 */
export interface AppFunctionResponse {
  /**
   * Normalized data type of the return value.
   */
  dataType: AppFunctionDataType;

  /**
   * Original raw return type string from Android schema.
   */
  rawType?: string;

  /**
   * Documentation / description of the response payload.
   */
  description?: string;

  /**
   * Schema descriptor for array response items.
   */
  items?: AppFunctionParameter;

  /**
   * Map of child properties for structured object responses.
   */
  properties?: Record<string, AppFunctionParameter>;
}

/**
 * Complete metadata and schema definition for an on-device Android AppFunction.
 */
export interface AppFunctionDefinition {
  /**
   * Target Android package name (e.g. 'com.example.notes').
   */
  packageName: string;

  /**
   * Unique function identifier (typically 'ClassName#MethodName' or 'functionId').
   */
  functionId: string;

  /**
   * Extracted or explicit service/class name.
   */
  className?: string;

  /**
   * Extracted or explicit method/action name.
   */
  methodName?: string;

  /**
   * KDoc or developer description of what the function does.
   */
  description?: string;

  /**
   * List of parameter definitions accepted by this function.
   */
  parameters: AppFunctionParameter[];

  /**
   * Return/response type specification.
   */
  response?: AppFunctionResponse;

  /**
   * Whether the function is currently enabled on the device.
   */
  enabled?: boolean;

  /**
   * Raw JSON representation from Android CLI.
   */
  rawJson?: unknown;
}

/**
 * Options for discovering AppFunctions on an Android device.
 */
export interface DiscoveryOptions {
  /**
   * Optional package name to filter discovery (e.g. 'com.example.notes').
   * If provided, executes `cmd app_function list-app-functions --package <pkg>`.
   */
  packageName?: string;

  /**
   * Timeout in milliseconds for discovery command execution (default: 10000ms).
   */
  timeoutMs?: number;

  /**
   * Optional AbortSignal to cancel discovery.
   */
  signal?: AbortSignal;
}

/**
 * Discovery result containing discovered functions and metadata.
 */
export interface DiscoveryResult {
  /**
   * List of discovered AppFunctions.
   */
  functions: AppFunctionDefinition[];

  /**
   * Total number of functions discovered.
   */
  totalCount: number;

  /**
   * Number of unique packages discovered.
   */
  packageCount: number;

  /**
   * Array of unique package names providing AppFunctions.
   */
  packages: string[];

  /**
   * Time taken to discover and parse in milliseconds.
   */
  executionTimeMs: number;

  /**
   * Raw shell output emitted by the Android device.
   */
  rawOutput?: string;
}

/**
 * Options for executing an AppFunction on an Android device.
 */
export interface AppFunctionExecutionOptions {
  /**
   * Execution timeout in milliseconds (default: 10000ms).
   */
  timeoutMs?: number;

  /**
   * Optional AbortSignal to cancel command execution.
   */
  signal?: AbortSignal;
}

/**
 * Execution result returned from an AppFunction invocation.
 */
export interface AppFunctionExecutionResult<T = unknown> {
  /**
   * Whether the AppFunction execution succeeded.
   */
  success: boolean;

  /**
   * Parsed data returned by the AppFunction if successful.
   */
  data?: T;

  /**
   * Error message if execution failed.
   */
  error?: string;

  /**
   * Time taken for execution in milliseconds.
   */
  executionTimeMs: number;

  /**
   * Raw stdout/output string from the Android device.
   */
  rawOutput?: string;
}

