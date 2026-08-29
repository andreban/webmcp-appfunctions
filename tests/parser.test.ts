/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseRawAppFunctionsJson,
  parseFunctionDefinition,
  parseParameter,
  parseResponse,
  normalizeDataType,
  extractJsonPayload,
  AppFunctionsParseError,
  stripAnsiCodes,
} from '../src/android/parser';

describe('AppFunctions Parser', () => {
  describe('stripAnsiCodes', () => {
    it('removes ANSI color and control codes from terminal output', () => {
      const raw = '\u001b[32m[OK]\u001b[0m AppFunctions ready';
      expect(stripAnsiCodes(raw)).toBe('[OK] AppFunctions ready');
    });
  });

  describe('extractJsonPayload', () => {
    it('returns empty array for empty or whitespace-only strings', () => {
      expect(extractJsonPayload('')).toEqual([]);
      expect(extractJsonPayload('   \n\t  ')).toEqual([]);
    });

    it('returns empty array when output indicates no functions were found', () => {
      expect(extractJsonPayload('No app functions found on device.')).toEqual([]);
      expect(extractJsonPayload('0 app functions found')).toEqual([]);
      expect(extractJsonPayload('No functions registered for package com.test')).toEqual([]);
      expect(extractJsonPayload('[]')).toEqual([]);
      expect(extractJsonPayload('{}')).toEqual([]);
    });

    it('parses direct JSON array', () => {
      const json = JSON.stringify([{ package: 'com.example.notes', function: 'createNote' }]);
      expect(extractJsonPayload(json)).toEqual([
        { package: 'com.example.notes', function: 'createNote' },
      ]);
    });

    it('extracts JSON array enclosed in shell/terminal log output', () => {
      const output = `
[DEBUG] Starting command execution...
Connecting to adbd...
[{"package": "com.example.notes", "function": "createNote"}]
Execution completed in 12ms.
`;
      expect(extractJsonPayload(output)).toEqual([
        { package: 'com.example.notes', function: 'createNote' },
      ]);
    });

    it('extracts JSON object enclosed in shell/terminal log output', () => {
      const output = `
Service started.
{"functions": [{"package": "com.example.notes", "function": "createNote"}]}
Done.
`;
      expect(extractJsonPayload(output)).toEqual({
        functions: [{ package: 'com.example.notes', function: 'createNote' }],
      });
    });

    it('throws AppFunctionsParseError when no valid JSON is present', () => {
      expect(() => extractJsonPayload('Error: invalid command syntax')).toThrow(
        AppFunctionsParseError
      );
    });
  });

  describe('normalizeDataType', () => {
    it('normalizes string types', () => {
      expect(normalizeDataType('String')).toBe('string');
      expect(normalizeDataType('java.lang.String')).toBe('string');
      expect(normalizeDataType('CharSequence')).toBe('string');
      expect(normalizeDataType('text')).toBe('string');
    });

    it('normalizes integer types', () => {
      expect(normalizeDataType('Int')).toBe('int');
      expect(normalizeDataType('Integer')).toBe('int');
      expect(normalizeDataType('java.lang.Integer')).toBe('int');
      expect(normalizeDataType('short')).toBe('int');
      expect(normalizeDataType('byte')).toBe('int');
      expect(normalizeDataType('i32')).toBe('int');
    });

    it('normalizes long types', () => {
      expect(normalizeDataType('Long')).toBe('long');
      expect(normalizeDataType('java.lang.Long')).toBe('long');
      expect(normalizeDataType('int64')).toBe('long');
      expect(normalizeDataType('i64')).toBe('long');
    });

    it('normalizes floating point and double types', () => {
      expect(normalizeDataType('Float')).toBe('float');
      expect(normalizeDataType('java.lang.Float')).toBe('float');
      expect(normalizeDataType('f32')).toBe('float');
      expect(normalizeDataType('Double')).toBe('double');
      expect(normalizeDataType('java.lang.Double')).toBe('double');
      expect(normalizeDataType('number')).toBe('double');
    });

    it('normalizes boolean types', () => {
      expect(normalizeDataType('Boolean')).toBe('boolean');
      expect(normalizeDataType('java.lang.Boolean')).toBe('boolean');
      expect(normalizeDataType('bool')).toBe('boolean');
    });

    it('normalizes binary/bytes types', () => {
      expect(normalizeDataType('byte[]')).toBe('bytes');
      expect(normalizeDataType('ByteArray')).toBe('bytes');
      expect(normalizeDataType('bytes')).toBe('bytes');
      expect(normalizeDataType('blob')).toBe('bytes');
    });

    it('normalizes array and list types', () => {
      expect(normalizeDataType('Array')).toBe('array');
      expect(normalizeDataType('List')).toBe('array');
      expect(normalizeDataType('java.util.List')).toBe('array');
      expect(normalizeDataType('List<String>')).toBe('array');
      expect(normalizeDataType('String[]')).toBe('array');
      expect(normalizeDataType('Set<Int>')).toBe('array');
    });

    it('normalizes object and container types', () => {
      expect(normalizeDataType('object')).toBe('object');
      expect(normalizeDataType('Map')).toBe('object');
      expect(normalizeDataType('Bundle')).toBe('object');
      expect(normalizeDataType('Parcelable')).toBe('object');
      expect(normalizeDataType('JSONObject')).toBe('object');
    });

    it('normalizes void / Unit types', () => {
      expect(normalizeDataType('Unit')).toBe('unit');
      expect(normalizeDataType('kotlin.Unit')).toBe('unit');
      expect(normalizeDataType('void')).toBe('unit');
      expect(normalizeDataType('null')).toBe('unit');
    });

    it('defaults undefined or non-string input to string', () => {
      expect(normalizeDataType(undefined)).toBe('string');
      expect(normalizeDataType('')).toBe('string');
    });
  });

  describe('parseParameter', () => {
    it('parses primitive parameter descriptor', () => {
      const raw = {
        name: 'query',
        type: 'String',
        description: 'Search keyword',
        required: true,
      };

      const result = parseParameter(raw);
      expect(result).toEqual({
        name: 'query',
        dataType: 'string',
        rawType: 'String',
        description: 'Search keyword',
        isRequired: true,
        defaultValue: undefined,
        items: undefined,
        properties: undefined,
      });
    });

    it('parses optional parameter with default value', () => {
      const raw = {
        name: 'limit',
        type: 'Int',
        description: 'Maximum items to return',
        required: false,
        defaultValue: 20,
      };

      const result = parseParameter(raw);
      expect(result).toEqual({
        name: 'limit',
        dataType: 'int',
        rawType: 'Int',
        description: 'Maximum items to return',
        isRequired: false,
        defaultValue: 20,
        items: undefined,
        properties: undefined,
      });
    });

    it('parses array parameter with generic item type', () => {
      const raw = {
        name: 'tags',
        type: 'List<String>',
        description: 'List of tags',
      };

      const result = parseParameter(raw);
      expect(result.dataType).toBe('array');
      expect(result.items).toEqual({
        name: 'item',
        dataType: 'string',
        rawType: 'String',
        isRequired: true,
      });
    });

    it('parses array parameter with explicit item schema', () => {
      const raw = {
        name: 'recipients',
        type: 'array',
        items: {
          name: 'recipient',
          type: 'String',
          description: 'Recipient phone number',
        },
      };

      const result = parseParameter(raw);
      expect(result.dataType).toBe('array');
      expect(result.items?.name).toBe('recipient');
      expect(result.items?.dataType).toBe('string');
    });

    it('parses nested object parameter with properties', () => {
      const raw = {
        name: 'filter',
        type: 'object',
        properties: {
          startDate: { type: 'String', description: 'Start date in ISO format' },
          maxResults: { type: 'Int', defaultValue: 10, required: false },
        },
      };

      const result = parseParameter(raw);
      expect(result.dataType).toBe('object');
      expect(result.properties).toBeDefined();
      expect(result.properties?.startDate.dataType).toBe('string');
      expect(result.properties?.startDate.isRequired).toBe(true);
      expect(result.properties?.maxResults.dataType).toBe('int');
      expect(result.properties?.maxResults.isRequired).toBe(false);
      expect(result.properties?.maxResults.defaultValue).toBe(10);
    });

    it('respects parent required array when parsing JSON schema properties', () => {
      const parentRequired = ['title', 'content'];
      const param1 = parseParameter({ type: 'String' }, 'title', parentRequired);
      const param2 = parseParameter({ type: 'String' }, 'summary', parentRequired);

      expect(param1.isRequired).toBe(true);
      expect(param2.isRequired).toBe(false);
    });
  });

  describe('parseResponse', () => {
    it('parses primitive string response', () => {
      const result = parseResponse('java.lang.String');
      expect(result).toEqual({
        dataType: 'string',
        rawType: 'java.lang.String',
      });
    });

    it('parses object response descriptor with properties', () => {
      const raw = {
        type: 'object',
        description: 'Created note details',
        properties: {
          id: { type: 'Long', description: 'Generated note ID' },
          success: { type: 'Boolean' },
        },
      };

      const result = parseResponse(raw);
      expect(result?.dataType).toBe('object');
      expect(result?.description).toBe('Created note details');
      expect(result?.properties?.id.dataType).toBe('long');
      expect(result?.properties?.success.dataType).toBe('boolean');
    });

    it('parses array response descriptor', () => {
      const raw = {
        type: 'List<String>',
        description: 'List of matching note titles',
      };

      const result = parseResponse(raw);
      expect(result?.dataType).toBe('array');
      expect(result?.items?.dataType).toBe('string');
    });

    it('returns undefined for null or empty response', () => {
      expect(parseResponse(null)).toBeUndefined();
      expect(parseResponse(undefined)).toBeUndefined();
    });
  });

  describe('parseFunctionDefinition', () => {
    it('parses standard ClassName#MethodName function identifier', () => {
      const raw = {
        package: 'com.example.notes',
        function: 'NotesService#createNote',
        description: 'Creates a new note on the device.',
        parameters: [
          { name: 'title', type: 'String', description: 'Title of the note', required: true },
          { name: 'content', type: 'String', description: 'Body text of the note', required: true },
        ],
        response: {
          type: 'Long',
          description: 'ID of the created note',
        },
      };

      const result = parseFunctionDefinition(raw);
      expect(result).not.toBeNull();
      expect(result?.packageName).toBe('com.example.notes');
      expect(result?.functionId).toBe('NotesService#createNote');
      expect(result?.className).toBe('NotesService');
      expect(result?.methodName).toBe('createNote');
      expect(result?.description).toBe('Creates a new note on the device.');
      expect(result?.parameters).toHaveLength(2);
      expect(result?.parameters[0].name).toBe('title');
      expect(result?.parameters[0].dataType).toBe('string');
      expect(result?.response?.dataType).toBe('long');
      expect(result?.enabled).toBe(true);
    });

    it('parses functions with explicit className and methodName', () => {
      const raw = {
        packageName: 'com.example.mail',
        functionId: 'sendEmail',
        className: 'com.example.mail.MailAppFunctionService',
        methodName: 'sendEmail',
        description: 'Sends an email message.',
        state: 'enable',
      };

      const result = parseFunctionDefinition(raw);
      expect(result?.packageName).toBe('com.example.mail');
      expect(result?.functionId).toBe('sendEmail');
      expect(result?.className).toBe('com.example.mail.MailAppFunctionService');
      expect(result?.methodName).toBe('sendEmail');
      expect(result?.enabled).toBe(true);
    });

    it('handles disabled function state', () => {
      const raw = {
        package: 'com.example.notes',
        function: 'NotesService#deleteNote',
        enabled: false,
      };

      const result = parseFunctionDefinition(raw);
      expect(result?.enabled).toBe(false);
    });

    it('parses parameters specified as a JSON schema inputSchema object', () => {
      const raw = {
        package: 'com.example.calculator',
        function: 'CalculatorService#add',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'Double', description: 'First operand' },
            b: { type: 'Double', description: 'Second operand' },
          },
          required: ['a', 'b'],
        },
      };

      const result = parseFunctionDefinition(raw);
      expect(result?.parameters).toHaveLength(2);
      expect(result?.parameters[0].name).toBe('a');
      expect(result?.parameters[0].dataType).toBe('double');
      expect(result?.parameters[0].isRequired).toBe(true);
      expect(result?.parameters[1].name).toBe('b');
      expect(result?.parameters[1].dataType).toBe('double');
      expect(result?.parameters[1].isRequired).toBe(true);
    });
  });

  describe('parseRawAppFunctionsJson', () => {
    it('parses a direct JSON array of function definitions', () => {
      const rawJson = [
        {
          package: 'com.example.notes',
          function: 'NotesService#createNote',
          description: 'Create note',
          parameters: [{ name: 'title', type: 'String' }],
        },
        {
          package: 'com.example.notes',
          function: 'NotesService#getNotes',
          description: 'List notes',
          parameters: [],
        },
      ];

      const results = parseRawAppFunctionsJson(rawJson);
      expect(results).toHaveLength(2);
      expect(results[0].functionId).toBe('NotesService#createNote');
      expect(results[1].functionId).toBe('NotesService#getNotes');
    });

    it('parses a wrapped functions object: { functions: [...] }', () => {
      const rawJson = {
        functions: [
          {
            package: 'com.example.timer',
            function: 'TimerService#setTimer',
            parameters: [{ name: 'durationSeconds', type: 'Int' }],
          },
        ],
      };

      const results = parseRawAppFunctionsJson(rawJson);
      expect(results).toHaveLength(1);
      expect(results[0].packageName).toBe('com.example.timer');
      expect(results[0].methodName).toBe('setTimer');
    });

    it('parses a package-grouped object: { packages: [ { package: "...", functions: [...] } ] }', () => {
      const rawJson = {
        packages: [
          {
            package: 'com.example.calendar',
            functions: [
              {
                function: 'CalendarService#createEvent',
                parameters: [{ name: 'title', type: 'String' }],
              },
            ],
          },
        ],
      };

      const results = parseRawAppFunctionsJson(rawJson);
      expect(results).toHaveLength(1);
      expect(results[0].packageName).toBe('com.example.calendar');
      expect(results[0].functionId).toBe('CalendarService#createEvent');
    });

    it('parses a package map object: { "com.example.pkg": [...] }', () => {
      const rawJson = {
        'com.example.contacts': [
          {
            function: 'ContactsService#searchContact',
            parameters: [{ name: 'name', type: 'String' }],
          },
        ],
      };

      const results = parseRawAppFunctionsJson(rawJson);
      expect(results).toHaveLength(1);
      expect(results[0].packageName).toBe('com.example.contacts');
      expect(results[0].methodName).toBe('searchContact');
    });

    it('parses raw string output directly', () => {
      const rawString = JSON.stringify([
        {
          package: 'com.example.camera',
          function: 'CameraService#takePhoto',
        },
      ]);

      const results = parseRawAppFunctionsJson(rawString);
      expect(results).toHaveLength(1);
      expect(results[0].packageName).toBe('com.example.camera');
      expect(results[0].methodName).toBe('takePhoto');
    });
  });
});
