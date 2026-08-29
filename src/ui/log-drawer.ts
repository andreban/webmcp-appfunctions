/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LogEntry,
  LogLevel,
  LogTag,
  StructuredLogger,
  TelemetryMetrics,
  logger,
} from '../utils/logger';

export interface LogDrawerOptions {
  /**
   * StructuredLogger instance to attach to (defaults to global logger).
   */
  loggerInstance?: StructuredLogger;

  /**
   * Whether the drawer starts in collapsed state (default: false).
   */
  isCollapsed?: boolean;

  /**
   * Whether the drawer starts in fullscreen mode (default: false).
   */
  isFullscreen?: boolean;

  /**
   * Whether auto-scroll to bottom is enabled by default (default: true).
   */
  autoScroll?: boolean;

  /**
   * Initial tag filter (default: 'ALL').
   */
  filterTag?: LogTag | 'ALL';

  /**
   * Initial level filter (default: 'ALL').
   */
  filterLevel?: LogLevel | 'ALL';

  /**
   * Maximum DOM log entries rendered at once (default: 500).
   */
  maxRenderedEntries?: number;
}

/**
 * LogDrawer UI component provides a real-time streaming telemetry and log console
 * with collapsible drawer, fullscreen maximize mode, auto-scroll, color-coded source tagging
 * ([USB], [ADB], [WebMCP], [EXEC], [APP]), live invocation latency tracking, search & filter
 * controls, and copy/clear log actions.
 */
export class LogDrawer {
  private container: HTMLElement;
  private logService: StructuredLogger;
  private collapsed = false;
  private fullscreen = false;
  private autoScroll = true;
  private currentTagFilter: LogTag | 'ALL' = 'ALL';
  private currentLevelFilter: LogLevel | 'ALL' = 'ALL';
  private searchQuery = '';
  private maxRenderedEntries = 500;
  private expandedDataEntryIds: Set<string> = new Set();

  private unsubscribeLog: (() => void) | null = null;
  private unsubscribeClear: (() => void) | null = null;
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private isCopied = false;

  constructor(
    container: HTMLElement | string,
    options: LogDrawerOptions = {}
  ) {
    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (!el) {
        throw new Error(`LogDrawer: element with id "${container}" not found.`);
      }
      this.container = el;
    } else {
      this.container = container;
    }

    this.logService = options.loggerInstance ?? logger;
    this.collapsed = options.isCollapsed ?? false;
    this.fullscreen = options.isFullscreen ?? false;
    this.autoScroll = options.autoScroll ?? true;
    this.currentTagFilter = options.filterTag ?? 'ALL';
    this.currentLevelFilter = options.filterLevel ?? 'ALL';
    this.maxRenderedEntries = options.maxRenderedEntries ?? 500;

