/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppFunctionsDiscovery } from '../src/android/discovery';
import { AdbManager } from '../src/transport/adb-client';
import { ShellResult } from '../src/types/adb';

describe('AppFunctionsDiscovery', () => {
  let mockAdbManager: AdbManager;

  beforeEach(() => {
    mockAdbManager = {
      isConnected: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('ready'),
      execShell: vi.fn(),
    } as unknown as AdbManager;
  });

  describe('buildCommand', () => {
    it('generates base command without package argument', () => {
      expect(AppFunctionsDiscovery.buildCommand()).toBe('cmd app_function list-app-functions');
      expect(AppFunctionsDiscovery.buildCommand('')).toBe('cmd app_function list-app-functions');
      expect(AppFunctionsDiscovery.buildCommand('   ')).toBe('cmd app_function list-app-functions');
    });

    it('generates command with shell-escaped package argument', () => {
      expect(AppFunctionsDiscovery.buildCommand('com.example.notes')).toBe(
        "cmd app_function list-app-functions --package 'com.example.notes'"
      );
    });

    it('properly escapes package names with special characters or quotes', () => {
      expect(AppFunctionsDiscovery.buildCommand("com.example.app's")).toBe(
        "cmd app_function list-app-functions --package 'com.example.app'\\''s'"
      );
    });
  });

  describe('discover', () => {
    it('throws an error if ADB connection is not ready', async () => {
      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);
      vi.mocked(mockAdbManager.getState).mockReturnValue('disconnected');

      const discovery = new AppFunctionsDiscovery(mockAdbManager);

      await expect(discovery.discover()).rejects.toThrow(
        'Cannot discover AppFunctions: ADB connection is not ready'
      );
      expect(mockAdbManager.execShell).not.toHaveBeenCalled();
    });

    it('returns AdbManager via getAdbManager', () => {
      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      expect(discovery.getAdbManager()).toBe(mockAdbManager);
    });

    it('executes list-app-functions command and parses discovered functions', async () => {
      const rawJson = JSON.stringify([
        {
          package: 'com.example.notes',
          function: 'NotesService#createNote',
          description: 'Create a new note',
          parameters: [{ name: 'title', type: 'String', required: true }],
          response: { type: 'Long' },
        },
        {
          package: 'com.example.mail',
          function: 'MailService#sendMail',
          description: 'Send an email',
          parameters: [
            { name: 'recipient', type: 'String', required: true },
            { name: 'subject', type: 'String', required: false },
          ],
        },
      ]);

      const mockShellResult: ShellResult = {
        stdout: rawJson,
        stderr: '',
        exitCode: 0,
        raw: rawJson,
      };

      vi.mocked(mockAdbManager.execShell).mockResolvedValue(mockShellResult);

      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      const result = await discovery.discover();

      expect(mockAdbManager.execShell).toHaveBeenCalledWith('cmd app_function list-app-functions', {
        timeoutMs: undefined,
        signal: undefined,
      });

      expect(result.totalCount).toBe(2);
      expect(result.packageCount).toBe(2);
      expect(result.packages).toEqual(['com.example.mail', 'com.example.notes']);
      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].packageName).toBe('com.example.notes');
      expect(result.functions[0].functionId).toBe('NotesService#createNote');
      expect(result.functions[0].className).toBe('NotesService');
      expect(result.functions[0].methodName).toBe('createNote');
      expect(result.functions[0].parameters).toHaveLength(1);
      expect(result.functions[1].packageName).toBe('com.example.mail');
      expect(result.functions[1].methodName).toBe('sendMail');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('applies package-level filter when packageName option is provided', async () => {
      const rawJson = JSON.stringify([
        {
          package: 'com.example.notes',
          function: 'NotesService#createNote',
        },
      ]);

      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: rawJson,
        stderr: '',
        exitCode: 0,
        raw: rawJson,
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      const result = await discovery.discover({ packageName: 'com.example.notes' });

      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        "cmd app_function list-app-functions --package 'com.example.notes'",
        expect.anything()
      );
      expect(result.functions).toHaveLength(1);
      expect(result.packages).toEqual(['com.example.notes']);
    });

    it('extracts packages and groups functions when Android 16 CLI omits top-level package field', async () => {
      const rawJson = JSON.stringify([
        {
          id: 'me.bandarra.example.todo.appfunctions.BaseTodoAppFunctionService#createTask',
          description: 'Create a task',
          parameters: [{ name: 'task', type: 'String' }],
        },
        {
          id: 'me.bandarra.example.todo.appfunctions.BaseTodoAppFunctionService#getTasks',
          description: 'Get tasks',
          parameters: [],
        },
        {
          id: 'com.example.calendar.CalendarService#addEvent',
          description: 'Add event',
          parameters: [],
        },
      ]);

      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: rawJson,
        stderr: '',
        exitCode: 0,
        raw: rawJson,
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      const result = await discovery.discover();

      expect(result.totalCount).toBe(3);
      expect(result.packageCount).toBe(2);
      expect(result.packages).toEqual([
        'com.example.calendar',
        'me.bandarra.example.todo.appfunctions',
      ]);
      expect(result.functions[0].packageName).toBe(
        'me.bandarra.example.todo.appfunctions'
      );
      expect(result.functions[1].packageName).toBe(
        'me.bandarra.example.todo.appfunctions'
      );
      expect(result.functions[2].packageName).toBe('com.example.calendar');
    });

    it('handles SecurityException with a friendly permission error', async () => {
      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: '',
        stderr: 'Error: SecurityException: Package not allowed to query AppFunctions',
        exitCode: 1,
        raw: 'Error: SecurityException: Package not allowed to query AppFunctions',
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);

      await expect(discovery.discover()).rejects.toThrow(
        'Permission denied querying AppFunctions'
      );
    });

    it('handles Unknown command with friendly unsupported device error', async () => {
      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: '',
        stderr: 'Unknown command: app_function',
        exitCode: 1,
        raw: 'Unknown command: app_function',
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);

      await expect(discovery.discover()).rejects.toThrow(
        'AppFunctions service not available on this Android device (requires Android 16+ / API 36+)'
      );
    });

    it('handles general stderr failure', async () => {
      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: '',
        stderr: 'Service temporarily unavailable',
        exitCode: 1,
        raw: 'Service temporarily unavailable',
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);

      await expect(discovery.discover()).rejects.toThrow(
        'Failed to list AppFunctions: Service temporarily unavailable'
      );
    });

    it('passes timeoutMs and signal to AdbManager.execShell', async () => {
      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
        raw: '[]',
      });

      const controller = new AbortController();
      const discovery = new AppFunctionsDiscovery(mockAdbManager);

      await discovery.discover({
        timeoutMs: 5000,
        signal: controller.signal,
      });

      expect(mockAdbManager.execShell).toHaveBeenCalledWith('cmd app_function list-app-functions', {
        timeoutMs: 5000,
        signal: controller.signal,
      });
    });
  });

  describe('discoverByPackage', () => {
    it('calls discover with target packageName', async () => {
      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
        raw: '[]',
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      await discovery.discoverByPackage('com.example.calculator', { timeoutMs: 3000 });

      expect(mockAdbManager.execShell).toHaveBeenCalledWith(
        "cmd app_function list-app-functions --package 'com.example.calculator'",
        {
          timeoutMs: 3000,
          signal: undefined,
        }
      );
    });
  });

  describe('listPackages', () => {
    it('returns an array of unique discovered packages', async () => {
      const rawJson = JSON.stringify([
        { package: 'com.example.notes', function: 'Notes#fn1' },
        { package: 'com.example.notes', function: 'Notes#fn2' },
        { package: 'com.example.alarm', function: 'Alarm#set' },
      ]);

      vi.mocked(mockAdbManager.execShell).mockResolvedValue({
        stdout: rawJson,
        stderr: '',
        exitCode: 0,
        raw: rawJson,
      });

      const discovery = new AppFunctionsDiscovery(mockAdbManager);
      const packages = await discovery.listPackages();

      expect(packages).toEqual(['com.example.alarm', 'com.example.notes']);
    });
  });
});
