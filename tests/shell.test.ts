/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { execShell, AdbTimeoutError, AdbAbortError } from '../src/transport/shell';
import { Stream } from '../src/transport/wadb/lib/Stream';
import { Message } from '../src/transport/wadb/lib/message/Message';
import { AdbClient } from '../src/transport/wadb/lib/AdbClient';
import { Options } from '../src/transport/wadb/lib/Options';

describe('Shell Execution Engine', () => {
  const mockOptions: Options = {
    debug: false,
    dump: false,
    useChecksum: true,
    keySize: 2048,
  };

  it('instantiates AdbTimeoutError with expected properties', () => {
    const err = new AdbTimeoutError('cmd test', 5000);
    expect(err.name).toBe('AdbTimeoutError');
    expect(err.code).toBe('COMMAND_TIMEOUT');
    expect(err.message).toContain('timed out after 5000ms');
  });

  it('instantiates AdbAbortError with expected properties', () => {
    const err = new AdbAbortError('cmd test');
    expect(err.name).toBe('AdbAbortError');
    expect(err.code).toBe('COMMAND_ABORTED');
    expect(err.message).toContain('was aborted');
  });

  it('rejects immediately if AbortSignal is already aborted', async () => {
    const mockAdbClient = {} as AdbClient;
    const controller = new AbortController();
    controller.abort();

    await expect(
      execShell(mockAdbClient, 'cmd app_function list-app-functions', {
        signal: controller.signal,
      })
    ).rejects.toThrow(AdbAbortError);
  });

  it('executes shell command and parses successful output', async () => {
    const mockClient = {
      options: mockOptions,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      unregisterStream: vi.fn(),
    } as unknown as AdbClient;

    const mockStream = {
      localId: 1,
      remoteId: 2,
      client: mockClient,
      read: vi
        .fn()
        .mockResolvedValueOnce({
          header: { cmd: 'WRTE' },
          dataAsString: () => '{"functions": []}',
        } as unknown as Message)
        .mockResolvedValueOnce({
          header: { cmd: 'CLSE' },
        } as unknown as Message),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Stream;

    vi.spyOn(Stream, 'open').mockResolvedValue(mockStream);

    const result = await execShell(mockClient, 'cmd app_function list-app-functions');

    expect(result).toEqual({
      stdout: '{"functions": []}',
      stderr: '',
      exitCode: 0,
      raw: '{"functions": []}',
    });
    expect(mockClient.sendMessage).toHaveBeenCalled();
  });

  it('captures error output correctly', async () => {
    const mockClient = {
      options: mockOptions,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      unregisterStream: vi.fn(),
    } as unknown as AdbClient;

    const errorOutput = 'Error: SecurityException: Package not allowed to query AppFunctions';
    const mockStream = {
      localId: 1,
      remoteId: 2,
      client: mockClient,
      read: vi
        .fn()
        .mockResolvedValueOnce({
          header: { cmd: 'WRTE' },
          dataAsString: () => errorOutput,
        } as unknown as Message)
        .mockResolvedValueOnce({
          header: { cmd: 'CLSE' },
        } as unknown as Message),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Stream;

    vi.spyOn(Stream, 'open').mockResolvedValue(mockStream);

    const result = await execShell(mockClient, 'cmd app_function execute-app-function ...');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(errorOutput);
    expect(result.stdout).toBe('');
    expect(result.raw).toBe(errorOutput);
  });

  it('handles execution timeout and closes stream', async () => {
    const mockClient = {
      options: mockOptions,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      unregisterStream: vi.fn(),
    } as unknown as AdbClient;

    const mockStream = {
      localId: 1,
      remoteId: 2,
      client: mockClient,
      read: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Stream;

    vi.spyOn(Stream, 'open').mockResolvedValue(mockStream);

    await expect(
      execShell(mockClient, 'cmd app_function hanging-command', {
        timeoutMs: 50,
      })
    ).rejects.toThrow(AdbTimeoutError);

    expect(mockStream.close).toHaveBeenCalled();
  });

  it('handles AbortSignal abort during active execution', async () => {
    const mockClient = {
      options: mockOptions,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      unregisterStream: vi.fn(),
    } as unknown as AdbClient;

    const mockStream = {
      localId: 1,
      remoteId: 2,
      client: mockClient,
      read: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Stream;

    vi.spyOn(Stream, 'open').mockResolvedValue(mockStream);

    const controller = new AbortController();

    const execPromise = execShell(mockClient, 'cmd long-command', {
      signal: controller.signal,
      timeoutMs: 5000,
    });

    setTimeout(() => {
      controller.abort();
    }, 20);

    await expect(execPromise).rejects.toThrow(AdbAbortError);
    expect(mockStream.close).toHaveBeenCalled();
  });
});
