/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppFunctionDataType,
  AppFunctionDefinition,
  AppFunctionParameter,
  AppFunctionResponse,
} from '../types/appfunctions';

/**
 * Standard JSON Schema property descriptor for WebMCP tool input parameters.
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  format?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

/**
 * Standard root JSON Schema object for WebMCP tool inputSchema.
 */
export interface WebMcpToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
}

/**
 * Parsed components of an Android WebMCP tool name.
 */
export interface ParsedToolName {
  /**
   * Whether the tool name conforms to the Android WebMCP naming convention.
   */
  isAndroidTool: boolean;

  /**
   * Android package name extracted from the tool name.
   */
  packageName: string;

  /**
   * Function identifier or method name extracted from the tool name.
   */
  functionId: string;

  /**
   * Extracted class name if available.
   */
  className?: string;

  /**
   * Extracted method name if available.
   */
  methodName?: string;
}

/**
 * Options for mapping an AppFunctionDefinition into a WebMCP ModelContextTool.
 */
export interface MapToolOptions {
  /**
   * The tool execution callback to invoke when an AI agent calls the tool.
   */
  execute?: WebMCP.ToolExecuteCallback;

  /**
   * Prefix for the generated WebMCP tool name (default: 'android__').
   */
  prefix?: string;

  /**
   * WebMCP metadata annotations (e.g. readOnlyHint, untrustedContentHint).
   */
  annotations?: WebMCP.ToolAnnotations;

  /**
   * Human-readable title override.
   */
  title?: string;

  /**
   * Description override.
   */
  description?: string;
}

/**
 * Regular expression validating WebMCP and agent-compatible tool name constraints:
 * 1-128 characters, ASCII alphanumeric, '_', '.', ':', or '-', and MUST start with a letter or underscore.
 */
export const WEBMCP_TOOL_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/;

/**
 * Default tool name prefix for Android AppFunctions exposed via WebMCP.
 */
export const DEFAULT_TOOL_PREFIX = 'android__';

/**
 * Maximum character length allowed for WebMCP tool names.
 * Capped at 64 characters to guarantee full compatibility with agent prefixes (e.g. '_0_')
 * and universal support across Gemini (128 chars), OpenAI (64 chars), and Anthropic (64 chars).
 */
export const MAX_TOOL_NAME_LENGTH = 64;

/**
 * Validates whether a string satisfies WebMCP and AI agent tool naming constraints.
 *
 * @param name Candidate tool name string.
 * @returns True if valid, false otherwise.
 */
export function isValidToolName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_TOOL_NAME_LENGTH) {
    return false;
  }
  return WEBMCP_TOOL_NAME_REGEX.test(name);
}

/**
 * Sanitizes an arbitrary identifier string (package name, class name, method name)
 * into safe characters: ASCII alphanumeric and underscores.
 *
 * @param str Input string.
 * @returns Sanitized string containing only `[a-zA-Z0-9_]`.
 */
