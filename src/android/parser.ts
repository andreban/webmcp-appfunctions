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
 * Error thrown when raw AppFunctions JSON or CLI output cannot be parsed.
 */
export class AppFunctionsParseError extends Error {
  readonly rawOutput?: string;
  readonly originalError?: unknown;

  constructor(message: string, rawOutput?: string, originalError?: unknown) {
    super(message);
    this.name = 'AppFunctionsParseError';
    this.rawOutput = rawOutput;
    this.originalError = originalError;
  }
}

/**
 * Strips ANSI terminal escape codes from raw string output.
 */
export function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Extracts and parses a JSON payload from raw CLI output, tolerating leading/trailing
 * terminal logs, warnings, or empty output.
 *
 * @param rawOutput Raw stdout string from ADB shell.
 * @returns Parsed JSON structure.
 */
export function extractJsonPayload(rawOutput: string): unknown {
  if (!rawOutput) {
    return [];
  }

  const cleaned = stripAnsiCodes(rawOutput).trim();
  if (!cleaned) {
    return [];
  }

  // Handle common "empty" output messages
  if (
    cleaned.toLowerCase().includes('no app functions found') ||
    cleaned.toLowerCase().includes('no functions registered') ||
    cleaned.toLowerCase().includes('0 app functions found') ||
    cleaned === '[]' ||
    cleaned === '{}'
  ) {
    return [];
  }

  // First, attempt direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Scan for potential JSON boundaries: '[' or '{'
    for (let i = 0; i < cleaned.length; i++) {
      const startChar = cleaned[i];
      if (startChar === '[' || startChar === '{') {
        const endChar = startChar === '[' ? ']' : '}';
        let endIdx = cleaned.lastIndexOf(endChar);
        while (endIdx > i) {
          const candidate = cleaned.slice(i, endIdx + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            endIdx = cleaned.lastIndexOf(endChar, endIdx - 1);
          }
        }
      }
    }

    throw new AppFunctionsParseError(
      'Invalid AppFunctions CLI output: No valid JSON array or object found.',
      rawOutput
    );
  }
}

/**
 * Normalizes an Android/Kotlin/Java type string into a standard AppFunctionDataType.
 *
 * @param typeStr Raw type string (e.g. 'java.lang.String', 'List<Int>', 'Boolean', 'float').
 * @returns Standard AppFunctionDataType.
 */
export function normalizeDataType(typeStr?: string): AppFunctionDataType {
  if (!typeStr || typeof typeStr !== 'string') {
    return 'string';
  }

  const trimmed = typeStr.trim();
  const lower = trimmed.toLowerCase();

  // Strip generic packaging like java.lang.String -> string
  const baseName = lower.includes('.') ? lower.split('.').pop()! : lower;

  // Byte array / binary types (checked before generic array/list checking)
  if (
    baseName === 'byte[]' ||
    baseName === 'bytearray' ||
    baseName === 'bytes' ||
    baseName === 'blob' ||
    baseName === 'binary'
  ) {
    return 'bytes';
  }

  // Array / List checking
  if (
    trimmed.endsWith('[]') ||
    baseName.startsWith('list<') ||
    baseName.startsWith('array<') ||
    baseName.startsWith('set<') ||
    baseName.startsWith('collection<') ||
    baseName.startsWith('iterable<') ||
    baseName === 'array' ||
    baseName === 'list' ||
    baseName === 'set' ||
    baseName === 'collection'
  ) {
    return 'array';
  }

  // Primitive strings
  if (
    baseName === 'string' ||
    baseName === 'charsequence' ||
    baseName === 'char' ||
    baseName === 'text' ||
    baseName === 'uri'
  ) {
    return 'string';
  }

  // Integer types
  if (
    baseName === 'int' ||
    baseName === 'integer' ||
    baseName === 'short' ||
    baseName === 'byte' ||
    baseName === 'i32' ||
    baseName === 'i16' ||
    baseName === 'i8'
  ) {
    return 'int';
  }

  // Long types
  if (baseName === 'long' || baseName === 'i64' || baseName === 'int64' || baseName === 'bigint') {
    return 'long';
  }

  // Float types
  if (baseName === 'float' || baseName === 'f32' || baseName === 'single') {
    return 'float';
  }

  // Double / Number types
  if (baseName === 'double' || baseName === 'f64' || baseName === 'number' || baseName === 'decimal') {
    return 'double';
  }

  // Boolean types
  if (baseName === 'boolean' || baseName === 'bool') {
    return 'boolean';
  }

  // Byte array / binary types
  if (
    baseName === 'byte[]' ||
    baseName === 'bytearray' ||
    baseName === 'bytes' ||
    baseName === 'blob' ||
    baseName === 'binary'
  ) {
    return 'bytes';
  }

  // Object / Map types
  if (
    baseName === 'object' ||
    baseName === 'map' ||
    baseName === 'bundle' ||
    baseName === 'parcelable' ||
    baseName === 'jsonobject' ||
    baseName === 'serializable' ||
    baseName === 'struct'
  ) {
    return 'object';
  }

  // Void / Unit return types
  if (baseName === 'void' || baseName === 'unit' || baseName === 'null') {
    return 'unit';
  }

  return 'unknown';
}

