/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isValidToolName,
  sanitizeIdentifier,
  sanitizeToolName,
  formatToolName,
  parseToolName,
  formatToolTitle,
  mapDataTypeToJsonSchemaType,
  mapParameterToJsonSchema,
  mapParametersToInputSchema,
  mapResponseToJsonSchema,
  inferToolAnnotations,
  mapAppFunctionToWebMcpTool,
  mapAppFunctionsToWebMcpTools,
  MAX_TOOL_NAME_LENGTH,
} from '../src/webmcp/schema-mapper';
import {
  AppFunctionDefinition,
  AppFunctionParameter,
  AppFunctionResponse,
} from '../src/types/appfunctions';

describe('WebMCP Schema Mapper', () => {
  describe('Tool Naming & Sanitization', () => {
    describe('isValidToolName', () => {
      it('validates compliant WebMCP tool names', () => {
        expect(isValidToolName('android__com_example_notes__createNote')).toBe(true);
        expect(isValidToolName('my-tool_123.v1')).toBe(true);
        expect(isValidToolName('tool')).toBe(true);
      });

      it('rejects invalid WebMCP tool names', () => {
        expect(isValidToolName('')).toBe(false);
        expect(isValidToolName('tool with spaces')).toBe(false);
        expect(isValidToolName('tool#special!')).toBe(false);
        expect(isValidToolName('tool$var')).toBe(false);
        expect(isValidToolName('a'.repeat(129))).toBe(false);
        // @ts-expect-error test non-string input
        expect(isValidToolName(null)).toBe(false);
      });
    });

    describe('sanitizeIdentifier', () => {
      it('replaces dots, hashes, dashes and illegal chars with underscores', () => {
        expect(sanitizeIdentifier('com.example.notes')).toBe('com_example_notes');
        expect(sanitizeIdentifier('NotesService#createNote')).toBe('NotesService_createNote');
        expect(sanitizeIdentifier('my-custom-app.service')).toBe('my_custom_app_service');
        expect(sanitizeIdentifier('com.test.pkg$InnerClass#fn')).toBe('com_test_pkg_InnerClass_fn');
      });

      it('collapses multiple consecutive underscores and trims leading/trailing', () => {
        expect(sanitizeIdentifier('__com...example___notes__')).toBe('com_example_notes');
      });

      it('handles empty and whitespace strings', () => {
        expect(sanitizeIdentifier('')).toBe('');
        expect(sanitizeIdentifier('   ')).toBe('');
      });
    });

    describe('sanitizeToolName', () => {
      it('sanitizes tool names while preserving valid ASCII characters', () => {
        expect(sanitizeToolName('android__com_example_notes__createNote')).toBe(
          'android__com_example_notes__createNote'
        );
        expect(sanitizeToolName('android.tool-v1_name')).toBe('android.tool-v1_name');
      });

      it('replaces forbidden characters with underscores', () => {
        expect(sanitizeToolName('android::com.example/tool#fn')).toBe('android__com.example_tool_fn');
      });

      it('truncates to maximum 128 characters', () => {
        const longName = 'android__' + 'a'.repeat(200);
        const sanitized = sanitizeToolName(longName);
        expect(sanitized.length).toBe(MAX_TOOL_NAME_LENGTH);
        expect(isValidToolName(sanitized)).toBe(true);
      });

      it('returns fallback for empty inputs', () => {
        expect(sanitizeToolName('')).toBe('android__tool');
        // @ts-expect-error testing invalid type
        expect(sanitizeToolName(undefined)).toBe('android__tool');
      });
    });

    describe('formatToolName', () => {
      it('formats name from package and function identifier', () => {
        const name = formatToolName('com.example.notes', 'NotesService#createNote');
        expect(name).toBe('android__com_example_notes__NotesService_createNote');
        expect(isValidToolName(name)).toBe(true);
      });

      it('formats name directly from AppFunctionDefinition object', () => {
        const def: AppFunctionDefinition = {
          packageName: 'com.google.android.calculator',
          functionId: 'CalculatorService#add',
          parameters: [],
        };
        const name = formatToolName(def);
        expect(name).toBe('android__com_google_android_calculator__CalculatorService_add');
        expect(isValidToolName(name)).toBe(true);
      });

      it('strips redundant package name prefix if present in functionId', () => {
        const name = formatToolName(
          'com.example.mail',
          'com.example.mail.MailService#sendMail'
        );
        expect(name).toBe('android__com_example_mail__MailService_sendMail');
      });

      it('supports custom prefix overrides', () => {
        const name = formatToolName('com.example.notes', 'createNote', 'custom__');
        expect(name).toBe('custom__com_example_notes__createNote');
      });

      it('handles missing package or function gracefully', () => {
        expect(formatToolName('', 'createNote')).toBe('android__createNote');
        expect(formatToolName('com.example.notes', '')).toBe('android__com_example_notes');
        expect(formatToolName('', '')).toBe('android__tool');
      });
    });

    describe('parseToolName', () => {
      it('parses valid formatted Android WebMCP tool name into package and function', () => {
        const parsed = parseToolName('android__com_example_notes__NotesService_createNote');
        expect(parsed.isAndroidTool).toBe(true);
        expect(parsed.packageName).toBe('com_example_notes');
        expect(parsed.functionId).toBe('NotesService_createNote');
        expect(parsed.className).toBe('NotesService');
        expect(parsed.methodName).toBe('createNote');
      });

      it('parses simple function names without class separation', () => {
        const parsed = parseToolName('android__com_example_notes__createNote');
        expect(parsed.isAndroidTool).toBe(true);
        expect(parsed.packageName).toBe('com_example_notes');
        expect(parsed.functionId).toBe('createNote');
        expect(parsed.methodName).toBe('createNote');
      });

      it('handles non-prefixed or empty tool names', () => {
        const parsed = parseToolName('custom_tool');
        expect(parsed.isAndroidTool).toBe(false);
        expect(parsed.functionId).toBe('custom_tool');
      });
    });

    describe('formatToolTitle', () => {
      it('formats title from className and methodName', () => {
        const def: AppFunctionDefinition = {
          packageName: 'com.example.notes',
          functionId: 'NotesService#createNote',
          className: 'NotesService',
          methodName: 'createNote',
          parameters: [],
        };
        expect(formatToolTitle(def)).toBe('NotesService.createNote');
      });

      it('formats title from methodName and packageName when className is missing', () => {
        const def: AppFunctionDefinition = {
          packageName: 'com.example.notes',
          functionId: 'createNote',
          methodName: 'createNote',
          parameters: [],
        };
        expect(formatToolTitle(def)).toBe('createNote (com.example.notes)');
      });

      it('formats title by replacing hash with dot in functionId', () => {
        const def: AppFunctionDefinition = {
          packageName: 'com.example.notes',
          functionId: 'Notes#getNotes',
          parameters: [],
        };
        expect(formatToolTitle(def)).toBe('Notes.getNotes');
      });
    });
  });

  describe('Data Type Mapping to JSON Schema', () => {
    describe('mapDataTypeToJsonSchemaType', () => {
      it('maps String to JSON Schema string', () => {
        expect(mapDataTypeToJsonSchemaType('string')).toEqual({ type: 'string' });
      });

      it('maps Int to JSON Schema integer', () => {
        expect(mapDataTypeToJsonSchemaType('int')).toEqual({ type: 'integer' });
      });

      it('maps Long to JSON Schema integer with int64 format', () => {
        expect(mapDataTypeToJsonSchemaType('long')).toEqual({
          type: 'integer',
          format: 'int64',
        });
      });

      it('maps Float to JSON Schema number with float format', () => {
        expect(mapDataTypeToJsonSchemaType('float')).toEqual({
          type: 'number',
          format: 'float',
        });
      });

      it('maps Double to JSON Schema number with double format', () => {
        expect(mapDataTypeToJsonSchemaType('double')).toEqual({
          type: 'number',
          format: 'double',
        });
      });

      it('maps Boolean to JSON Schema boolean', () => {
        expect(mapDataTypeToJsonSchemaType('boolean')).toEqual({ type: 'boolean' });
      });

      it('maps Bytes to JSON Schema string with byte format', () => {
        expect(mapDataTypeToJsonSchemaType('bytes')).toEqual({
          type: 'string',
          format: 'byte',
        });
      });

      it('maps Array to JSON Schema array', () => {
        expect(mapDataTypeToJsonSchemaType('array')).toEqual({ type: 'array' });
      });

      it('maps Object to JSON Schema object', () => {
        expect(mapDataTypeToJsonSchemaType('object')).toEqual({ type: 'object' });
      });

      it('maps Unit/void to JSON Schema null', () => {
        expect(mapDataTypeToJsonSchemaType('unit')).toEqual({ type: 'null' });
      });

      it('maps unknown types to JSON Schema string as safe fallback', () => {
        expect(mapDataTypeToJsonSchemaType('unknown')).toEqual({ type: 'string' });
      });
    });
  });

  describe('Parameter and Schema Mapping', () => {
    describe('mapParameterToJsonSchema', () => {
      it('maps primitive string parameter with description and default value', () => {
        const param: AppFunctionParameter = {
          name: 'title',
          dataType: 'string',
          description: 'Title of the note',
          isRequired: true,
          defaultValue: 'Untitled',
        };

        const schema = mapParameterToJsonSchema(param);
        expect(schema).toEqual({
          type: 'string',
          description: 'Title of the note',
          default: 'Untitled',
        });
      });

      it('maps array parameter with typed item schema', () => {
        const param: AppFunctionParameter = {
          name: 'tags',
          dataType: 'array',
          description: 'Note tags',
          isRequired: false,
          items: {
            name: 'tag',
            dataType: 'string',
            description: 'Individual tag label',
            isRequired: true,
          },
        };

        const schema = mapParameterToJsonSchema(param);
        expect(schema).toEqual({
          type: 'array',
          description: 'Note tags',
          items: {
            type: 'string',
            description: 'Individual tag label',
          },
        });
      });

      it('maps nested object parameter with required child properties', () => {
        const param: AppFunctionParameter = {
          name: 'author',
          dataType: 'object',
          description: 'Author information',
          isRequired: true,
          properties: {
            userId: {
              name: 'userId',
              dataType: 'long',
              description: 'User ID',
              isRequired: true,
            },
            name: {
              name: 'name',
              dataType: 'string',
              description: 'User display name',
              isRequired: true,
            },
            email: {
              name: 'email',
              dataType: 'string',
              description: 'Email address',
              isRequired: false,
            },
          },
        };

        const schema = mapParameterToJsonSchema(param);
        expect(schema).toEqual({
          type: 'object',
          description: 'Author information',
          properties: {
            userId: {
              type: 'integer',
              format: 'int64',
              description: 'User ID',
            },
            name: {
              type: 'string',
              description: 'User display name',
            },
            email: {
              type: 'string',
              description: 'Email address',
            },
          },
          required: ['userId', 'name'],
        });
      });

      it('handles array of objects', () => {
        const param: AppFunctionParameter = {
          name: 'attachments',
          dataType: 'array',
          isRequired: false,
          items: {
            name: 'attachment',
            dataType: 'object',
            isRequired: true,
            properties: {
              uri: {
                name: 'uri',
                dataType: 'string',
                isRequired: true,
              },
              size: {
                name: 'size',
                dataType: 'int',
                isRequired: false,
              },
            },
          },
        };

        const schema = mapParameterToJsonSchema(param);
        expect(schema.type).toBe('array');
        expect(schema.items?.type).toBe('object');
        expect(schema.items?.properties?.uri.type).toBe('string');
        expect(schema.items?.properties?.size.type).toBe('integer');
        expect(schema.items?.required).toEqual(['uri']);
      });
    });

    describe('mapParametersToInputSchema', () => {
      it('creates root JSON schema with properties and required list', () => {
        const params: AppFunctionParameter[] = [
          {
            name: 'query',
            dataType: 'string',
            description: 'Search keyword',
            isRequired: true,
          },
          {
            name: 'limit',
            dataType: 'int',
            description: 'Max results',
            isRequired: false,
            defaultValue: 10,
          },
          {
            name: 'includeArchived',
            dataType: 'boolean',
            isRequired: false,
            defaultValue: false,
          },
        ];

        const schema = mapParametersToInputSchema(params, 'Search filter options');
        expect(schema).toEqual({
          type: 'object',
          description: 'Search filter options',
          properties: {
            query: {
              type: 'string',
              description: 'Search keyword',
            },
            limit: {
              type: 'integer',
              description: 'Max results',
              default: 10,
            },
            includeArchived: {
              type: 'boolean',
              default: false,
            },
          },
          required: ['query'],
        });
      });

      it('omits required array if no parameters are required', () => {
        const params: AppFunctionParameter[] = [
          {
            name: 'filter',
            dataType: 'string',
            isRequired: false,
          },
        ];

        const schema = mapParametersToInputSchema(params);
        expect(schema.type).toBe('object');
        expect(schema.properties.filter.type).toBe('string');
        expect(schema.required).toBeUndefined();
      });

      it('handles empty parameter list', () => {
        const schema = mapParametersToInputSchema([]);
        expect(schema).toEqual({
          type: 'object',
          properties: {},
        });
        expect(schema.required).toBeUndefined();
      });
    });

    describe('mapResponseToJsonSchema', () => {
      it('maps structured object response', () => {
        const response: AppFunctionResponse = {
          dataType: 'object',
          description: 'Created note response',
          properties: {
            noteId: {
              name: 'noteId',
              dataType: 'long',
              isRequired: true,
            },
            success: {
              name: 'success',
              dataType: 'boolean',
              isRequired: true,
            },
          },
        };

        const schema = mapResponseToJsonSchema(response);
        expect(schema).toEqual({
          type: 'object',
          description: 'Created note response',
          properties: {
            noteId: {
              type: 'integer',
              format: 'int64',
            },
            success: {
              type: 'boolean',
            },
          },
          required: ['noteId', 'success'],
        });
      });

      it('returns undefined for undefined response', () => {
        expect(mapResponseToJsonSchema(undefined)).toBeUndefined();
      });
    });

    describe('inferToolAnnotations', () => {
      it('infers readOnlyHint for get, query, list, search methods', () => {
        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'getNotes',
            parameters: [],
          })
        ).toEqual({ readOnlyHint: true });

        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'NotesService#queryNotes',
            parameters: [],
          })
        ).toEqual({ readOnlyHint: true });

        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'list_items',
            parameters: [],
          })
        ).toEqual({ readOnlyHint: true });

        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'searchContacts',
            parameters: [],
          })
        ).toEqual({ readOnlyHint: true });
      });

      it('does not set readOnlyHint for write/action methods', () => {
        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'createNote',
            parameters: [],
          })
        ).toEqual({});

        expect(
          inferToolAnnotations({
            packageName: 'com.example.notes',
            functionId: 'deleteNote',
            parameters: [],
          })
        ).toEqual({});

        expect(
          inferToolAnnotations({
            packageName: 'com.example.mail',
            functionId: 'sendMail',
            parameters: [],
          })
        ).toEqual({});
      });
    });
  });

  describe('mapAppFunctionToWebMcpTool (ModelContextTool Compatibility)', () => {
    it('maps AppFunctionDefinition to a fully compliant WebMCP ModelContextTool', () => {
      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#createNote',
        className: 'NotesService',
        methodName: 'createNote',
        description: 'Creates a new note on the device.',
        parameters: [
          {
            name: 'title',
            dataType: 'string',
            description: 'Title of the note',
            isRequired: true,
          },
          {
            name: 'content',
            dataType: 'string',
            description: 'Body of the note',
            isRequired: true,
          },
          {
            name: 'pinned',
            dataType: 'boolean',
            description: 'Whether to pin the note',
            isRequired: false,
            defaultValue: false,
          },
        ],
        response: {
          dataType: 'long',
          description: 'ID of the created note',
        },
      };

      const mockExecute = vi.fn().mockResolvedValue({ noteId: 101 });
      const tool = mapAppFunctionToWebMcpTool(def, { execute: mockExecute });

      expect(tool.name).toBe('android__com_example_notes__NotesService_createNote');
      expect(tool.title).toBe('NotesService.createNote');
      expect(tool.description).toBe('Creates a new note on the device.');
      expect(tool.inputSchema).toEqual({
        type: 'object',
        description: 'Creates a new note on the device.',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the note',
          },
          content: {
            type: 'string',
            description: 'Body of the note',
          },
          pinned: {
            type: 'boolean',
            description: 'Whether to pin the note',
            default: false,
          },
        },
        required: ['title', 'content'],
      });
      expect(tool.execute).toBe(mockExecute);
      expect(isValidToolName(tool.name)).toBe(true);
    });

    it('accepts execute callback passed directly as second argument', async () => {
      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'listNotes',
        parameters: [],
      };

      const mockExecute = vi.fn().mockResolvedValue(['note 1', 'note 2']);
      const tool = mapAppFunctionToWebMcpTool(def, mockExecute);

      expect(tool.execute).toBe(mockExecute);
      expect(tool.annotations?.readOnlyHint).toBe(true);

      const result = await tool.execute({}, { signal: new AbortController().signal });
      expect(result).toEqual(['note 1', 'note 2']);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('falls back to default execute handler that throws descriptive error', async () => {
      const def: AppFunctionDefinition = {
        packageName: 'com.example.timer',
        functionId: 'startTimer',
        parameters: [],
      };

      const tool = mapAppFunctionToWebMcpTool(def);
      await expect(
        tool.execute({ duration: 60 }, { signal: new AbortController().signal })
      ).rejects.toThrow("Execution handler not configured for tool 'android__com_example_timer__startTimer'");
    });

    it('batch maps array of AppFunctionDefinitions via mapAppFunctionsToWebMcpTools', () => {
      const functions: AppFunctionDefinition[] = [
        {
          packageName: 'com.example.notes',
          functionId: 'createNote',
          parameters: [{ name: 'title', dataType: 'string', isRequired: true }],
        },
        {
          packageName: 'com.example.notes',
          functionId: 'getNotes',
          parameters: [],
        },
      ];

      const tools = mapAppFunctionsToWebMcpTools(functions);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('android__com_example_notes__createNote');
      expect(tools[1].name).toBe('android__com_example_notes__getNotes');
      expect(tools[1].annotations?.readOnlyHint).toBe(true);
    });
  });
});
