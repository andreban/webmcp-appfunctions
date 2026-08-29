/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogDrawer } from '../src/ui/log-drawer';
import { StructuredLogger } from '../src/utils/logger';

// Lightweight test DOM Element
class TestElement {
  tagName: string;
  innerHTML = '';
  attributes: Record<string, string> = {};
  value = '';
  title = '';
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 300;
  children: TestElement[] = [];
  eventListeners: Record<string, ((event?: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (c: string) => this.classList.classes.add(c),
    remove: (c: string) => this.classList.classes.delete(c),
    toggle: (c: string, force?: boolean) => {
      if (force !== undefined) {
        if (force) this.classList.classes.add(c);
        else this.classList.classes.delete(c);
        return force;
      }
      if (this.classList.classes.has(c)) {
        this.classList.classes.delete(c);
        return false;
      } else {
        this.classList.classes.add(c);
        return true;
      }
    },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(event: string, listener: (event?: unknown) => void): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  }

  removeEventListener(event: string, listener: (event?: unknown) => void): void {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter((l) => l !== listener);
    }
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }): void {
    const listeners = this.eventListeners[event.type];
    if (listeners) {
      listeners.forEach((l) => l(event));
    }
  }

  querySelector<T = TestElement>(selector: string): T | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.innerHTML.includes(`id="${id}"`)) {
        const el = new TestElement(
          id.includes('select') ? 'select' : id.includes('input') ? 'input' : 'button'
        );
        el.setAttribute('id', id);

        const valMatch = this.innerHTML.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`));
        if (valMatch) {
          el.value = valMatch[1];
        }
        return el as unknown as T;
      }
    }
    return null;
  }

  querySelectorAll<T = TestElement>(selector: string): T[] {
    const results: TestElement[] = [];

    if (selector === '.log-entry-row') {
      const regex = /class="log-entry-row[^"]*"\s+data-entry-id="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestElement('div');
        el.setAttribute('class', 'log-entry-row');
        el.setAttribute('data-entry-id', match[1]);
        results.push(el);
      }
    }

    return results as unknown as T[];
  }

  appendChild(child: TestElement): void {
    this.children.push(child);
  }

  removeChild(child: TestElement): void {
    this.children = this.children.filter((c) => c !== child);
  }

  get firstElementChild(): TestElement | null {
    return this.children.length > 0 ? this.children[0] : null;
  }
}

describe('LogDrawer Component', () => {
  let mockContainer: TestElement;
  let testLogger: StructuredLogger;
  let drawer: LogDrawer;

  beforeEach(() => {
    mockContainer = new TestElement('footer');
    testLogger = new StructuredLogger(100);
  });

  afterEach(() => {
    if (drawer) {
      drawer.destroy();
    }
  });

  describe('Initialization & Rendering', () => {
    it('mounts onto container and renders header, metrics, toolbar, and log stream', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('log-drawer-header');
      expect(mockContainer.innerHTML).toContain('Telemetry & Logs');
      expect(mockContainer.innerHTML).toContain('log-stream-container');
      expect(mockContainer.innerHTML).toContain('0 logs');
      expect(mockContainer.innerHTML).toContain('Auto-scroll');
      expect(mockContainer.innerHTML).toContain('Copy');
      expect(mockContainer.innerHTML).toContain('Clear');
      expect(drawer.isCollapsed()).toBe(false);
      expect(drawer.isAutoScroll()).toBe(true);
    });

    it('supports starting in collapsed state', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
        isCollapsed: true,
      });

      expect(drawer.isCollapsed()).toBe(true);
      expect(mockContainer.innerHTML).toContain('is-collapsed');
      expect(mockContainer.innerHTML).toContain('▲');
      expect(mockContainer.innerHTML).not.toContain('log-stream-container');
    });

    it('renders pre-existing logs from logger on initialization', () => {
      testLogger.info('USB', 'USB Device Attached');
      testLogger.warn('ADB', 'Auth challenge pending');
      testLogger.error('EXEC', 'Failed to call method');

      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('3 logs');
      expect(mockContainer.innerHTML).toContain('1 error');
      expect(mockContainer.innerHTML).toContain('[USB]');
      expect(mockContainer.innerHTML).toContain('USB Device Attached');
      expect(mockContainer.innerHTML).toContain('[ADB]');
      expect(mockContainer.innerHTML).toContain('Auth challenge pending');
      expect(mockContainer.innerHTML).toContain('[EXEC]');
      expect(mockContainer.innerHTML).toContain('Failed to call method');
    });
  });

  describe('Collapsible Drawer Controls', () => {
    it('toggles collapse state with toggleCollapse()', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
        isCollapsed: false,
      });

      expect(drawer.isCollapsed()).toBe(false);

      drawer.toggleCollapse();
      expect(drawer.isCollapsed()).toBe(true);
      expect(mockContainer.innerHTML).toContain('is-collapsed');

      drawer.toggleCollapse(false);
      expect(drawer.isCollapsed()).toBe(false);
      expect(mockContainer.innerHTML).toContain('is-expanded');
    });
  });

  describe('Auto-Scroll Functionality', () => {
    it('updates auto-scroll state with setAutoScroll()', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(drawer.isAutoScroll()).toBe(true);

      drawer.setAutoScroll(false);
      expect(drawer.isAutoScroll()).toBe(false);

      drawer.setAutoScroll(true);
      expect(drawer.isAutoScroll()).toBe(true);
    });

    it('provides scrollToBottom() method', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(() => {
        drawer.scrollToBottom();
      }).not.toThrow();
    });
  });

  describe('Filtering & Search Controls', () => {
    beforeEach(() => {
      testLogger.info('USB', 'USB transfer starting');
      testLogger.info('ADB', 'ADB ping success');
      testLogger.warn('WebMCP', 'Tool registration warning');
      testLogger.error('EXEC', 'Execution failed on NotesService');
      testLogger.debug('APP', 'Bootstrap done');
    });

    it('filters log stream by source tag (USB, ADB, WebMCP, EXEC, APP)', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('USB transfer starting');
      expect(mockContainer.innerHTML).toContain('ADB ping success');
      expect(mockContainer.innerHTML).toContain('Tool registration warning');

      drawer.setTagFilter('USB');
      expect(mockContainer.innerHTML).toContain('USB transfer starting');
      expect(mockContainer.innerHTML).not.toContain('ADB ping success');
      expect(mockContainer.innerHTML).not.toContain('Tool registration warning');

      drawer.setTagFilter('EXEC');
      expect(mockContainer.innerHTML).toContain('Execution failed on NotesService');
      expect(mockContainer.innerHTML).not.toContain('USB transfer starting');

      drawer.setTagFilter('ALL');
      expect(mockContainer.innerHTML).toContain('USB transfer starting');
      expect(mockContainer.innerHTML).toContain('ADB ping success');
    });

    it('filters log stream by level (debug, info, warn, error)', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      drawer.setLevelFilter('error');
      expect(mockContainer.innerHTML).toContain('Execution failed on NotesService');
      expect(mockContainer.innerHTML).not.toContain('USB transfer starting');
      expect(mockContainer.innerHTML).not.toContain('ADB ping success');

      drawer.setLevelFilter('warn');
      expect(mockContainer.innerHTML).toContain('Tool registration warning');
      expect(mockContainer.innerHTML).not.toContain('Execution failed on NotesService');
    });

    it('filters log stream by search query', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      drawer.setSearchQuery('NotesService');
      expect(mockContainer.innerHTML).toContain('Execution failed on NotesService');
      expect(mockContainer.innerHTML).not.toContain('USB transfer starting');

      drawer.setSearchQuery('nonexistent_query_string');
      expect(mockContainer.innerHTML).toContain('No log entries match the active filters');
    });
  });

  describe('Invocation Latency & Telemetry Metrics Display', () => {
    it('displays latency chips on entries with latencyMs', () => {
      testLogger.info('EXEC', 'createNote executed', { id: 10 }, 45);

      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('⚡ 45ms');
      expect(mockContainer.innerHTML).toContain('log-latency-chip');
    });

    it('displays summary latency metric in the header', () => {
      testLogger.info('EXEC', 'Tool 1', undefined, 50);
      testLogger.info('EXEC', 'Tool 2', undefined, 150);

      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('⚡ 100ms avg');
      expect(mockContainer.innerHTML).toContain('metric-latency');
    });
  });

  describe('Copy & Clear Log Actions', () => {
    it('clears all logs and resets view when clearLogs() is called', () => {
      testLogger.info('USB', 'Log before clear');
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('Log before clear');
      expect(mockContainer.innerHTML).toContain('1 log');

      drawer.clearLogs();

      expect(mockContainer.innerHTML).toContain('0 logs');
      expect(mockContainer.innerHTML).toContain('Log stream empty');
      expect(testLogger.getHistory()).toHaveLength(0);
    });

    it('copies log entries to clipboard and shows feedback', async () => {
      testLogger.info('USB', 'Log to copy 1');
      testLogger.info('ADB', 'Log to copy 2');

      const mockClipboard = {
        writeText: vi.fn().mockResolvedValue(undefined),
      };
      Object.assign(navigator, { clipboard: mockClipboard });

      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      const success = await drawer.copyLogs();
      expect(success).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalled();
      const copiedText = mockClipboard.writeText.mock.calls[0][0];
      expect(copiedText).toContain('[USB]');
      expect(copiedText).toContain('Log to copy 1');
      expect(copiedText).toContain('[ADB]');
      expect(copiedText).toContain('Log to copy 2');
    });
  });

  describe('Real-Time Log Streaming', () => {
    it('reacts dynamically to new logs emitted by logger', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('0 logs');

      testLogger.info('WebMCP', 'Agent invoked tool getNotes');
      expect(mockContainer.innerHTML).toContain('1 log');
      expect(mockContainer.innerHTML).toContain('[WebMCP]');
      expect(mockContainer.innerHTML).toContain('Agent invoked tool getNotes');

      testLogger.error('EXEC', 'Command timeout');
      expect(mockContainer.innerHTML).toContain('2 logs');
      expect(mockContainer.innerHTML).toContain('1 error');
    });
  });

  describe('Structured JSON Data Inspection', () => {
    it('renders Data toggle button for entries with data payload', () => {
      testLogger.info('WebMCP', 'Registered tool', { toolName: 'test', params: [] });

      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      expect(mockContainer.innerHTML).toContain('btn-toggle-data');
      expect(mockContainer.innerHTML).toContain('Data');
    });
  });

  describe('Lifecycle & Cleanup', () => {
    it('unsubscribes from logger events when destroy() is called', () => {
      drawer = new LogDrawer(mockContainer as unknown as HTMLElement, {
        loggerInstance: testLogger,
      });

      drawer.destroy();
      expect(mockContainer.innerHTML).toBe('');

      // Emitting new log after destroy should not throw or affect destroyed instance
      expect(() => {
        testLogger.info('APP', 'After destroy');
      }).not.toThrow();
    });
  });
});
