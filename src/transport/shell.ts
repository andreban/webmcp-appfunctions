/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbClient } from './wadb/lib/AdbClient';
import { Stream } from './wadb/lib/Stream';
import { Message } from './wadb/lib/message/Message';
import { ExecOptions, ShellResult } from '../types/adb';
import { logger } from '../utils/logger';

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Custom error class representing an ADB shell command timeout.
 */
export class AdbTimeoutError extends Error {
  readonly code = 'COMMAND_TIMEOUT';

  constructor(command: string, timeoutMs: number) {
    super(`ADB shell command '${command}' timed out after ${timeoutMs}ms.`);
    this.name = 'AdbTimeoutError';
  }
}

/**
 * Custom error class representing an ADB shell command cancellation.
 */
export class AdbAbortError extends Error {
  readonly code = 'COMMAND_ABORTED';

  constructor(command: string) {
    super(`ADB shell command '${command}' was aborted.`);
    this.name = 'AdbAbortError';
  }
}

/**
 * Executes a shell command on the connected Android device over an ADB stream.
 * Supports configurable timeouts and AbortSignal cancellation.
 *
 * @param adbClient The active AdbClient instance.
 * @param command The raw command to execute (e.g. 'cmd app_function list-app-functions').
 * @param options Execution options including timeoutMs and AbortSignal.
 * @returns Structured ShellResult containing stdout, stderr, exitCode, and raw output.
 */
export async function execShell(
  adbClient: AdbClient,
  command: string,
  options: ExecOptions = {}
): Promise<ShellResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal;

  if (signal?.aborted) {
    throw new AdbAbortError(command);
  }

  logger.debug('EXEC', `Executing shell command: ${command}`);

  let stream: Stream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;

  try {
    stream = await Stream.open(adbClient, `shell:${command}`, adbClient.options);
    const okayMessage = Message.newMessage(
      'OKAY',
      stream.localId,
      stream.remoteId,
      adbClient.options.useChecksum
    );

    let rawOutput = '';
    let isCompleted = false;

    // Set up AbortSignal race & Timeout race
    const executionPromise = (async () => {
      let message: Message;
      do {
        message = await stream!.read();
        if (message.header.cmd === 'WRTE') {
          await adbClient.sendMessage(okayMessage);
          const chunk = message.dataAsString() || '';
          rawOutput += chunk;
        }
      } while (message.header.cmd !== 'CLSE');

      isCompleted = true;
      return rawOutput;
    })();

    const promises: Promise<string>[] = [executionPromise];

    // Timeout promise
    if (timeoutMs > 0) {
      const timeoutPromise = new Promise<string>((_, reject) => {
        timer = setTimeout(() => {
          if (!isCompleted) {
            reject(new AdbTimeoutError(command, timeoutMs));
          }
        }, timeoutMs);
      });
      promises.push(timeoutPromise);
    }

    // Abort promise
    if (signal) {
      const abortPromise = new Promise<string>((_, reject) => {
        abortListener = () => {
          if (!isCompleted) {
            reject(new AdbAbortError(command));
          }
        };
        signal.addEventListener('abort', abortListener, { once: true });
      });
      promises.push(abortPromise);
    }

    const resultText = await Promise.race(promises);

    logger.debug('EXEC', `Command finished (${resultText.length} chars output): ${command}`);

    // Parse potential error patterns
    const isError =
      resultText.startsWith('Error:') ||
      resultText.startsWith('Exception:') ||
      resultText.startsWith('Unknown command:') ||
      resultText.includes('java.lang.SecurityException');

    return {
      stdout: isError ? '' : resultText,
      stderr: isError ? resultText : '',
      exitCode: isError ? 1 : 0,
      raw: resultText,
    };
  } catch (err) {
    logger.error('EXEC', `Command execution error on '${command}':`, err);

    // Attempt to close stream on error/abort/timeout
    if (stream) {
      try {
        await stream.close();
      } catch (closeErr) {
        logger.debug('EXEC', 'Error while closing stream after failure:', closeErr);
      }
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
    if (stream) {
      stream.client.unregisterStream(stream);
    }
  }
}