export function sanitizeIdentifier(str: string): string {
  if (!str) {
    return '';
  }
  // Replace non-alphanumeric characters (dots, dashes, hashes, slashes, spaces) with '_'
  const sanitized = str.replace(/[^a-zA-Z0-9]/g, '_');
  // Collapse multiple consecutive underscores into a single underscore
  return sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Extracts a concise, meaningful package segment (e.g. 'nexuslauncher' from 'com.google.android.apps.nexuslauncher')
 * for use when tool names would otherwise exceed agent naming constraints.
 *
 * @param pkg Android package name.
 * @returns Shortened package identifier.
 */
export function shortenPackageName(pkg: string): string {
  if (!pkg) {
    return '';
  }

  const parts = pkg.split('.').filter(Boolean);
  if (parts.length <= 1) {
    return sanitizeIdentifier(pkg);
  }

  // Common generic package prefixes to ignore
  const ignoredPrefixes = new Set(['com', 'org', 'net', 'io', 'me', 'android', 'google', 'apps', 'app']);

  // Find the last meaningful segments
  const meaningful = parts.filter((part) => !ignoredPrefixes.has(part.toLowerCase()));
  if (meaningful.length > 0) {
    // If multiple meaningful parts, join up to the last 2
    return sanitizeIdentifier(meaningful.slice(-2).join('_'));
  }

  // Fallback to the last segment
  return sanitizeIdentifier(parts[parts.length - 1]);
}

/**
 * Extracts clean simple class and method names from functionId and/or className/methodName.
 *
 * @param functionId Raw function identifier string.
 * @param explicitClass Optional explicit class name.
 * @param explicitMethod Optional explicit method name.
 * @returns Object with simple className and clean methodName.
 */
export function extractCleanComponents(
  functionId?: string,
  explicitClass?: string,
  explicitMethod?: string
): { className?: string; methodName: string } {
  let rawClass = explicitClass;
  let rawMethod = explicitMethod;

  let cleanId = functionId ? functionId.trim() : '';

  // Strip AppFunction metadata prefixes
  if (cleanId.startsWith('AppFunctionStaticMetadata-') || cleanId.startsWith('AppFunctionRuntimeMetadata-')) {
    const hashIdx = cleanId.indexOf('#');
    if (hashIdx !== -1) {
      cleanId = cleanId.slice(hashIdx + 1);
    }
  }

  if (cleanId.includes('#')) {
    const parts = cleanId.split('#');
    if (!rawClass && parts[0]) {
      rawClass = parts[0];
    }
    if (!rawMethod && parts[1]) {
      rawMethod = parts[1];
    }
  } else if (!rawMethod && cleanId) {
    if (cleanId.includes('.')) {
      const parts = cleanId.split('.');
      rawMethod = parts.pop()!;
      if (!rawClass && parts.length > 0) {
        rawClass = parts.join('.');
      }
    } else {
      rawMethod = cleanId;
    }
  }

  // Extract simple class name (part after the last dot)
  let simpleClass: string | undefined;
  if (rawClass && rawClass.trim()) {
    const trimmed = rawClass.trim();
    simpleClass = trimmed.includes('.') ? trimmed.split('.').pop()!.trim() : trimmed;
  }

  // Extract clean method name
  let methodName = rawMethod && rawMethod.trim() ? rawMethod.trim() : 'tool';
  if (methodName.includes('#')) {
    methodName = methodName.split('#').pop()!.trim();
  }
  if (methodName.includes('.')) {
    methodName = methodName.split('.').pop()!.trim();
  }

  return {
    className: simpleClass,
    methodName: methodName || 'tool',
  };
}

/**
 * Sanitizes an entire tool name to guarantee full compliance with WebMCP and AI agent naming rules
 * (1-64 characters, starts with a-z/A-Z/_, contains only ASCII alphanumeric, '_', '.', ':', or '-').
 *
 * @param rawName Raw candidate tool name.
 * @param fallback Fallback name if the raw name cannot produce valid characters.
 * @returns Sanitized valid WebMCP tool name.
 */
export function sanitizeToolName(rawName: string, fallback = 'android__tool'): string {
  if (!rawName || typeof rawName !== 'string') {
    return fallback;
  }

  // Replace any character not in [a-zA-Z0-9_.-] with '_'
  let cleaned = rawName.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Collapse consecutive underscores while preserving double underscore namespace separators '__'
  cleaned = cleaned.replace(/_{3,}/g, '__');

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    return fallback;
  }

  // Ensure tool name starts with a letter or underscore [a-zA-Z_]
  if (/^[0-9]/.test(cleaned)) {
    cleaned = `_${cleaned}`;
  } else if (/^[.-]/.test(cleaned)) {
    cleaned = cleaned.replace(/^[.-]+/, '_');
  }

  if (!/^[a-zA-Z_]/.test(cleaned)) {
    cleaned = `_${cleaned.replace(/^[^a-zA-Z0-9_]+/, '')}`;
  }

  if (cleaned.length === 0 || cleaned === '_') {
    return fallback;
  }

  // Truncate to maximum allowed length (64 characters)
  if (cleaned.length > MAX_TOOL_NAME_LENGTH) {
    cleaned = cleaned.slice(0, MAX_TOOL_NAME_LENGTH);
  }

  return cleaned;
}

/**
 * Formats a standardized WebMCP tool name from an AppFunctionDefinition or package and function ID.
 * Follows the naming pattern: `android__<package_name>__<function_name>`.
 *
 * @param def An AppFunctionDefinition object.
 * @param prefix Optional custom prefix (defaults to 'android__').
 * @returns Standardized, sanitized WebMCP tool name.
 */
export function formatToolName(def: AppFunctionDefinition, prefix?: string): string;

/**
 * Formats a standardized WebMCP tool name from package name and function ID.
 *
 * @param packageName Android package name (e.g. 'com.example.notes').
 * @param functionId AppFunction identifier (e.g. 'NotesService#createNote').
 * @param prefix Optional custom prefix (defaults to 'android__').
 * @returns Standardized, sanitized WebMCP tool name.
 */
export function formatToolName(packageName: string, functionId: string, prefix?: string): string;

