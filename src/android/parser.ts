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
 * Unwraps a value that may be wrapped in a single-element array by Android GenericDocument serialization.
 */
export function unwrapValue<T = unknown>(val: unknown): T | undefined {
  if (val === null || val === undefined) {
    return undefined;
  }
  if (Array.isArray(val)) {
    return val.length > 0 ? (val[0] as T) : undefined;
  }
  return val as T;
}

/**
 * Maps numeric Android AppFunction/AppSearch type codes into AppFunctionDataType.
 */
export function mapTypeCodeToDataType(typeCode: number | string): AppFunctionDataType {
  const num = typeof typeCode === 'number' ? typeCode : Number(typeCode);
  switch (num) {
    case 1:
      return 'boolean';
    case 2:
      return 'bytes';
    case 3:
      return 'object';
    case 4:
      return 'float';
    case 5:
      return 'double';
    case 6:
      return 'long';
    case 7:
      return 'int';
    case 8:
      return 'string';
    case 9:
      return 'unit';
    case 10:
      return 'array';
    case 11:
      return 'object';
    case 12:
      return 'string';
    case 13:
      return 'object';
    default:
      return 'unknown';
  }
}

/**
 * Normalizes an Android/Kotlin/Java type string or numeric type code into a standard AppFunctionDataType.
 *
 * @param typeStr Raw type string or numeric code (e.g. 'java.lang.String', 'List<Int>', 'Boolean', 8, 6).
 * @returns Standard AppFunctionDataType.
 */