/**
 * Extracts inner generic type parameter (e.g. 'String' from 'List<String>').
 */
function extractGenericInnerType(typeStr: string): string | undefined {
  const match = typeStr.match(/<(.+)>/);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (typeStr.endsWith('[]')) {
    return typeStr.slice(0, -2).trim();
  }
  return undefined;
}

/**
 * Parses a single parameter descriptor into an AppFunctionParameter.
 *
 * @param paramRaw Raw parameter definition from JSON.
 * @param defaultName Optional fallback name if not specified.
 * @param parentRequired Optional list of required field names from parent schema.
 * @returns Structured AppFunctionParameter.
 */
export function parseParameter(
  paramRaw: unknown,
  defaultName = 'arg',
  parentRequired?: string[]
): AppFunctionParameter {
  if (!paramRaw || typeof paramRaw !== 'object') {
    const rawType = typeof paramRaw === 'string' ? paramRaw : 'string';
    const dataType = normalizeDataType(rawType);
    return {
      name: defaultName,
      dataType,
      rawType,
      isRequired: parentRequired ? parentRequired.includes(defaultName) : true,
    };
  }

  const raw = paramRaw as Record<string, unknown>;
  const name =
    (raw.name as string) ||
    (raw.id as string) ||
    (raw.key as string) ||
    (raw.propertyName as string) ||
    defaultName;

  const description =
    (raw.description as string) ||
    (raw.doc as string) ||
    (raw.kdoc as string) ||
    (raw.documentation as string) ||
    undefined;

  const rawType =
    (raw.type as string) ||
    (raw.dataType as string) ||
    (raw.rawType as string) ||
    (raw.paramType as string) ||
    'string';

  let dataType = normalizeDataType(rawType);

  // Determine optionality / required status
  let isRequired = true;
  if (typeof raw.required === 'boolean') {
    isRequired = raw.required;
  } else if (typeof raw.isRequired === 'boolean') {
    isRequired = raw.isRequired;
  } else if (typeof raw.optional === 'boolean') {
    isRequired = !raw.optional;
  } else if (typeof raw.isOptional === 'boolean') {
    isRequired = !raw.isOptional;
  } else if (typeof raw.nullable === 'boolean') {
    isRequired = !raw.nullable;
  } else if (parentRequired && Array.isArray(parentRequired)) {
    isRequired = parentRequired.includes(name);
  } else if (raw.defaultValue !== undefined || raw.default !== undefined) {
    isRequired = false;
  }

  const defaultValue = raw.defaultValue ?? raw.default;

  // Handle nested object properties
  let properties: Record<string, AppFunctionParameter> | undefined;
  const rawProperties = raw.properties || raw.fields || raw.parameters;
  if (rawProperties && typeof rawProperties === 'object') {
    dataType = 'object';
    properties = {};
    const childRequired = Array.isArray(raw.required) ? (raw.required as string[]) : undefined;

    if (Array.isArray(rawProperties)) {
      for (const item of rawProperties) {
        if (item && typeof item === 'object') {
          const parsedChild = parseParameter(item, undefined, childRequired);
          properties[parsedChild.name] = parsedChild;
        }
      }
    } else {
      for (const [key, value] of Object.entries(rawProperties as Record<string, unknown>)) {
        properties[key] = parseParameter(value, key, childRequired);
      }
    }
  }

  // Handle array item type
  let items: AppFunctionParameter | undefined;
  const rawItems = raw.items || raw.itemType || raw.elementType;
  if (rawItems) {
    dataType = 'array';
    items = parseParameter(rawItems, 'item');
  } else if (dataType === 'array' && rawType) {
    const innerType = extractGenericInnerType(rawType);
    if (innerType) {
      items = {
        name: 'item',
        dataType: normalizeDataType(innerType),
        rawType: innerType,
        isRequired: true,
      };
    }
  }

  return {
    name,
    dataType,
    rawType,
    description: description ? description.trim() : undefined,
    isRequired,
    defaultValue,
    items,
    properties,
  };
}