export function formatToolName(
  defOrPkg: AppFunctionDefinition | string,
  functionIdOrPrefix?: string,
  customPrefix?: string
): string {
  let pkg = '';
  let func = '';
  let explicitClass: string | undefined;
  let explicitMethod: string | undefined;
  let prefix = DEFAULT_TOOL_PREFIX;

  if (typeof defOrPkg === 'object' && defOrPkg !== null) {
    pkg = defOrPkg.packageName || '';
    func = defOrPkg.functionId || defOrPkg.methodName || '';
    explicitClass = defOrPkg.className;
    explicitMethod = defOrPkg.methodName;
    if (typeof functionIdOrPrefix === 'string') {
      prefix = functionIdOrPrefix;
    }
  } else {
    pkg = defOrPkg || '';
    func = functionIdOrPrefix || '';
    if (typeof customPrefix === 'string') {
      prefix = customPrefix;
    }
  }

  const sanitizedPkg = sanitizeIdentifier(pkg);

  if (!func && sanitizedPkg) {
    return sanitizeToolName(`${prefix}${sanitizedPkg}`);
  }

  const { className, methodName } = extractCleanComponents(func, explicitClass, explicitMethod);
  const sanitizedMethod = sanitizeIdentifier(methodName) || 'tool';
  const sanitizedClass = className ? sanitizeIdentifier(className) : '';

  // Candidate with both class and method (e.g. NotesService_createNote)
  const classAndMethod =
    sanitizedClass && sanitizedClass !== sanitizedMethod
      ? `${sanitizedClass}_${sanitizedMethod}`
      : sanitizedMethod;

  let rawToolName: string;

  if (sanitizedPkg) {
    // 1. Try full package with class and method
    const fullPkgWithClassAndMethod = `${prefix}${sanitizedPkg}__${classAndMethod}`;
    if (fullPkgWithClassAndMethod.length <= MAX_TOOL_NAME_LENGTH) {
      rawToolName = fullPkgWithClassAndMethod;
    } else {
      // 2. Try full package with method only
      const fullPkgWithMethod = `${prefix}${sanitizedPkg}__${sanitizedMethod}`;
      if (fullPkgWithMethod.length <= MAX_TOOL_NAME_LENGTH) {
        rawToolName = fullPkgWithMethod;
      } else {
        // 3. Try short package with class and method
        const shortPkg = shortenPackageName(pkg);
        const shortPkgWithClassAndMethod = shortPkg
          ? `${prefix}${shortPkg}__${classAndMethod}`
          : `${prefix}${classAndMethod}`;
        if (shortPkgWithClassAndMethod.length <= MAX_TOOL_NAME_LENGTH) {
          rawToolName = shortPkgWithClassAndMethod;
        } else {
          // 4. Try short package with method only
          const shortPkgWithMethod = shortPkg
            ? `${prefix}${shortPkg}__${sanitizedMethod}`
            : `${prefix}${sanitizedMethod}`;
          if (shortPkgWithMethod.length <= MAX_TOOL_NAME_LENGTH) {
            rawToolName = shortPkgWithMethod;
          } else {
            // 5. Prefix with method only
            const methodOnly = `${prefix}${sanitizedMethod}`;
            rawToolName = methodOnly.slice(0, MAX_TOOL_NAME_LENGTH);
          }
        }
      }
    }
  } else {
    // No package provided
    const nameWithClass = `${prefix}${classAndMethod}`;
    if (nameWithClass.length <= MAX_TOOL_NAME_LENGTH) {
      rawToolName = nameWithClass;
    } else {
      const nameWithMethod = `${prefix}${sanitizedMethod}`;
      rawToolName = nameWithMethod.slice(0, MAX_TOOL_NAME_LENGTH);
    }
  }

  return sanitizeToolName(rawToolName);
}

/**
 * Parses an Android WebMCP tool name into its package and function components.
 *
 * @param toolName Registered WebMCP tool name (e.g. 'android__com_example_notes__createNote').
 * @returns ParsedToolName metadata object.
 */
export function parseToolName(toolName: string): ParsedToolName {
  if (!toolName || typeof toolName !== 'string') {
    return {
      isAndroidTool: false,
      packageName: '',
      functionId: '',
    };
  }

  const isAndroidTool = toolName.startsWith(DEFAULT_TOOL_PREFIX);
  const withoutPrefix = isAndroidTool ? toolName.slice(DEFAULT_TOOL_PREFIX.length) : toolName;
  const parts = withoutPrefix.split('__');

  if (parts.length >= 2) {
    const pkg = parts[0];
    const func = parts.slice(1).join('__');
    let className: string | undefined;
    let methodName: string | undefined;

    if (func.includes('_')) {
      const funcParts = func.split('_');
      className = funcParts[0];
      methodName = funcParts.slice(1).join('_');
    } else {
      methodName = func;
    }

    return {
      isAndroidTool,
      packageName: pkg,
      functionId: func,
      className,
      methodName,
    };
  }

  return {
    isAndroidTool,
    packageName: '',
    functionId: withoutPrefix,
    methodName: withoutPrefix,
  };
}

