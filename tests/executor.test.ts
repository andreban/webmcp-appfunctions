/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AppFunctionsExecutor,
  AppFunctionExecutionError,
  parseExecutionOutput,
} from '../src/android/executor';
import { AdbManager } from '../src/transport/adb-client';
import { AdbAbortError, AdbTimeoutError } from '../src/transport/shell';
import { AppFunctionDefinition } from '../src/types/appfunctions';
import { ShellResult } from '../src/types/adb';
import { WebMcpBridge } from '../src/webmcp/bridge';

describe('AppFunctionsExecutor', () => {
  let mockAdbManager: AdbManager;

  beforeEach(() => {
    mockAdbManager = {
      isConnected: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('ready'),
      execShell: vi.fn(),
      onDisconnect: vi.fn().mockReturnValue(() => {}),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    } as unknown as AdbManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildCommand', () => {
    it('throws when package name is empty or missing', () => {
      expect(() =>
        AppFunctionsExecutor.buildCommand('', 'NotesService#createNote')
      ).toThrow('Package name is required to execute an AppFunction.');

      expect(() =>
        AppFunctionsExecutor.buildCommand('   ', 'NotesService#createNote')
      ).toThrow('Package name is required to execute an AppFunction.');
    });

    it('throws when function ID is empty or missing', () => {
      expect(() =>
        AppFunctionsExecutor.buildCommand('com.example.notes', '')
      ).toThrow('Function identifier is required to execute an AppFunction.');

      expect(() =>
        AppFunctionsExecutor.buildCommand('com.example.notes', '   ')
      ).toThrow('Function identifier is required to execute an AppFunction.');
    });

    it('constructs shell command with escaped package, function, and parameters', () => {
      const command = AppFunctionsExecutor.buildCommand(
        'com.example.notes',
        'NotesService#createNote',
        { title: 'Shopping', content: 'Buy milk' }
      );

      expect(command).toBe(
        "cmd app_function execute-app-function --package 'com.example.notes' --function 'NotesService#createNote' --parameters '{\"title\":\"Shopping\",\"content\":\"Buy milk\"}'"
      );
    });

    it('handles empty or null parameters gracefully by serializing to empty object', () => {
      const command1 = AppFunctionsExecutor.buildCommand(
        'com.example.notes',
        'NotesService#getNotes',
        null
      );
      expect(command1).toBe(
        "cmd app_function execute-app-function --package 'com.example.notes' --function 'NotesService#getNotes' --parameters '{}'"
      );

      const command2 = AppFunctionsExecutor.buildCommand(
        'com.example.notes',
        'NotesService#getNotes'
      );
      expect(command2).toBe(
        "cmd app_function execute-app-function --package 'com.example.notes' --function 'NotesService#getNotes' --parameters '{}'"
      );
    });

    it('safely escapes package, function, and parameter strings with single quotes and special chars', () => {
      const command = AppFunctionsExecutor.buildCommand(
        "com.example.app's",
        "Service's#action's",
        { query: "Doctor's note & $(whoami)" }
      );

      expect(command).toContain("'com.example.app'\\''s'");
      expect(command).toContain("'Service'\\''s#action'\\''s'");
      expect(command).toContain("'\\''");
    });
  });

  describe('buildSetEnabledCommand', () => {
    it('throws when package or function is missing', () => {
      expect(() =>
        AppFunctionsExecutor.buildSetEnabledCommand('', 'func', 'enable')
      ).toThrow('Package name is required');
      expect(() =>
        AppFunctionsExecutor.buildSetEnabledCommand('pkg', '', 'enable')
      ).toThrow('Function identifier is required');
    });

    it('builds set-enabled command with valid arguments', () => {
      const cmd = AppFunctionsExecutor.buildSetEnabledCommand(
        'com.example.notes',
        'NotesService#createNote',
        'enable'
      );
      expect(cmd).toBe(
        "cmd app_function set-enabled --package 'com.example.notes' --function 'NotesService#createNote' --state 'enable'"
      );
    });
  });

  describe('parseExecutionOutput', () => {
    it('returns success: true and data: null for empty or whitespace output', () => {
      expect(parseExecutionOutput('')).toEqual({
        success: true,
        data: null,
      });
      expect(parseExecutionOutput('   \n  \t ')).toEqual({
        success: true,
        data: null,
      });
    });

    it('parses valid JSON response objects', () => {
      const output = JSON.stringify({
        noteId: 104,
        title: 'Grocery List',
      });
      const parsed = parseExecutionOutput(output);
      expect(parsed).toEqual({
        success: true,
        data: {
          noteId: 104,
          title: 'Grocery List',
        },
      });
    });

    it('unwraps result property if present in object payload', () => {
      const output = JSON.stringify({
        result: 42,
      });
      const parsed = parseExecutionOutput(output);
      expect(parsed).toEqual({
        success: true,
        data: 42,
      });
    });

    it('parses primitive JSON values: booleans, numbers, strings, arrays', () => {
      expect(parseExecutionOutput('true')).toEqual({
        success: true,
        data: true,
      });
      expect(parseExecutionOutput('12345')).toEqual({
        success: true,
        data: 12345,
      });
      expect(parseExecutionOutput('"Operation completed"')).toEqual({
        success: true,
        data: 'Operation completed',
      });
      expect(parseExecutionOutput('[1, 2, 3]')).toEqual({
        success: true,
        data: [1, 2, 3],
      });
    });

    it('detects explicit failure indicators in JSON: success: false', () => {
      const output = JSON.stringify({
        success: false,
        error: 'Note not found with id 104',
      });
      const parsed = parseExecutionOutput(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Note not found with id 104');
    });

    it('detects errorMessage property in JSON', () => {
      const output = JSON.stringify({
        errorMessage: 'Invalid parameters provided',
        errorCode: 400,
      });
      const parsed = parseExecutionOutput(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Invalid parameters provided');
    });

    it('detects status: "ERROR" or "FAILED" in JSON', () => {
      const output = JSON.stringify({
        status: 'ERROR',
        message: 'Database query failed',
      });
      const parsed = parseExecutionOutput(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Database query failed');
    });

    it('detects CLI error strings and Android runtime exceptions', () => {
      expect(
        parseExecutionOutput("Error: Package 'com.example.fake' not found")
      ).toEqual({
        success: false,
        error: "Error: Package 'com.example.fake' not found",
      });

      expect(
        parseExecutionOutput(
          'java.lang.SecurityException: Caller lacks permission'
        )
      ).toEqual({
        success: false,
        error: 'java.lang.SecurityException: Caller lacks permission',
      });

      expect(
        parseExecutionOutput("Unknown command: execute-app-function")
      ).toEqual({
        success: false,
        error: 'Unknown command: execute-app-function',
      });
    });

    it('strips ANSI terminal escape codes from output before parsing', () => {
      const ansiOutput = '\u001b[32m{"result": "Success"}\u001b[0m';
      const parsed = parseExecutionOutput(ansiOutput);
      expect(parsed).toEqual({
        success: true,
        data: 'Success',
      });
    });

    it('extracts JSON when output is surrounded by logs or debug headers', () => {
      const noisyOutput =
        'D/AppFunctions: Dispatched\n{"noteId": 42, "created": true}\nI/AppFunctions: Done';
      const parsed = parseExecutionOutput(noisyOutput);
      expect(parsed).toEqual({
        success: true,
        data: {
          noteId: 42,
          created: true,
        },
      });
    });
  });

  describe('execute', () => {
    it('throws AppFunctionExecutionError if ADB connection is not ready', async () => {
      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);
      vi.mocked(mockAdbManager.getState).mockReturnValue('disconnected');

      const executor = new AppFunctionsExecutor(mockAdbManager);

      await expect(
        executor.execute('com.example.notes', 'NotesService#createNote')
      ).rejects.toThrow(
        "Cannot execute AppFunction 'NotesService#createNote': ADB connection is not ready"
      );
      expect(mockAdbManager.execShell).not.toHaveBeenCalled();
    });

    it('executes shell command and returns structured successful result', async () => {
      const mockResult: ShellResult = {
        stdout: JSON.stringify({ success: true, id: 99 }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({ success: true, id: 99 }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const result = await executor.execute(
        'com.example.notes',
        'NotesService#createNote',
        { title: 'New Note' }
      );

      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        "cmd app_function execute-app-function --package 'com.example.notes' --function 'NotesService#createNote' --parameters '{\"title\":\"New Note\"}'",
        {
          timeoutMs: 10000,
          signal: undefined,
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true, id: 99 });
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.rawOutput).toBe(mockResult.raw);
    });

    it('handles stderr and non-zero exit codes with appropriate error messages', async () => {
      const mockResult: ShellResult = {
        stdout: '',
        stderr: 'java.lang.SecurityException: Caller has no permission',
        exitCode: 1,
        raw: 'java.lang.SecurityException: Caller has no permission',
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const result = await executor.execute(
        'com.example.notes',
        'NotesService#createNote'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied executing AppFunction');
      expect(result.error).toContain('java.lang.SecurityException');
    });

    it('handles AppFunctions service errors on device', async () => {
      const mockResult: ShellResult = {
        stdout: '',
        stderr: "cmd: Can't find service: app_function",
        exitCode: 1,
        raw: "cmd: Can't find service: app_function",
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const result = await executor.execute(
        'com.example.notes',
        'NotesService#createNote'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('AppFunctions service error on Android device');
    });

    it('handles JSON error payload in stdout without throwing', async () => {
      const mockResult: ShellResult = {
        stdout: JSON.stringify({
          success: false,
          error: 'Note title cannot be blank',
        }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({
          success: false,
          error: 'Note title cannot be blank',
        }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const result = await executor.execute(
        'com.example.notes',
        'NotesService#createNote',
        { title: '' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Note title cannot be blank');
    });

    it('passes custom timeout and AbortSignal to execShell', async () => {
      const mockResult: ShellResult = {
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        raw: 'true',
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const controller = new AbortController();
      const executor = new AppFunctionsExecutor(mockAdbManager, {
        defaultTimeoutMs: 5000,
      });

      await executor.execute(
        'com.example.notes',
        'NotesService#getNotes',
        {},
        { timeoutMs: 3000, signal: controller.signal }
      );

      expect(mockAdbManager.execShell).toHaveBeenCalledWith(expect.any(String), {
        timeoutMs: 3000,
        signal: controller.signal,
      });
    });

    it('propagates AdbTimeoutError and AdbAbortError directly', async () => {
      vi.mocked(mockAdbManager.execShell).mockRejectedValue(
        new AdbTimeoutError('cmd ...', 5000)
      );

      const executor = new AppFunctionsExecutor(mockAdbManager);

      await expect(
        executor.execute('com.example.notes', 'NotesService#slowTask')
      ).rejects.toThrow(AdbTimeoutError);

      vi.mocked(mockAdbManager.execShell).mockRejectedValue(
        new AdbAbortError('cmd ...')
      );

      await expect(
        executor.execute('com.example.notes', 'NotesService#abortedTask')
      ).rejects.toThrow(AdbAbortError);
    });

    it('executes via executeFunction helper with AppFunctionDefinition', async () => {
      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#createNote',
        parameters: [{ name: 'title', dataType: 'string', isRequired: true }],
      };

      const mockResult: ShellResult = {
        stdout: JSON.stringify({ id: 100 }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({ id: 100 }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const result = await executor.executeFunction(def, { title: 'Test' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 100 });
      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        expect.stringContaining("cmd app_function execute-app-function --package 'com.example.notes' --function 'NotesService#createNote'"),
        expect.any(Object)
      );
    });

    it('sets enabled state via setEnabled and setFunctionEnabled', async () => {
      const mockResult: ShellResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        raw: 'Success',
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);

      const res1 = await executor.setEnabled(
        'com.example.notes',
        'NotesService#createNote',
        'enable'
      );
      expect(res1).toBe(mockResult);
      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        "cmd app_function set-enabled --package 'com.example.notes' --function 'NotesService#createNote' --state 'enable'",
        expect.any(Object)
      );

      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#createNote',
        parameters: [],
      };
      await executor.setFunctionEnabled(def, 'disable');
      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        "cmd app_function set-enabled --package 'com.example.notes' --function 'NotesService#createNote' --state 'disable'",
        expect.any(Object)
      );
    });

    it('returns underlying AdbManager via getAdbManager', () => {
      const executor = new AppFunctionsExecutor(mockAdbManager);
      expect(executor.getAdbManager()).toBe(mockAdbManager);
    });
  });

  describe('createToolExecuteHandler', () => {
    it('creates a WebMCP ToolExecuteCallback that executes and returns data on success', async () => {
      const mockResult: ShellResult = {
        stdout: JSON.stringify({ noteId: 104 }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({ noteId: 104 }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const handler = executor.createToolExecuteHandler(
        'com.example.notes',
        'NotesService#createNote'
      );

      const output = await handler(
        { title: 'Buy milk' },
        { signal: new AbortController().signal }
      );

      expect(output).toEqual({ noteId: 104 });
    });

    it('creates a handler from AppFunctionDefinition', async () => {
      const def: AppFunctionDefinition = {
        packageName: 'com.example.calculator',
        functionId: 'CalculatorService#add',
        parameters: [
          { name: 'a', dataType: 'int', isRequired: true },
          { name: 'b', dataType: 'int', isRequired: true },
        ],
      };

      const mockResult: ShellResult = {
        stdout: JSON.stringify({ result: 42 }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({ result: 42 }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const handler = executor.createToolExecuteHandler(def);

      const output = await handler(
        { a: 20, b: 22 },
        { signal: new AbortController().signal }
      );

      expect(output).toBe(42);
    });

    it('throws AppFunctionExecutionError when execution returns failure', async () => {
      const mockResult: ShellResult = {
        stdout: JSON.stringify({
          success: false,
          error: 'Division by zero',
        }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({
          success: false,
          error: 'Division by zero',
        }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const handler = executor.createToolExecuteHandler(
        'com.example.calculator',
        'CalculatorService#divide'
      );

      await expect(
        handler({ a: 10, b: 0 }, { signal: new AbortController().signal })
      ).rejects.toThrow(AppFunctionExecutionError);

      await expect(
        handler({ a: 10, b: 0 }, { signal: new AbortController().signal })
      ).rejects.toThrow('Division by zero');
    });

    it('forwards AbortSignal to executor and execShell', async () => {
      const controller = new AbortController();
      controller.abort();

      vi.mocked(mockAdbManager.execShell).mockRejectedValue(
        new AdbAbortError('cmd ...')
      );

      const executor = new AppFunctionsExecutor(mockAdbManager);
      const handler = executor.createToolExecuteHandler(
        'com.example.notes',
        'NotesService#createNote'
      );

      await expect(
        handler({ title: 'Test' }, { signal: controller.signal })
      ).rejects.toThrow(AdbAbortError);
    });
  });

  describe('Integration with WebMcpBridge', () => {
    function createMockModelContext(): WebMCP.ModelContext {
      return {
        registerTool: vi.fn().mockResolvedValue(undefined),
        getTools: vi.fn().mockResolvedValue([]),
        ontoolchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn().mockReturnValue(true),
      } as unknown as WebMCP.ModelContext;
    }

    it('automatically wires AppFunctionsExecutor into registered tools when adbManager is attached', async () => {
      const mockModelContext = createMockModelContext();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: mockAdbManager,
        listenToToolChange: false,
      });

      expect(bridge.getExecutor()).toBeDefined();

      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#createNote',
        parameters: [{ name: 'title', dataType: 'string', isRequired: true }],
      };

      const tool = await bridge.registerAppFunction(def);

      const mockResult: ShellResult = {
        stdout: JSON.stringify({ id: 101 }),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify({ id: 101 }),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const output = await tool.execute(
        { title: 'Test Note' },
        { signal: new AbortController().signal }
      );

      expect(output).toEqual({ id: 101 });
      expect(mockAdbManager.execShell).toHaveBeenCalled();
    });

    it('uses custom executor passed in bridge options', async () => {
      const mockModelContext = createMockModelContext();
      const customExecutor = new AppFunctionsExecutor(mockAdbManager);
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        executor: customExecutor,
        listenToToolChange: false,
      });

      expect(bridge.getExecutor()).toBe(customExecutor);

      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#getNotes',
        parameters: [],
      };

      const tool = await bridge.registerAppFunction(def);

      const mockResult: ShellResult = {
        stdout: JSON.stringify(['note1', 'note2']),
        stderr: '',
        exitCode: 0,
        raw: JSON.stringify(['note1', 'note2']),
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockResult);

      const output = await tool.execute({}, { signal: new AbortController().signal });
      expect(output).toEqual(['note1', 'note2']);
    });

    it('allows explicit execute callback to override executor handler', async () => {
      const mockModelContext = createMockModelContext();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: mockAdbManager,
        listenToToolChange: false,
      });

      const def: AppFunctionDefinition = {
        packageName: 'com.example.notes',
        functionId: 'NotesService#createNote',
        parameters: [],
      };

      const customExecute = vi.fn().mockResolvedValue('custom-override');
      const tool = await bridge.registerAppFunction(def, customExecute);

      const output = await tool.execute({}, { signal: new AbortController().signal });
      expect(output).toBe('custom-override');
      expect(customExecute).toHaveBeenCalled();
      expect(mockAdbManager.execShell).not.toHaveBeenCalled();
    });

    it('manages executor lifecycle on attachAdbManager and detachAdbManager', () => {
      const bridge = new WebMcpBridge({ listenToToolChange: false });
      expect(bridge.getExecutor()).toBeNull();

      bridge.attachAdbManager(mockAdbManager);
      expect(bridge.getExecutor()).toBeDefined();

      bridge.detachAdbManager();
      expect(bridge.getExecutor()).toBeNull();
    });
  });
});