/**
 * Parses parameters collection from a function definition.
 */
export function parseParameters(rawParams: unknown, rawInputSchema?: unknown): AppFunctionParameter[] {
  const result: AppFunctionParameter[] = [];

  // Check if parameters is an array
  if (Array.isArray(rawParams)) {
    for (const item of rawParams) {
      result.push(parseParameter(item));
    }
    return result;
  }

  // Check if parameters is an object map
  if (rawParams && typeof rawParams === 'object') {
    const paramsObj = rawParams as Record<string, unknown>;
    for (const [key, value] of Object.entries(paramsObj)) {
      result.push(parseParameter(value, key));
    }
    return result;
  }

  // Check JSON Schema style inputSchema: { type: 'object', properties: {...}, required: [...] }
  if (rawInputSchema && typeof rawInputSchema === 'object') {
    const schemaObj = rawInputSchema as Record<string, unknown>;
    const requiredList = Array.isArray(schemaObj.required)
      ? (schemaObj.required as string[])
      : undefined;
    const properties = schemaObj.properties as Record<string, unknown> | undefined;

    if (properties && typeof properties === 'object') {
      for (const [key, value] of Object.entries(properties)) {
        result.push(parseParameter(value, key, requiredList));
      }
      return result;
    }
  }

  return result;
}

/**
 * Parses response specification from a function definition.
 */
export function parseResponse(rawResponse: unknown): AppFunctionResponse | undefined {
  if (!rawResponse) {
    return undefined;
  }

  if (typeof rawResponse === 'string') {
    const dataType = normalizeDataType(rawResponse);
    return {
      dataType,
      rawType: rawResponse,
    };
  }

  if (typeof rawResponse === 'object') {
    const raw = rawResponse as Record<string, unknown>;
    const rawType =
      (raw.type as string) ||
      (raw.dataType as string) ||
      (raw.rawType as string) ||
      (raw.returnType as string) ||
      'object';

    let dataType = normalizeDataType(rawType);
    const description =
      (raw.description as string) ||
      (raw.doc as string) ||
      (raw.kdoc as string) ||
      undefined;

    let properties: Record<string, AppFunctionParameter> | undefined;
    const rawProperties = raw.properties || raw.fields;
    if (rawProperties && typeof rawProperties === 'object') {
      dataType = 'object';
      properties = {};
      if (Array.isArray(rawProperties)) {
        for (const item of rawProperties) {
          if (item && typeof item === 'object') {
            const parsed = parseParameter(item);
            properties[parsed.name] = parsed;
          }
        }
      } else {
        for (const [key, value] of Object.entries(rawProperties as Record<string, unknown>)) {
          properties[key] = parseParameter(value, key);
        }
      }
    }

    let items: AppFunctionParameter | undefined;
    const rawItems = raw.items || raw.itemType || raw.elementType;
    if (rawItems) {
      dataType = 'array';
      items = parseParameter(rawItems, 'item');
    } else if (dataType === 'array' && rawType) {
      const innerType = extractGenericInnerType(rawType);
      if (innerType) {
        items = {
          name: 'item',
          dataType: normalizeDataType(innerType),
          rawType: innerType,
          isRequired: true,
        };
      }
    }

    return {
      dataType,
      rawType,
      description: description ? description.trim() : undefined,
      items,
      properties,
    };
  }

  return undefined;
}

/**
 * Parses a single function item from the raw JSON structure into an AppFunctionDefinition.
 *
 * @param item Raw JSON object representing a function.
 * @param fallbackPackage Optional fallback package name.
 * @returns Structured AppFunctionDefinition or null if invalid.
 */