/**
 * Generates a human-readable title for an AppFunction.
 *
 * @param def AppFunction definition.
 * @returns Friendly display title.
 */
export function formatToolTitle(def: AppFunctionDefinition): string {
  if (def.className && def.methodName) {
    return `${def.className}.${def.methodName}`;
  }
  if (def.methodName && def.packageName) {
    return `${def.methodName} (${def.packageName})`;
  }
  if (def.functionId && def.functionId.includes('#')) {
    return def.functionId.replace('#', '.');
  }
  if (def.functionId) {
    return def.functionId;
  }
  return def.packageName ? `AppFunction (${def.packageName})` : 'Android AppFunction';
}

/**
 * Maps an AppFunctionDataType to standard JSON Schema primitive type and optional format.
 *
 * @param dataType AppFunctionDataType.
 * @returns JSON Schema type and optional format.
 */
export function mapDataTypeToJsonSchemaType(
  dataType: AppFunctionDataType
): { type: JsonSchemaProperty['type']; format?: string } {
  switch (dataType) {
    case 'string':
      return { type: 'string' };

    case 'int':
      return { type: 'integer' };

    case 'long':
      return { type: 'integer', format: 'int64' };

    case 'float':
      return { type: 'number', format: 'float' };

    case 'double':
      return { type: 'number', format: 'double' };

    case 'boolean':
      return { type: 'boolean' };

    case 'bytes':
      return { type: 'string', format: 'byte' };

    case 'array':
      return { type: 'array' };

    case 'object':
      return { type: 'object' };

    case 'unit':
      return { type: 'null' };

    case 'unknown':
    default:
      return { type: 'string' };
  }
}

/**
 * Recursively converts an AppFunctionParameter into a standard JSON Schema property.
 *
 * @param param AppFunctionParameter definition.
 * @returns JsonSchemaProperty descriptor.
 */
export function mapParameterToJsonSchema(param: AppFunctionParameter): JsonSchemaProperty {
  const { type, format } = mapDataTypeToJsonSchemaType(param.dataType);

  const schema: JsonSchemaProperty = {
    type,
  };

  if (format) {
    schema.format = format;
  }

  if (param.description) {
    schema.description = param.description;
  }

  if (param.defaultValue !== undefined) {
    schema.default = param.defaultValue;
  }

  // Handle array item type
  if (param.dataType === 'array') {
    if (param.items) {
      schema.items = mapParameterToJsonSchema(param.items);
    } else {
      schema.items = { type: 'string' };
    }
  }

  // Handle nested object properties
  if (param.dataType === 'object') {
    schema.properties = {};
    const requiredList: string[] = [];

    if (param.properties) {
      for (const [key, childParam] of Object.entries(param.properties)) {
        schema.properties[key] = mapParameterToJsonSchema(childParam);
        if (childParam.isRequired) {
          requiredList.push(key);
        }
      }
    }

    if (requiredList.length > 0) {
      schema.required = requiredList;
    }
  }

  return schema;
}

/**
 * Converts a list of AppFunctionParameter definitions into a root JSON Schema
 * suitable for a WebMCP tool's `inputSchema`.
 *
 * @param parameters Array of parameter definitions.
 * @param description Optional description for the root input schema.
 * @returns WebMcpToolInputSchema root object.
 */
export function mapParametersToInputSchema(
  parameters: AppFunctionParameter[] = [],
  description?: string
): WebMcpToolInputSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const param of parameters) {
    properties[param.name] = mapParameterToJsonSchema(param);
    if (param.isRequired) {
      required.push(param.name);
    }
  }

  const rootSchema: WebMcpToolInputSchema = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    rootSchema.required = required;
  }

  if (description) {
    rootSchema.description = description;
  }

  return rootSchema;
}

/**
 * Converts an AppFunctionResponse definition into a JSON Schema descriptor.
 *
 * @param response Optional AppFunctionResponse definition.
 * @returns JsonSchemaProperty or undefined if response is not defined.
 */
