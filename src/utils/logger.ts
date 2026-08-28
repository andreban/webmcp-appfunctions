/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogTag = 'USB' | 'ADB' | 'WebMCP' | 'EXEC' | 'APP';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  tag: LogTag;
  message: string;
  data?: unknown;
}

export type LogListener = (entry: LogEntry) => void;

class StructuredLogger {
  private listeners: Set<LogListener> = new Set();
  private history: LogEntry[] = [];
  private maxHistorySize = 500;
  private idCounter = 0;

  /**
   * Log an event with structured metadata.
   */
  log(level: LogLevel, tag: LogTag, message: string, data?: unknown): LogEntry {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${++this.idCounter}`,
      timestamp: Date.now(),
      level,
      tag,
      message,
      data,
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Console output with tag formatting
    const prefix = `[${tag}]`;
    switch (level) {
      case 'debug':
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(prefix, message, data ?? '');
        }
        break;
      case 'info':
        if (typeof console !== 'undefined' && console.info) {
          console.info(prefix, message, data ?? '');
        }
        break;
      case 'warn':
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(prefix, message, data ?? '');
        }
        break;
      case 'error':
        if (typeof console !== 'undefined' && console.error) {
          console.error(prefix, message, data ?? '');
        }
        break;
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in log listener:', err);
      }
    }

    return entry;
  }

  debug(tag: LogTag, message: string, data?: unknown): LogEntry {
    return this.log('debug', tag, message, data);
  }

  info(tag: LogTag, message: string, data?: unknown): LogEntry {
    return this.log('info', tag, message, data);
  }

  warn(tag: LogTag, message: string, data?: unknown): LogEntry {
    return this.log('warn', tag, message, data);
  }

  error(tag: LogTag, message: string, data?: unknown): LogEntry {
    return this.log('error', tag, message, data);
  }

  /**
   * Subscribe to log events.
   * @returns Unsubscribe function.
   */
  onLog(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHistory(): LogEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

export const logger = new StructuredLogger();