export function parseFunctionDefinition(
  item: unknown,
  fallbackPackage?: string
): AppFunctionDefinition | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const raw = item as Record<string, unknown>;

  const packageName =
    (raw.package as string) ||
    (raw.packageName as string) ||
    (raw.appPackage as string) ||
    (raw.pkg as string) ||
    fallbackPackage ||
    '';

  const functionId =
    (raw.function as string) ||
    (raw.functionId as string) ||
    (raw.id as string) ||
    (raw.name as string) ||
    (raw.identifier as string) ||
    '';

  if (!functionId && !packageName) {
    return null;
  }

  // Extract className and methodName
  let className = (raw.className as string) || (raw.serviceClassName as string) || undefined;
  let methodName = (raw.methodName as string) || (raw.functionName as string) || undefined;

  if (functionId.includes('#')) {
    const parts = functionId.split('#');
    if (!className && parts[0]) {
      className = parts[0].trim();
    }
    if (!methodName && parts[1]) {
      methodName = parts[1].trim();
    }
  } else if (!methodName) {
    methodName = functionId;
  }

  const description =
    (raw.description as string) ||
    (raw.doc as string) ||
    (raw.kdoc as string) ||
    (raw.documentation as string) ||
    undefined;

  const rawParams = raw.parameters ?? raw.params ?? raw.arguments ?? raw.inputs;
  const rawInputSchema = raw.inputSchema ?? raw.schema;
  const parameters = parseParameters(rawParams, rawInputSchema);

  const rawResp =
    raw.response ??
    raw.returnType ??
    raw.responseType ??
    raw.output ??
    raw.outputSchema ??
    raw.result;
  const response = parseResponse(rawResp);

  let enabled = true;
  if (typeof raw.enabled === 'boolean') {
    enabled = raw.enabled;
  } else if (typeof raw.isEnabled === 'boolean') {
    enabled = raw.isEnabled;
  } else if (typeof raw.state === 'string') {
    enabled = raw.state.toLowerCase() === 'enable' || raw.state.toLowerCase() === 'enabled';
  }

  return {
    packageName,
    functionId: functionId || methodName || 'unknown',
    className,
    methodName,
    description: description ? description.trim() : undefined,
    parameters,
    response,
    enabled,
    rawJson: item,
  };
}

/**
 * Parses raw JSON or CLI output emitted by `cmd app_function list-app-functions`
 * into a list of strongly-typed AppFunctionDefinition objects.
 *
 * @param rawInput Raw stdout string or already-parsed JSON object/array.
 * @returns Array of parsed AppFunctionDefinition.
 */
export function parseRawAppFunctionsJson(rawInput: unknown): AppFunctionDefinition[] {
  let parsedJson: unknown;

  if (typeof rawInput === 'string') {
    parsedJson = extractJsonPayload(rawInput);
  } else {
    parsedJson = rawInput;
  }

  if (!parsedJson) {
    return [];
  }

  const results: AppFunctionDefinition[] = [];

  // Case 1: Direct array of functions: [ {...}, {...} ]
  if (Array.isArray(parsedJson)) {
    for (const item of parsedJson) {
      const def = parseFunctionDefinition(item);
      if (def) {
        results.push(def);
      }
    }
    return results;
  }

  if (typeof parsedJson === 'object') {
    const obj = parsedJson as Record<string, unknown>;

    // Case 2: Object with `functions`, `appFunctions`, `items`, or `data` array
    const candidateArray =
      obj.functions ?? obj.appFunctions ?? obj.items ?? obj.data ?? obj.list;

    if (Array.isArray(candidateArray)) {
      for (const item of candidateArray) {
        const def = parseFunctionDefinition(item);
        if (def) {
          results.push(def);
        }
      }
      return results;
    }

    // Case 3: Object with `packages` array: { packages: [ { package: "com.example", functions: [...] } ] }
    if (Array.isArray(obj.packages)) {
      for (const pkgItem of obj.packages) {
        if (pkgItem && typeof pkgItem === 'object') {
          const pkgObj = pkgItem as Record<string, unknown>;
          const pkgName = (pkgObj.package as string) || (pkgObj.packageName as string) || '';
          const pkgFunctions = pkgObj.functions || pkgObj.appFunctions;
          if (Array.isArray(pkgFunctions)) {
            for (const fnItem of pkgFunctions) {
              const def = parseFunctionDefinition(fnItem, pkgName);
              if (def) {
                results.push(def);
              }
            }
          }
        }
      }
      return results;
    }

    // Case 4: Map of package name to function array: { "com.example.notes": [ {...} ] }
    let hasPackageMap = false;
    for (const [key, val] of Object.entries(obj)) {
      if (Array.isArray(val) && key.includes('.')) {
        hasPackageMap = true;
        for (const fnItem of val) {
          const def = parseFunctionDefinition(fnItem, key);
          if (def) {
            results.push(def);
          }
        }
      }
    }
    if (hasPackageMap) {
      return results;
    }

    // Case 5: Single function object
    const singleDef = parseFunctionDefinition(obj);
    if (singleDef) {
      results.push(singleDef);
      return results;
    }
  }

  return results;
}