    this.bindLoggerEvents();
    this.bindKeyboardShortcuts();
    this.render();
  }

  /**
   * Returns whether the drawer is currently collapsed.
   */
  isCollapsed(): boolean {
    return this.collapsed && !this.fullscreen;
  }

  /**
   * Returns whether the drawer is currently in fullscreen mode.
   */
  isFullscreen(): boolean {
    return this.fullscreen;
  }

  /**
   * Toggles or sets the collapsed state of the drawer.
   */
  toggleCollapse(forceCollapsed?: boolean): void {
    const nextState = forceCollapsed !== undefined ? forceCollapsed : !this.collapsed;
    if (this.collapsed === nextState) {
      return;
    }
    this.collapsed = nextState;
    if (this.collapsed) {
      this.fullscreen = false;
    }
    this.render();
  }

  /**
   * Toggles or sets the fullscreen mode of the drawer.
   */
  toggleFullscreen(forceFullscreen?: boolean): void {
    const nextState = forceFullscreen !== undefined ? forceFullscreen : !this.fullscreen;
    if (this.fullscreen === nextState) {
      return;
    }
    this.fullscreen = nextState;
    if (this.fullscreen) {
      this.collapsed = false;
    }
    this.render();
  }

  /**
   * Sets fullscreen mode.
   */
  setFullscreen(enabled: boolean): void {
    this.toggleFullscreen(enabled);
  }

  /**
   * Returns whether auto-scroll to bottom is active.
   */
  isAutoScroll(): boolean {
    return this.autoScroll;
  }

  /**
   * Enables or disables auto-scroll.
   */
  setAutoScroll(enabled: boolean): void {
    this.autoScroll = enabled;
    const btn = this.container.querySelector<HTMLButtonElement>('#btn-autoscroll-toggle');
    if (btn) {
      btn.classList?.toggle('active', this.autoScroll);
      btn.title = this.autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';
      btn.setAttribute('aria-pressed', String(this.autoScroll));
    }
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * Sets the active tag filter.
   */
  setTagFilter(tag: LogTag | 'ALL'): void {
    if (this.currentTagFilter === tag) {
      return;
    }
    this.currentTagFilter = tag;
    this.render();
  }

  /**
   * Sets the active log level filter.
   */
  setLevelFilter(level: LogLevel | 'ALL'): void {
    if (this.currentLevelFilter === level) {
      return;
    }
    this.currentLevelFilter = level;
    this.render();
  }

  /**
   * Sets the search query filter.
   */
  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.render();
  }

  /**
   * Copies current filtered logs (or all logs) to clipboard as formatted text.
   */
  async copyLogs(): Promise<boolean> {
    const entries = this.getFilteredEntries();
    const textToCopy = this.logService.exportLogsAsText(entries);

    let success = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      } catch {
        success = this.fallbackCopyText(textToCopy);
      }
    } else {
      success = this.fallbackCopyText(textToCopy);
    }

    if (success) {
      this.isCopied = true;
      this.updateCopyButtonState();
      if (this.copyTimeout) {
        clearTimeout(this.copyTimeout);
      }
      this.copyTimeout = setTimeout(() => {
        this.isCopied = false;
        this.updateCopyButtonState();
      }, 1500);
    }

    return success;
  }

  /**
   * Clears the log history and refreshes the display.
   */
  clearLogs(): void {
    this.logService.clearHistory();
    this.expandedDataEntryIds.clear();
    this.render();
  }

  /**
   * Scrolls the log stream view to the bottom.
   */
  scrollToBottom(): void {
    const stream = this.container.querySelector<HTMLElement>('#log-stream-container');
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  }

  /**
   * Destroys the component and unbinds event listeners.
   */
  destroy(): void {
    if (this.unsubscribeLog) {
      this.unsubscribeLog();
      this.unsubscribeLog = null;
    }
    if (this.unsubscribeClear) {
      this.unsubscribeClear();
      this.unsubscribeClear = null;
    }
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
      this.copyTimeout = null;
    }
    if (this.keydownHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.container.innerHTML = '';
  }

  private bindLoggerEvents(): void {
    this.unsubscribeLog = this.logService.onLog(() => {
      this.handleNewLogEntry();
    });

    this.unsubscribeClear = this.logService.onClear(() => {
      this.expandedDataEntryIds.clear();
      this.render();
    });
  }

  private bindKeyboardShortcuts(): void {
    if (typeof window !== 'undefined') {
      this.keydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.fullscreen) {
          this.toggleFullscreen(false);
        }
      };
      window.addEventListener('keydown', this.keydownHandler);
    }
  }

  private handleNewLogEntry(): void {
    this.render();
  }

  private getFilteredEntries(): LogEntry[] {
    const all = this.logService.getHistory({
      tag: this.currentTagFilter,
      level: this.currentLevelFilter,
      search: this.searchQuery,
    });
    if (all.length > this.maxRenderedEntries) {
      return all.slice(all.length - this.maxRenderedEntries);
    }
    return all;
  }

  private updateDrawerStateClasses(): void {
    if (this.container.classList) {
      this.container.classList.toggle('drawer-collapsed', this.collapsed && !this.fullscreen);
      this.container.classList.toggle('drawer-expanded', !this.collapsed && !this.fullscreen);
      this.container.classList.toggle('drawer-fullscreen', this.fullscreen);
    }
  }

  /**
   * Renders the complete LogDrawer component markup.
   */
  render(): void {
    this.updateDrawerStateClasses();
    const metrics = this.logService.getMetrics();
    const filteredEntries = this.getFilteredEntries();
    const isShowingBody = this.fullscreen || !this.collapsed;

    this.container.innerHTML = `
      <div class="log-drawer-inner ${this.fullscreen ? 'is-fullscreen' : this.collapsed ? 'is-collapsed' : 'is-expanded'}">
        ${this.renderHeader(metrics)}
        ${isShowingBody ? this.renderBody(filteredEntries) : ''}
      </div>
    `;

    this.attachDomListeners();

    if (isShowingBody && this.autoScroll) {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => this.scrollToBottom());
      } else {
        setTimeout(() => this.scrollToBottom(), 0);
      }
    }
  }

  private renderHeader(metrics: TelemetryMetrics): string {
    const isCollapsedNow = this.collapsed && !this.fullscreen;

    return `
      <div class="log-drawer-header" id="log-drawer-header">
        <div class="log-drawer-title-area">
          <button
            type="button"
            class="btn-drawer-collapse"
            id="btn-toggle-drawer"
            aria-label="${isCollapsedNow ? 'Expand Log Drawer' : 'Collapse Log Drawer'}"
            title="${isCollapsedNow ? 'Expand Log Drawer' : 'Collapse Log Drawer'}"
          >
            <span class="collapse-icon">${isCollapsedNow ? '▲' : '▼'}</span>
          </button>
          <div class="log-title-group" id="log-title-toggle" title="Click to collapse / double-click to maximize">
            <span class="log-title-icon">📜</span>
            <h4 class="log-drawer-title">Telemetry & Logs</h4>
          </div>
          <div class="log-header-metrics" id="log-header-metrics">
            ${this.renderMetricsHtml(metrics)}
          </div>
        </div>

        <div class="log-drawer-toolbar">
          <div class="log-filter-group">
            <div class="log-search-wrapper">
              <input
                type="text"
                class="log-search-input"
                id="log-search-input"
                placeholder="Filter logs..."
                value="${escapeHtml(this.searchQuery)}"
                aria-label="Filter logs"
              />
              ${
                this.searchQuery
                  ? `<button type="button" class="btn-clear-log-search" id="btn-clear-log-search" title="Clear filter">✕</button>`
                  : ''
              }
            </div>

            <select class="log-select-filter" id="log-tag-filter" aria-label="Filter by log tag">
              <option value="ALL" ${this.currentTagFilter === 'ALL' ? 'selected' : ''}>Tags: All</option>
              <option value="USB" ${this.currentTagFilter === 'USB' ? 'selected' : ''}>[USB]</option>
              <option value="ADB" ${this.currentTagFilter === 'ADB' ? 'selected' : ''}>[ADB]</option>
              <option value="WebMCP" ${this.currentTagFilter === 'WebMCP' ? 'selected' : ''}>[WebMCP]</option>
              <option value="EXEC" ${this.currentTagFilter === 'EXEC' ? 'selected' : ''}>[EXEC]</option>
              <option value="APP" ${this.currentTagFilter === 'APP' ? 'selected' : ''}>[APP]</option>
            </select>

            <select class="log-select-filter" id="log-level-filter" aria-label="Filter by log level">
              <option value="ALL" ${this.currentLevelFilter === 'ALL' ? 'selected' : ''}>Levels: All</option>
              <option value="info" ${this.currentLevelFilter === 'info' ? 'selected' : ''}>INFO</option>
              <option value="warn" ${this.currentLevelFilter === 'warn' ? 'selected' : ''}>WARN</option>
              <option value="error" ${this.currentLevelFilter === 'error' ? 'selected' : ''}>ERROR</option>
              <option value="debug" ${this.currentLevelFilter === 'debug' ? 'selected' : ''}>DEBUG</option>
            </select>
          </div>

          <div class="log-action-group">
            <button
              type="button"
              class="btn-drawer-action btn-autoscroll ${this.autoScroll ? 'active' : ''}"
              id="btn-autoscroll-toggle"
              title="${this.autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}"
              aria-pressed="${String(this.autoScroll)}"
            >
              <span class="btn-action-icon">↓</span>
              <span class="btn-action-text">Auto-scroll</span>
            </button>

            <button
              type="button"
              class="btn-drawer-action btn-copy-logs ${this.isCopied ? 'copied' : ''}"
              id="btn-copy-logs"
              title="Copy visible logs to clipboard"
            >
              <span class="btn-action-icon">${this.isCopied ? '✓' : '📋'}</span>
              <span class="btn-action-text">${this.isCopied ? 'Copied!' : 'Copy'}</span>
            </button>

            <button
              type="button"
              class="btn-drawer-action btn-clear-logs"
              id="btn-clear-logs"
              title="Clear all log history"
            >
              <span class="btn-action-icon">🗑️</span>
              <span class="btn-action-text">Clear</span>
            </button>

            <button
              type="button"
              class="btn-drawer-action btn-fullscreen ${this.fullscreen ? 'active' : ''}"
              id="btn-fullscreen-toggle"
              title="${this.fullscreen ? 'Exit Fullscreen (Esc)' : 'Maximize to Fullscreen'}"
              aria-label="${this.fullscreen ? 'Exit Fullscreen' : 'Maximize to Fullscreen'}"
              aria-pressed="${String(this.fullscreen)}"
            >
              <span class="btn-action-icon">${this.fullscreen ? '🗗' : '⛶'}</span>
              <span class="btn-action-text">${this.fullscreen ? 'Restore' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderMetricsHtml(metrics: TelemetryMetrics): string {
    const errorBadge =
      metrics.errorCount > 0
        ? `<span class="metric-badge metric-error">${metrics.errorCount} error${metrics.errorCount === 1 ? '' : 's'}</span>`
        : '';

    const latencyBadge =
      metrics.totalInvocations > 0
        ? `<span class="metric-badge metric-latency" title="Average Invocation Latency (Min: ${metrics.minLatencyMs}ms, Max: ${metrics.maxLatencyMs}ms)">
             ⚡ ${metrics.averageLatencyMs}ms avg
           </span>`
        : '';

    return `
      <span class="metric-badge metric-total">${metrics.totalLogs} log${metrics.totalLogs === 1 ? '' : 's'}</span>
      ${errorBadge}
      ${latencyBadge}
    `;
  }

  private renderBody(entries: LogEntry[]): string {
    return `
      <div class="log-drawer-body">
        <div class="log-stream-container font-mono" id="log-stream-container" role="log" aria-live="polite">
          ${
            entries.length === 0
              ? this.renderEmptyState()
              : entries.map((entry) => this.renderLogEntryRow(entry)).join('')
          }
        </div>
      </div>
    `;
  }

  private renderEmptyState(): string {
    const isFiltered =
      this.currentTagFilter !== 'ALL' ||
      this.currentLevelFilter !== 'ALL' ||
      Boolean(this.searchQuery.trim());

    return `
      <div class="log-empty-state">
        <span class="log-empty-icon">🔍</span>
        <span class="log-empty-text">
          ${
            isFiltered
              ? 'No log entries match the active filters.'
              : 'Log stream empty. Telemetry events will appear here in real time.'
          }
        </span>
      </div>
    `;
  }

  private renderLogEntryRow(entry: LogEntry): string {
    const d = new Date(entry.timestamp);
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    const tagLower = entry.tag.toLowerCase();
    const isExpanded = this.expandedDataEntryIds.has(entry.id);
    const hasData = entry.data !== undefined && entry.data !== null && entry.data !== '';

    let formattedData = '';
    if (hasData) {
      try {
        formattedData =
          typeof entry.data === 'string'
            ? entry.data
            : JSON.stringify(entry.data, null, 2);
      } catch {
        formattedData = '[Object]';
      }
    }

    return `
      <div class="log-entry-row log-level-${entry.level} tag-${tagLower}" data-entry-id="${escapeHtml(entry.id)}">
        <div class="log-entry-main">
          <span class="log-cell-time" title="${d.toISOString()}">${timeStr}</span>
          <span class="log-tag-badge tag-badge-${tagLower}">[${escapeHtml(entry.tag)}]</span>
          <span class="log-level-badge level-${entry.level}">${entry.level.toUpperCase()}</span>
          <span class="log-cell-message">${escapeHtml(entry.message)}</span>
          ${
            entry.latencyMs !== undefined
              ? `<span class="log-latency-chip" title="Execution latency: ${entry.latencyMs}ms">⚡ ${entry.latencyMs}ms</span>`
              : ''
          }
          ${
            hasData
              ? `<button type="button" class="btn-toggle-data" data-toggle-id="${escapeHtml(entry.id)}" aria-expanded="${String(isExpanded)}">
                   ${isExpanded ? '▾ Data' : '▸ Data'}
                 </button>`
              : ''
          }
        </div>
        ${
          hasData && isExpanded
            ? `
          <div class="log-entry-data-view">
            <pre class="log-data-code">${escapeHtml(formattedData)}</pre>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private updateCopyButtonState(): void {
    const btn = this.container.querySelector<HTMLButtonElement>('#btn-copy-logs');
    if (btn) {
      btn.classList?.toggle('copied', this.isCopied);
      btn.innerHTML = `
        <span class="btn-action-icon">${this.isCopied ? '✓' : '📋'}</span>
        <span class="btn-action-text">${this.isCopied ? 'Copied!' : 'Copy'}</span>
      `;
    }
  }

  private attachDomListeners(): void {
    // Toggle collapse buttons / header click
    const toggleBtn = this.container.querySelector<HTMLButtonElement>('#btn-toggle-drawer');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        (e as { stopPropagation?: () => void })?.stopPropagation?.();
        this.toggleCollapse();
      });
    }

    const titleGroup = this.container.querySelector<HTMLElement>('#log-title-toggle');
    if (titleGroup) {
      titleGroup.addEventListener('click', () => {
        this.toggleCollapse();
      });
      titleGroup.addEventListener('dblclick', () => {
        this.toggleFullscreen();
      });
    }

    // Fullscreen / Maximize toggle button
    const fullscreenBtn = this.container.querySelector<HTMLButtonElement>('#btn-fullscreen-toggle');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        this.toggleFullscreen();
      });
    }

    // Auto-scroll toggle
    const autoscrollBtn = this.container.querySelector<HTMLButtonElement>('#btn-autoscroll-toggle');
    if (autoscrollBtn) {
      autoscrollBtn.addEventListener('click', () => {
        this.setAutoScroll(!this.autoScroll);
      });
    }

    // Copy logs
    const copyBtn = this.container.querySelector<HTMLButtonElement>('#btn-copy-logs');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        void this.copyLogs();
      });
    }

    // Clear logs
    const clearBtn = this.container.querySelector<HTMLButtonElement>('#btn-clear-logs');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearLogs();
      });
    }

    // Tag filter
    const tagFilter = this.container.querySelector<HTMLSelectElement>('#log-tag-filter');
    if (tagFilter) {
      tagFilter.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value as LogTag | 'ALL';
        this.setTagFilter(val);
      });
    }

    // Level filter
    const levelFilter = this.container.querySelector<HTMLSelectElement>('#log-level-filter');
    if (levelFilter) {
      levelFilter.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value as LogLevel | 'ALL';
        this.setLevelFilter(val);
      });
    }

    // Search input
    const searchInput = this.container.querySelector<HTMLInputElement>('#log-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        this.setSearchQuery(val);
      });
    }

    const clearSearchBtn = this.container.querySelector<HTMLButtonElement>('#btn-clear-log-search');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
        }
        this.setSearchQuery('');
      });
    }

    // Stream manual scroll listener: pause autoscroll if user scrolls up
    const stream = this.container.querySelector<HTMLElement>('#log-stream-container');
    if (stream) {
      stream.addEventListener('scroll', () => {
        const isAtBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 25;
        if (!isAtBottom && this.autoScroll) {
          this.setAutoScroll(false);
        }
      });
    }

    // Data toggles
    const dataToggleButtons = this.container.querySelectorAll<HTMLButtonElement>('.btn-toggle-data');
    if (dataToggleButtons) {
      dataToggleButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          (e as { stopPropagation?: () => void })?.stopPropagation?.();
          const entryId = btn.getAttribute('data-toggle-id');
          if (entryId) {
            if (this.expandedDataEntryIds.has(entryId)) {
              this.expandedDataEntryIds.delete(entryId);
            } else {
              this.expandedDataEntryIds.add(entryId);
            }
            this.render();
          }
        });
      });
    }
  }

  private fallbackCopyText(text: string): boolean {
    if (typeof document === 'undefined' || !document.createElement) {
      return false;
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body?.appendChild?.(textarea);
      textarea.focus?.();
      textarea.select?.();
      const success = typeof document.execCommand === 'function' ? document.execCommand('copy') : true;
      document.body?.removeChild?.(textarea);
      return success;
    } catch {
      return false;
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
