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
  latencyMs?: number;
}

export type LogListener = (entry: LogEntry) => void;
export type ClearListener = () => void;

export interface LogFilterOptions {
  tag?: LogTag | 'ALL';
  level?: LogLevel | 'ALL';
  search?: string;
}

export interface TelemetryMetrics {
  totalLogs: number;
  errorCount: number;
  warnCount: number;
  totalInvocations: number;
  averageLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  latestLatencyMs?: number;
}

/**
 * StructuredLogger manages application telemetry, log emission, event listeners,
 * history retention, and latency performance metrics.
 */
export class StructuredLogger {
  private listeners: Set<LogListener> = new Set();
  private clearListeners: Set<ClearListener> = new Set();
  private history: LogEntry[] = [];
  private maxHistorySize = 1000;
  private idCounter = 0;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Log an event with structured metadata and optional invocation latency.
   */
  log(
    level: LogLevel,
    tag: LogTag,
    message: string,
    data?: unknown,
    latencyMs?: number
  ): LogEntry {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${++this.idCounter}`,
      timestamp: Date.now(),
      level,
      tag,
      message,
      data,
      latencyMs: typeof latencyMs === 'number' && !isNaN(latencyMs) ? latencyMs : undefined,
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Console output with tag formatting
    const prefix = `[${tag}]`;
    const latencySuffix = entry.latencyMs !== undefined ? `(${entry.latencyMs}ms)` : '';
    switch (level) {
      case 'debug':
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(prefix, message, latencySuffix, data ?? '');
        }
        break;
      case 'info':
        if (typeof console !== 'undefined' && console.info) {
          console.info(prefix, message, latencySuffix, data ?? '');
        }
        break;
      case 'warn':
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(prefix, message, latencySuffix, data ?? '');
        }
        break;
      case 'error':
        if (typeof console !== 'undefined' && console.error) {
          console.error(prefix, message, latencySuffix, data ?? '');
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

  debug(tag: LogTag, message: string, data?: unknown, latencyMs?: number): LogEntry {
    return this.log('debug', tag, message, data, latencyMs);
  }

  info(tag: LogTag, message: string, data?: unknown, latencyMs?: number): LogEntry {
    return this.log('info', tag, message, data, latencyMs);
  }

  warn(tag: LogTag, message: string, data?: unknown, latencyMs?: number): LogEntry {
    return this.log('warn', tag, message, data, latencyMs);
  }

  error(tag: LogTag, message: string, data?: unknown, latencyMs?: number): LogEntry {
    return this.log('error', tag, message, data, latencyMs);
  }

  /**
   * Records a timed execution or tool invocation with latency metrics.
   */
  trackLatency(
    tag: LogTag,
    message: string,
    latencyMs: number,
    data?: unknown,
    level: LogLevel = 'info'
  ): LogEntry {
    return this.log(level, tag, message, data, latencyMs);
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

  /**
   * Subscribe to clear events.
   * @returns Unsubscribe function.
   */
  onClear(listener: ClearListener): () => void {
    this.clearListeners.add(listener);
    return () => {
      this.clearListeners.delete(listener);
    };
  }

  /**
   * Returns copy of log history, optionally filtered.
   */
  getHistory(filters?: LogFilterOptions): LogEntry[] {
    let result = [...this.history];

    if (!filters) {
      return result;
    }

    if (filters.tag && filters.tag !== 'ALL') {
      result = result.filter((e) => e.tag === filters.tag);
    }

    if (filters.level && filters.level !== 'ALL') {
      result = result.filter((e) => e.level === filters.level);
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter((e) => {
        const matchesMessage = e.message.toLowerCase().includes(q);
        const matchesTag = e.tag.toLowerCase().includes(q);
        const matchesData =
          e.data !== undefined
            ? JSON.stringify(e.data).toLowerCase().includes(q)
            : false;
        return matchesMessage || matchesTag || matchesData;
      });
    }

    return result;
  }

  /**
   * Computes telemetry and latency performance metrics across recorded logs.
   */
  getMetrics(): TelemetryMetrics {
    let errorCount = 0;
    let warnCount = 0;
    let totalInvocations = 0;
    let totalLatency = 0;
    let minLatencyMs = Number.POSITIVE_INFINITY;
    let maxLatencyMs = 0;
    let latestLatencyMs: number | undefined;

    for (const entry of this.history) {
      if (entry.level === 'error') {
        errorCount++;
      } else if (entry.level === 'warn') {
        warnCount++;
      }

      if (entry.latencyMs !== undefined) {
        totalInvocations++;
        totalLatency += entry.latencyMs;
        latestLatencyMs = entry.latencyMs;
        if (entry.latencyMs < minLatencyMs) {
          minLatencyMs = entry.latencyMs;
        }
        if (entry.latencyMs > maxLatencyMs) {
          maxLatencyMs = entry.latencyMs;
        }
      }
    }

    const averageLatencyMs =
      totalInvocations > 0 ? Math.round(totalLatency / totalInvocations) : 0;

    return {
      totalLogs: this.history.length,
      errorCount,
      warnCount,
      totalInvocations,
      averageLatencyMs,
      minLatencyMs: totalInvocations > 0 ? minLatencyMs : 0,
      maxLatencyMs: totalInvocations > 0 ? maxLatencyMs : 0,
      latestLatencyMs,
    };
  }

  /**
   * Clears the log history and notifies clear listeners.
   */
  clearHistory(): void {
    this.history = [];
    for (const listener of this.clearListeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in clear listener:', err);
      }
    }
  }

  /**
   * Sets maximum history size.
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(10, size);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(this.history.length - this.maxHistorySize);
    }
  }

  /**
   * Gets current maximum history size.
   */
  getMaxHistorySize(): number {
    return this.maxHistorySize;
  }

  /**
   * Formats a single LogEntry as a human-readable text line.
   */
  formatEntry(entry: LogEntry): string {
    const d = new Date(entry.timestamp);
    const timeStr = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const tagStr = `[${entry.tag}]`.padEnd(8);
    const latencyStr = entry.latencyMs !== undefined ? ` (${entry.latencyMs}ms)` : '';

    let line = `[${timeStr}] ${levelStr} ${tagStr} ${entry.message}${latencyStr}`;

    if (entry.data !== undefined && entry.data !== null && entry.data !== '') {
      try {
        const dataStr =
          typeof entry.data === 'string'
            ? entry.data
            : JSON.stringify(entry.data, null, 2);
        line += `\n  Data: ${dataStr}`;
      } catch {
        line += `\n  Data: [Object]`;
      }
    }

    return line;
  }

  /**
   * Exports recorded logs as formatted plaintext.
   */
  exportLogsAsText(entries?: LogEntry[]): string {
    const target = entries ?? this.history;
    return target.map((e) => this.formatEntry(e)).join('\n');
  }
}

export const logger = new StructuredLogger();
