/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StructuredLogger,
  type LogTag,
  logger,
} from '../src/utils/logger';

describe('StructuredLogger Utility', () => {
  let customLogger: StructuredLogger;

  beforeEach(() => {
    customLogger = new StructuredLogger(50);
  });

  describe('Basic Logging & Log Levels', () => {
    it('creates log entries with correct structure and sequential IDs', () => {
      const entry1 = customLogger.info('APP', 'System started');
      const entry2 = customLogger.debug('USB', 'Device enumerated');

      expect(entry1.id).toBeDefined();
      expect(entry2.id).toBeDefined();
      expect(entry1.id).not.toBe(entry2.id);
      expect(entry1.level).toBe('info');
      expect(entry1.tag).toBe('APP');
      expect(entry1.message).toBe('System started');
      expect(entry1.timestamp).toBeGreaterThan(0);

      expect(entry2.level).toBe('debug');
      expect(entry2.tag).toBe('USB');
      expect(entry2.message).toBe('Device enumerated');
    });

    it('logs messages across all levels: debug, info, warn, error', () => {
      const d = customLogger.debug('ADB', 'Debug message');
      const i = customLogger.info('WebMCP', 'Info message');
      const w = customLogger.warn('EXEC', 'Warning message');
      const e = customLogger.error('USB', 'Error message');

      expect(d.level).toBe('debug');
      expect(i.level).toBe('info');
      expect(w.level).toBe('warn');
      expect(e.level).toBe('error');

      const history = customLogger.getHistory();
      expect(history).toHaveLength(4);
    });

    it('attaches optional structured data payloads to log entries', () => {
      const payload = { deviceId: '12345', status: 'ready', port: 1 };
      const entry = customLogger.info('USB', 'Device connected', payload);

      expect(entry.data).toEqual(payload);
    });
  });

  describe('Source Tagging ([USB], [ADB], [WebMCP], [EXEC], [APP])', () => {
    it('records entries with all valid LogTags', () => {
      const tags: LogTag[] = ['USB', 'ADB', 'WebMCP', 'EXEC', 'APP'];

      for (const tag of tags) {
        const entry = customLogger.info(tag, `Testing tag ${tag}`);
        expect(entry.tag).toBe(tag);
      }

      const history = customLogger.getHistory();
      expect(history).toHaveLength(5);
    });
  });

  describe('Latency & Telemetry Tracking', () => {
    it('attaches latencyMs when provided to log methods', () => {
      const entry = customLogger.info('EXEC', 'AppFunction executed', { noteId: 1 }, 42);

      expect(entry.latencyMs).toBe(42);
    });

    it('tracks latency via trackLatency helper method', () => {
      const entry = customLogger.trackLatency('WebMCP', 'Tool call finished', 150, { ok: true });

      expect(entry.level).toBe('info');
      expect(entry.tag).toBe('WebMCP');
      expect(entry.latencyMs).toBe(150);
      expect(entry.data).toEqual({ ok: true });
    });

    it('computes telemetry metrics correctly across entries', () => {
      expect(customLogger.getMetrics()).toEqual({
        totalLogs: 0,
        errorCount: 0,
        warnCount: 0,
        totalInvocations: 0,
        averageLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        latestLatencyMs: undefined,
      });

      customLogger.info('APP', 'Init');
      customLogger.warn('ADB', 'Warning 1');
      customLogger.error('EXEC', 'Execution failed');
      customLogger.error('USB', 'Disconnect error');

      customLogger.info('EXEC', 'Fn 1', undefined, 100);
      customLogger.info('EXEC', 'Fn 2', undefined, 200);
      customLogger.info('EXEC', 'Fn 3', undefined, 300);

      const metrics = customLogger.getMetrics();
      expect(metrics.totalLogs).toBe(7);
      expect(metrics.errorCount).toBe(2);
      expect(metrics.warnCount).toBe(1);
      expect(metrics.totalInvocations).toBe(3);
      expect(metrics.averageLatencyMs).toBe(200);
      expect(metrics.minLatencyMs).toBe(100);
      expect(metrics.maxLatencyMs).toBe(300);
      expect(metrics.latestLatencyMs).toBe(300);
    });
  });

  describe('Event Listeners & Subscriptions', () => {
    it('notifies log subscribers on new log entries', () => {
      const listener = vi.fn();
      const unsubscribe = customLogger.onLog(listener);

      const entry1 = customLogger.info('USB', 'First');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(entry1);

      const entry2 = customLogger.error('ADB', 'Second');
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(entry2);

      unsubscribe();
      customLogger.info('APP', 'Third');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('handles errors in log listeners gracefully without throwing', () => {
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener crash');
      });
      const goodListener = vi.fn();

      customLogger.onLog(badListener);
      customLogger.onLog(goodListener);

      expect(() => {
        customLogger.info('APP', 'Safe test');
      }).not.toThrow();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    it('notifies clear listeners when clearHistory is invoked', () => {
      const clearListener = vi.fn();
      const unsubscribe = customLogger.onClear(clearListener);

      customLogger.info('APP', 'Test');
      expect(customLogger.getHistory()).toHaveLength(1);

      customLogger.clearHistory();
      expect(clearListener).toHaveBeenCalledTimes(1);
      expect(customLogger.getHistory()).toHaveLength(0);

      unsubscribe();
      customLogger.clearHistory();
      expect(clearListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('History Retention & Capacity Limits', () => {
    it('caps history size to maxHistorySize', () => {
      const smallLogger = new StructuredLogger(5);

      for (let i = 1; i <= 8; i++) {
        smallLogger.info('APP', `Message ${i}`);
      }

      const history = smallLogger.getHistory();
      expect(history).toHaveLength(5);
      expect(history[0].message).toBe('Message 4');
      expect(history[4].message).toBe('Message 8');
    });

    it('dynamically resizes history when setMaxHistorySize is called', () => {
      for (let i = 1; i <= 20; i++) {
        customLogger.info('APP', `Msg ${i}`);
      }

      expect(customLogger.getHistory()).toHaveLength(20);
      customLogger.setMaxHistorySize(10);
      expect(customLogger.getHistory()).toHaveLength(10);
      expect(customLogger.getHistory()[0].message).toBe('Msg 11');
      expect(customLogger.getMaxHistorySize()).toBe(10);
    });
  });

  describe('History Filtering', () => {
    beforeEach(() => {
      customLogger.info('USB', 'USB device ready');
      customLogger.warn('USB', 'USB transfer warning');
      customLogger.debug('ADB', 'ADB ping', { ping: true });
      customLogger.info('WebMCP', 'WebMCP registered note_tool');
      customLogger.error('EXEC', 'Execution failed on NotesService', { code: 500 });
      customLogger.info('APP', 'Bootstrap completed');
    });

    it('filters history by LogTag', () => {
      const usbLogs = customLogger.getHistory({ tag: 'USB' });
      expect(usbLogs).toHaveLength(2);
      expect(usbLogs.every((e) => e.tag === 'USB')).toBe(true);

      const execLogs = customLogger.getHistory({ tag: 'EXEC' });
      expect(execLogs).toHaveLength(1);
      expect(execLogs[0].tag).toBe('EXEC');
    });

    it('filters history by LogLevel', () => {
      const errorLogs = customLogger.getHistory({ level: 'error' });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].message).toContain('Execution failed');

      const infoLogs = customLogger.getHistory({ level: 'info' });
      expect(infoLogs).toHaveLength(3);
    });

    it('filters history by search query matching message, tag, or data', () => {
      const matchMsg = customLogger.getHistory({ search: 'NotesService' });
      expect(matchMsg).toHaveLength(1);
      expect(matchMsg[0].tag).toBe('EXEC');

      const matchData = customLogger.getHistory({ search: 'ping' });
      expect(matchData).toHaveLength(1);
      expect(matchData[0].tag).toBe('ADB');

      const matchTag = customLogger.getHistory({ search: 'webmcp' });
      expect(matchTag).toHaveLength(1);
    });

    it('applies multiple filters simultaneously', () => {
      const combined = customLogger.getHistory({
        tag: 'USB',
        level: 'warn',
      });
      expect(combined).toHaveLength(1);
      expect(combined[0].message).toBe('USB transfer warning');
    });
  });

  describe('Formatting & Text Export', () => {
    it('formats single log entry into readable string with timestamp, tag, level, and latency', () => {
      const entry = customLogger.info('EXEC', 'createNote finished', { id: 99 }, 55);
      const text = customLogger.formatEntry(entry);

      expect(text).toContain('[EXEC]');
      expect(text).toContain('INFO');
      expect(text).toContain('createNote finished');
      expect(text).toContain('(55ms)');
      expect(text).toContain('Data:');
      expect(text).toContain('"id": 99');
    });

    it('exports all log entries as plaintext separated by newlines', () => {
      customLogger.info('USB', 'Log 1');
      customLogger.error('ADB', 'Log 2');

      const exported = customLogger.exportLogsAsText();
      expect(exported).toContain('[USB]');
      expect(exported).toContain('Log 1');
      expect(exported).toContain('[ADB]');
      expect(exported).toContain('Log 2');
      expect(exported.split('\n').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Default Global Logger Singleton', () => {
    it('provides global singleton logger instance', () => {
      expect(logger).toBeInstanceOf(StructuredLogger);
    });
  });
});