export function mapResponseToJsonSchema(
  response?: AppFunctionResponse
): JsonSchemaProperty | undefined {
  if (!response) {
    return undefined;
  }

  const { type, format } = mapDataTypeToJsonSchemaType(response.dataType);
  const schema: JsonSchemaProperty = { type };

  if (format) {
    schema.format = format;
  }

  if (response.description) {
    schema.description = response.description;
  }

  if (response.dataType === 'array') {
    if (response.items) {
      schema.items = mapParameterToJsonSchema(response.items);
    } else {
      schema.items = { type: 'string' };
    }
  }

  if (response.dataType === 'object') {
    schema.properties = {};
    const requiredList: string[] = [];

    if (response.properties) {
      for (const [key, childParam] of Object.entries(response.properties)) {
        schema.properties[key] = mapParameterToJsonSchema(childParam);
        if (childParam.isRequired) {
          requiredList.push(key);
        }
      }
    }

    if (requiredList.length > 0) {
      schema.required = requiredList;
    }
  }

  return schema;
}

/**
 * Infers WebMCP tool annotations (such as readOnlyHint) based on function name heuristics.
 *
 * @param def AppFunction definition.
 * @returns WebMCP.ToolAnnotations object.
 */
export function inferToolAnnotations(def: AppFunctionDefinition): WebMCP.ToolAnnotations {
  let targetName = def.methodName;
  if (!targetName && def.functionId) {
    if (def.functionId.includes('#')) {
      targetName = def.functionId.split('#').pop();
    } else if (def.functionId.includes('.')) {
      targetName = def.functionId.split('.').pop();
    } else if (def.functionId.includes('__')) {
      targetName = def.functionId.split('__').pop();
    } else {
      targetName = def.functionId;
    }
  }

  const nameToCheck = (targetName || '').toLowerCase();

  const readOnlyPrefixes = [
    'get',
    'query',
    'list',
    'read',
    'find',
    'search',
    'check',
    'is',
    'has',
    'fetch',
    'lookup',
    'view',
    'show',
    'count',
  ];

  const isReadOnly = readOnlyPrefixes.some(
    (prefix) => nameToCheck.startsWith(prefix) || nameToCheck.includes(`_${prefix}`)
  );

  if (isReadOnly) {
    return {
      readOnlyHint: true,
    };
  }

  return {};
}

/**
 * Default fallback execution handler when no callback is supplied.
 */
function defaultExecuteHandler(
  def: AppFunctionDefinition
): WebMCP.ToolExecuteCallback {
  return async (input: Record<string, unknown>) => {
    throw new Error(
      `Execution handler not configured for tool '${formatToolName(def)}'. Input: ${JSON.stringify(input)}`
    );
  };
}

/**
 * Maps an on-device Android AppFunctionDefinition into a strongly-typed WebMCP ModelContextTool
 * ready for registration on native `document.modelContext.registerTool(tool, { signal })`.
 *
 * @param def AppFunctionDefinition discovered from Android device.
 * @param options Mapping options (execute callback, custom prefix, annotations, title, description).
 * @returns Strongly-typed WebMCP.ModelContextTool.
 */
export function mapAppFunctionToWebMcpTool(
  def: AppFunctionDefinition,
  options: MapToolOptions | WebMCP.ToolExecuteCallback = {}
): WebMCP.ModelContextTool {
  const normalizedOptions: MapToolOptions =
    typeof options === 'function' ? { execute: options } : options;

  const toolName = formatToolName(def, normalizedOptions.prefix);
  const toolTitle = normalizedOptions.title || formatToolTitle(def);
  const toolDescription =
    normalizedOptions.description ||
    def.description ||
    `Android AppFunction '${def.functionId}' provided by '${def.packageName}'.`;

  const inputSchema = mapParametersToInputSchema(def.parameters, def.description);

  const execute = normalizedOptions.execute || defaultExecuteHandler(def);

  const annotations: WebMCP.ToolAnnotations = {
    ...inferToolAnnotations(def),
    ...(normalizedOptions.annotations || {}),
  };

  const tool: WebMCP.ModelContextTool = {
    name: toolName,
    title: toolTitle,
    description: toolDescription,
    inputSchema,
    execute,
  };

  if (Object.keys(annotations).length > 0) {
    tool.annotations = annotations;
  }

  return tool;
}

/**
 * Batch maps an array of AppFunctionDefinitions into WebMCP ModelContextTools.
 *
 * @param functions Array of AppFunctionDefinitions.
 * @param options Mapping options or shared execute callback.
 * @returns Array of WebMCP.ModelContextTool objects.
 */
export function mapAppFunctionsToWebMcpTools(
  functions: AppFunctionDefinition[],
  options: MapToolOptions | WebMCP.ToolExecuteCallback = {}
): WebMCP.ModelContextTool[] {
  return functions.map((fn) => mapAppFunctionToWebMcpTool(fn, options));
}