export function normalizeDataType(typeStr?: string | number): AppFunctionDataType {
  if (typeStr === undefined || typeStr === null) {
    return 'string';
  }

  if (typeof typeStr === 'number') {
    return mapTypeCodeToDataType(typeStr);
  }

  if (typeof typeStr !== 'string') {
    return 'string';
  }

  const trimmed = typeStr.trim();
  if (!trimmed) {
    return 'string';
  }
  if (/^\d+$/.test(trimmed)) {
    return mapTypeCodeToDataType(Number(trimmed));
  }

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
  if (!paramRaw) {
    return {
      name: defaultName,
      dataType: 'string',
      rawType: 'string',
      isRequired: parentRequired ? parentRequired.includes(defaultName) : true,
    };
  }

  const unwrappedRaw = unwrapValue(paramRaw) || paramRaw;
  if (typeof unwrappedRaw !== 'object' || unwrappedRaw === null) {
    const rawType = typeof unwrappedRaw === 'string' ? unwrappedRaw : 'string';
    const dataType = normalizeDataType(rawType);
    return {
      name: defaultName,
      dataType,
      rawType,
      isRequired: parentRequired ? parentRequired.includes(defaultName) : true,
    };
  }

  const raw = unwrappedRaw as Record<string, unknown>;
  const name =
    (unwrapValue(raw.name) as string) ||
    (unwrapValue(raw.id) as string) ||
    (unwrapValue(raw.key) as string) ||
    (unwrapValue(raw.propertyName) as string) ||
    defaultName;

  const description =
    (unwrapValue(raw.description) as string) ||
    (unwrapValue(raw.doc) as string) ||
    (unwrapValue(raw.kdoc) as string) ||
    (unwrapValue(raw.documentation) as string) ||
    undefined;

  let rawType =
    (unwrapValue(raw.type) as string) ||
    (unwrapValue(raw.dataType) as string) ||
    (unwrapValue(raw.rawType) as string) ||
    (unwrapValue(raw.paramType) as string) ||
    'string';

  let dataType = normalizeDataType(rawType);

  let items: AppFunctionParameter | undefined;
  let properties: Record<string, AppFunctionParameter> | undefined;

  // Check dataTypeMetadata (Android 16 AppFunctions metadata format)
  const rawDataTypeMeta = unwrapValue(raw.dataTypeMetadata);
  if (rawDataTypeMeta && typeof rawDataTypeMeta === 'object') {
    const typeMeta = (Array.isArray(rawDataTypeMeta)
      ? rawDataTypeMeta[0]
      : rawDataTypeMeta) as Record<string, unknown>;
    const typeCode = unwrapValue<number | string>(typeMeta.type);
    if (typeCode !== undefined) {
      dataType = mapTypeCodeToDataType(typeCode);
    }
    const typeRef =
      (unwrapValue(typeMeta.dataTypeReference) as string) ||
      (unwrapValue(typeMeta.objectQualifiedName) as string);
    if (typeRef) {
      rawType = typeRef;
    }

    if (dataType === 'array') {
      const rawItemType = unwrapValue(typeMeta.itemType);
      if (rawItemType) {
        items = parseParameter(rawItemType, 'item');
      }
    } else if (dataType === 'object') {
      const rawProps = unwrapValue(typeMeta.properties);
      if (rawProps && Array.isArray(rawProps)) {
        properties = {};
        for (const item of rawProps) {
          const parsed = parseParameter(item);
          properties[parsed.name] = parsed;
        }
      }
    }
  }

  // Determine optionality / required status
  let isRequired = true;
  const rawIsReq = unwrapValue(raw.isRequired);
  const rawReq = unwrapValue(raw.required);
  const rawOpt = unwrapValue(raw.optional) ?? unwrapValue(raw.isOptional);
  const rawNullable = unwrapValue(raw.nullable);

  if (typeof rawReq === 'boolean') {
    isRequired = rawReq;
  } else if (typeof rawIsReq === 'boolean') {
    isRequired = rawIsReq;
  } else if (typeof rawOpt === 'boolean') {
    isRequired = !rawOpt;
  } else if (typeof rawNullable === 'boolean') {
    isRequired = !rawNullable;
  } else if (parentRequired && Array.isArray(parentRequired)) {
    isRequired = parentRequired.includes(name);
  } else if (raw.defaultValue !== undefined || raw.default !== undefined) {
    isRequired = false;
  }

  const defaultValue = unwrapValue(raw.defaultValue) ?? unwrapValue(raw.default);

  // Handle nested object properties from legacy fields
  const rawProperties = raw.properties || raw.fields || raw.parameters;
  if (!properties && rawProperties && typeof rawProperties === 'object') {
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

  // Handle array item type from legacy fields
  const rawItems = raw.items || raw.itemType || raw.elementType;
  if (!items && rawItems) {
    dataType = 'array';
    items = parseParameter(rawItems, 'item');
  } else if (!items && dataType === 'array' && rawType) {
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

  const unwrapped = unwrapValue(rawResponse) || rawResponse;

  if (typeof unwrapped === 'string') {
    const dataType = normalizeDataType(unwrapped);
    return {
      dataType,
      rawType: unwrapped,
    };
  }

  if (typeof unwrapped === 'object' && unwrapped !== null) {
    const raw = unwrapped as Record<string, unknown>;
    const description =
      (unwrapValue(raw.description) as string) ||
      (unwrapValue(raw.doc) as string) ||
      (unwrapValue(raw.kdoc) as string) ||
      (unwrapValue(raw.documentation) as string) ||
      undefined;

    let rawType =
      (unwrapValue(raw.type) as string) ||
      (unwrapValue(raw.dataType) as string) ||
      (unwrapValue(raw.rawType) as string) ||
      (unwrapValue(raw.returnType) as string) ||
      'object';

    let dataType = normalizeDataType(rawType);
    let items: AppFunctionParameter | undefined;
    let properties: Record<string, AppFunctionParameter> | undefined;

    // Check valueType / dataTypeMetadata (Android 16 AppFunctions metadata format)
    const rawValueType = unwrapValue(raw.valueType) || unwrapValue(raw.dataTypeMetadata);
    if (rawValueType && typeof rawValueType === 'object') {
      const typeMeta = (Array.isArray(rawValueType)
        ? rawValueType[0]
        : rawValueType) as Record<string, unknown>;
      const typeCode = unwrapValue<number | string>(typeMeta.type);
      if (typeCode !== undefined) {
        dataType = mapTypeCodeToDataType(typeCode);
      }
      const typeRef =
        (unwrapValue(typeMeta.dataTypeReference) as string) ||
        (unwrapValue(typeMeta.objectQualifiedName) as string);
      if (typeRef) {
        rawType = typeRef;
      }

      if (dataType === 'array') {
        const rawItemType = unwrapValue(typeMeta.itemType);
        if (rawItemType) {
          items = parseParameter(rawItemType, 'item');
        }
      } else if (dataType === 'object') {
        const rawProps = unwrapValue(typeMeta.properties);
        if (rawProps && Array.isArray(rawProps)) {
          properties = {};
          for (const item of rawProps) {
            const parsed = parseParameter(item);
            properties[parsed.name] = parsed;
          }
        }
      }
    }

    const rawProperties = raw.properties || raw.fields;
    if (!properties && rawProperties && typeof rawProperties === 'object') {
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

    const rawItems = raw.items || raw.itemType || raw.elementType;
    if (!items && rawItems) {
      dataType = 'array';
      items = parseParameter(rawItems, 'item');
    } else if (!items && dataType === 'array' && rawType) {
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
 * Extracts a package name from a function identifier or class name when explicit package
 * fields are absent in the CLI output.
 *
 * @param identifier Target identifier (e.g. 'me.bandarra.example.todo.appfunctions.BaseTodoAppFunctionService#createTask' or 'com.example.notes.NotesService').
 * @returns Extracted package name or empty string.
 */
export function extractPackageNameFromIdentifier(identifier?: string): string {
  if (!identifier || typeof identifier !== 'string') {
    return '';
  }

  const trimmed = identifier.trim();
  if (!trimmed) {
    return '';
  }

  // If identifier contains '#', take the prefix before '#'
  const target = trimmed.includes('#') ? trimmed.split('#')[0].trim() : trimmed;
  if (!target) {
    return '';
  }

  const parts = target.split('.').filter(Boolean);
  if (parts.length < 2) {
    return '';
  }

  // Find the index of the first segment starting with an uppercase letter (PascalCase class name)
  const classIndex = parts.findIndex((part) => /^[A-Z]/.test(part));
  if (classIndex > 0) {
    return parts.slice(0, classIndex).join('.');
  }

  // If no segment starts with uppercase
  if (classIndex === -1) {
    // If there was a '#' separator, the entire prefix before '#' is the package identifier
    if (trimmed.includes('#')) {
      return parts.join('.');
    }
    // If no '#' separator and has >= 2 parts, assume the last part is the method/action name and previous parts are package
    return parts.slice(0, -1).join('.');
  }

  return '';
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

  let raw = item as Record<string, unknown>;

  // Check if item is wrapped in AppFunctionStaticMetadata-<pkg>
  const staticKey = Object.keys(raw).find((k) =>
    k.startsWith('AppFunctionStaticMetadata')
  );

  if (staticKey) {
    const staticContent = raw[staticKey];
    if (staticContent && typeof staticContent === 'object') {
      raw = staticContent as Record<string, unknown>;
    }
  } else {
    // If this object only contains AppFunctionComponentMetadataDocument (component schemas, not a function)
    const isComponentDoc = Object.keys(raw).some((k) =>
      k.startsWith('AppFunctionComponentMetadataDocument')
    );
    if (isComponentDoc) {
      return null;
    }
  }

  const functionId =
    (unwrapValue(raw.function) as string) ||
    (unwrapValue(raw.functionId) as string) ||
    (unwrapValue(raw.id) as string) ||
    (unwrapValue(raw.name) as string) ||
    (unwrapValue(raw.identifier) as string) ||
    '';

  // Extract className and methodName
  let className =
    (unwrapValue(raw.className) as string) ||
    (unwrapValue(raw.serviceName) as string) ||
    (unwrapValue(raw.serviceClassName) as string) ||
    undefined;
  let methodName =
    (unwrapValue(raw.methodName) as string) ||
    (unwrapValue(raw.functionName) as string) ||
    (unwrapValue(raw.schemaName) as string) ||
    undefined;

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

  const explicitPackage =
    (unwrapValue(raw.package) as string) ||
    (unwrapValue(raw.packageName) as string) ||
    (unwrapValue(raw.appPackage) as string) ||
    (unwrapValue(raw.applicationPackage) as string) ||
    (unwrapValue(raw.targetPackage) as string) ||
    (unwrapValue(raw.package_name) as string) ||
    (unwrapValue(raw.pkg) as string);

  let packageName = '';
  if (explicitPackage && typeof explicitPackage === 'string' && explicitPackage.trim()) {
    packageName = explicitPackage.trim();
  } else if (fallbackPackage && typeof fallbackPackage === 'string' && fallbackPackage.trim()) {
    packageName = fallbackPackage.trim();
  } else {
    packageName =
      extractPackageNameFromIdentifier(functionId) ||
      (className ? extractPackageNameFromIdentifier(className) : '') ||
      '';
  }

  if (!functionId && !packageName) {
    return null;
  }

  const description =
    (unwrapValue(raw.description) as string) ||
    (unwrapValue(raw.doc) as string) ||
    (unwrapValue(raw.kdoc) as string) ||
    (unwrapValue(raw.documentation) as string) ||
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
  const enabledByDefault = unwrapValue(raw.enabledByDefault);
  const rawEnabled = unwrapValue(raw.enabled);
  const rawIsEnabled = unwrapValue(raw.isEnabled);
  const rawState = unwrapValue(raw.state);

  if (typeof enabledByDefault === 'boolean') {
    enabled = enabledByDefault;
  } else if (typeof rawEnabled === 'boolean') {
    enabled = rawEnabled;
  } else if (typeof rawIsEnabled === 'boolean') {
    enabled = rawIsEnabled;
  } else if (typeof rawState === 'string') {
    enabled = rawState.toLowerCase() === 'enable' || rawState.toLowerCase() === 'enabled';
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
 * @param fallbackPackage Optional fallback package name.
 * @returns Array of parsed AppFunctionDefinition.
 */
export function parseRawAppFunctionsJson(
  rawInput: unknown,
  fallbackPackage?: string
): AppFunctionDefinition[] {
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
      const def = parseFunctionDefinition(item, fallbackPackage);
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
        const def = parseFunctionDefinition(item, fallbackPackage);
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
          const pkgName =
            (pkgObj.package as string) ||
            (pkgObj.packageName as string) ||
            (pkgObj.appPackage as string) ||
            (pkgObj.applicationPackage as string) ||
            (pkgObj.targetPackage as string) ||
            (pkgObj.package_name as string) ||
            (pkgObj.pkg as string) ||
            fallbackPackage ||
            '';
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
    const singleDef = parseFunctionDefinition(obj, fallbackPackage);
    if (singleDef) {
      results.push(singleDef);
      return results;
    }
  }

  return results;
}
