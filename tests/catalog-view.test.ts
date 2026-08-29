/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionCatalog } from '../src/ui/catalog-view';
import { AdbManager } from '../src/transport/adb-client';
import { AppFunctionsDiscovery } from '../src/android/discovery';
import { WebMcpBridge } from '../src/webmcp/bridge';
import { AppFunctionDefinition } from '../src/types/appfunctions';
import { AdbConnectionState } from '../src/types/adb';

// Simulated DOM node for testing
class TestDomElement {
  tagName: string;
  innerHTML = '';
  attributes: Record<string, string> = {};
  onclick: ((event?: unknown) => void) | null = null;
  oninput: ((event?: unknown) => void) | null = null;
  onchange: ((event?: unknown) => void) | null = null;
  value = '';
  disabled = false;
  title = '';

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  focus(): void {}

  setSelectionRange(_start: number, _end: number): void {}

  closest<T = TestDomElement>(selector: string): T | null {
    if (selector === '.function-docs-drawer' && this.innerHTML.includes('function-docs-drawer')) {
      return this as unknown as T;
    }
    return null;
  }

  querySelector<T = TestDomElement>(selector: string): T | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.innerHTML.includes(`id="${id}"`)) {
        const el = new TestDomElement(id.startsWith('catalog-package-select') ? 'select' : id.includes('input') ? 'input' : 'button');
        el.setAttribute('id', id);

        // Extract value attribute if present
        const valMatch = this.innerHTML.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`));
        if (valMatch) {
          el.value = valMatch[1];
        }
        return el as unknown as T;
      }
    }
    return null;
  }

  querySelectorAll<T = TestDomElement>(selector: string): T[] {
    const results: TestDomElement[] = [];

    if (selector === '[data-action="toggle-package"]') {
      const regex = /data-action="toggle-package"\s+data-package="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestDomElement('div');
        el.setAttribute('data-action', 'toggle-package');
        el.setAttribute('data-package', match[1]);
        results.push(el);
      }
    }

    if (selector === '[data-action="select-function"]') {
      const regex = /data-action="select-function"\s+data-function-key="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestDomElement('button');
        el.setAttribute('data-action', 'select-function');
        el.setAttribute('data-function-key', match[1]);
        results.push(el);
      }
    }

    if (selector === '[data-action="toggle-docs"]') {
      const regex = /data-action="toggle-docs"\s+data-function-key="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestDomElement('button');
        el.setAttribute('data-action', 'toggle-docs');
        el.setAttribute('data-function-key', match[1]);
        results.push(el);
      }
    }

    if (selector === '.function-card') {
      const regex = /class="function-card[^"]*"\s+data-function-key="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestDomElement('div');
        el.setAttribute('class', 'function-card');
        el.setAttribute('data-function-key', match[1]);
        results.push(el);
      }
    }

    return results as unknown as T[];
  }
}

const mockFunctions: AppFunctionDefinition[] = [
  {
    packageName: 'com.example.notes',
    functionId: 'NotesService#createNote',
    className: 'NotesService',
    methodName: 'createNote',
    description: 'Creates a new note in the notes repository.',
    parameters: [
      {
        name: 'title',
        dataType: 'string',
        rawType: 'java.lang.String',
        description: 'The title of the note.',
        isRequired: true,
      },
      {
        name: 'content',
        dataType: 'string',
        rawType: 'java.lang.String',
        description: 'The full markdown body content.',
        isRequired: false,
        defaultValue: '',
      },
      {
        name: 'priority',
        dataType: 'int',
        rawType: 'int',
        description: 'Priority ranking (1-5).',
        isRequired: false,
        defaultValue: 1,
      },
    ],
    response: {
      dataType: 'object',
      rawType: 'com.example.notes.Note',
      description: 'The created note item with generated ID.',
    },
    enabled: true,
  },
  {
    packageName: 'com.example.notes',
    functionId: 'NotesService#getNotes',
    className: 'NotesService',
    methodName: 'getNotes',
    description: 'Queries existing notes by category filter.',
    parameters: [
      {
        name: 'category',
        dataType: 'string',
        description: 'Category tag filter.',
        isRequired: false,
      },
    ],
    response: {
      dataType: 'array',
      rawType: 'List<Note>',
      description: 'Array of matching notes.',
    },
    enabled: true,
  },
  {
    packageName: 'com.example.calculator',
    functionId: 'Calculator#calculate',
    className: 'Calculator',
    methodName: 'calculate',
    description: 'Performs mathematical expression evaluation.',
    parameters: [
      {
        name: 'expression',
        dataType: 'string',
        description: 'Math expression e.g. 2 + 2.',
        isRequired: true,
      },
    ],
    response: {
      dataType: 'double',
      description: 'Computed result.',
    },
    enabled: true,
  },
];

describe('FunctionCatalog Component', () => {
  let mockContainer: HTMLElement;
  let mockAdbManager: AdbManager;
  let mockDiscovery: AppFunctionsDiscovery;
  let mockBridge: WebMcpBridge;
  let stateListener: ((state: AdbConnectionState) => void) | null = null;
  let disconnectListener: (() => void) | null = null;

  beforeEach(() => {
    mockContainer = new TestDomElement('div') as unknown as HTMLElement;

    stateListener = null;
    disconnectListener = null;

    mockAdbManager = {
      isConnected: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('ready'),
      onStateChange: vi.fn().mockImplementation((listener) => {
        stateListener = listener;
        return () => {
          stateListener = null;
        };
      }),
      onDisconnect: vi.fn().mockImplementation((listener) => {
        disconnectListener = listener;
        return () => {
          disconnectListener = null;
        };
      }),
    } as unknown as AdbManager;

    mockDiscovery = {
      discover: vi.fn().mockResolvedValue({
        functions: mockFunctions,
        totalCount: mockFunctions.length,
        packageCount: 2,
        packages: ['com.example.notes', 'com.example.calculator'],
        executionTimeMs: 45,
      }),
    } as unknown as AppFunctionsDiscovery;

    mockBridge = {
      registerAppFunctions: vi.fn().mockResolvedValue([]),
    } as unknown as WebMcpBridge;
  });

  describe('Initial State & Disconnected Rendering', () => {
    it('renders disconnected state message when ADB device is offline', () => {
      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);

      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      expect(mockContainer.innerHTML).toContain('Function Catalog');
      expect(mockContainer.innerHTML).toContain('No Android Device Connected');
      expect(mockContainer.innerHTML).toContain('Connect your Android 16+ device');
      expect(mockContainer.innerHTML).not.toContain('catalog-toolbar');

      catalog.destroy();
    });

    it('renders empty functions state when discovery returns no tools', async () => {
      vi.mocked(mockDiscovery.discover).mockResolvedValue({
        functions: [],
        totalCount: 0,
        packageCount: 0,
        packages: [],
        executionTimeMs: 10,
      });

      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      expect(mockContainer.innerHTML).toContain('No AppFunctions Found');
      expect(mockContainer.innerHTML).toContain('0 tools');

      catalog.destroy();
    });

    it('renders error state with retry button when discovery fails', async () => {
      vi.mocked(mockDiscovery.discover).mockRejectedValue(
        new Error('Permission denied querying AppFunctions: SecurityException')
      );

      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      expect(mockContainer.innerHTML).toContain('Discovery Failed');
      expect(mockContainer.innerHTML).toContain('SecurityException');
      expect(mockContainer.innerHTML).toContain('Retry Discovery');

      catalog.destroy();
    });
  });

  describe('Discovery, Grouping & Tool Registration', () => {
    it('discovers AppFunctions and groups them by package', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
        bridge: mockBridge,
      });

      await catalog.discover();

      expect(mockDiscovery.discover).toHaveBeenCalled();
      expect(mockBridge.registerAppFunctions).toHaveBeenCalledWith(mockFunctions);

      expect(mockContainer.innerHTML).toContain('3 tools');
      expect(mockContainer.innerHTML).toContain('com.example.notes');
      expect(mockContainer.innerHTML).toContain('com.example.calculator');
      expect(mockContainer.innerHTML).toContain('NotesService.createNote');
      expect(mockContainer.innerHTML).toContain('NotesService.getNotes');
      expect(mockContainer.innerHTML).toContain('Calculator.calculate');
      expect(mockContainer.innerHTML).toContain('android__com_example_notes__NotesService_createNote');

      catalog.destroy();
    });

    it('collapses and expands package groups on click', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      expect(mockContainer.innerHTML).toContain('package-group');
      expect(mockContainer.innerHTML).not.toContain('package-group collapsed');

      catalog.togglePackageCollapsed('com.example.notes');

      expect(mockContainer.innerHTML).toContain('package-group collapsed');

      catalog.togglePackageCollapsed('com.example.notes');
      expect(mockContainer.innerHTML).not.toContain('package-group collapsed');

      catalog.destroy();
    });
  });

  describe('Search & Filter Capabilities', () => {
    it('filters functions by search query across names, descriptions, and tool names', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      // Search for calculator
      catalog.setSearchQuery('calculator');

      expect(catalog.getFilteredFunctions().length).toBe(1);
      expect(mockContainer.innerHTML).toContain('Calculator.calculate');
      expect(mockContainer.innerHTML).not.toContain('NotesService.createNote');

      // Search by parameter name 'priority'
      catalog.setSearchQuery('priority');
      expect(catalog.getFilteredFunctions().length).toBe(1);
      expect(mockContainer.innerHTML).toContain('NotesService.createNote');

      // Search by description text 'markdown'
      catalog.setSearchQuery('markdown');
      expect(catalog.getFilteredFunctions().length).toBe(1);
      expect(mockContainer.innerHTML).toContain('NotesService.createNote');

      catalog.destroy();
    });

    it('filters functions by package dropdown', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      catalog.setSelectedPackage('com.example.calculator');

      expect(catalog.getFilteredFunctions().length).toBe(1);
      expect(mockContainer.innerHTML).toContain('Calculator.calculate');
      expect(mockContainer.innerHTML).not.toContain('NotesService.createNote');
      expect(mockContainer.innerHTML).not.toContain('data-package="com.example.notes"');

      catalog.setSelectedPackage('');
      expect(catalog.getFilteredFunctions().length).toBe(3);

      catalog.destroy();
    });

    it('displays no matching functions message when query finds 0 results', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      catalog.setSearchQuery('nonexistent_tool_xyz');

      expect(catalog.getFilteredFunctions().length).toBe(0);
      expect(mockContainer.innerHTML).toContain('No Matching Functions');
      expect(mockContainer.innerHTML).toContain('nonexistent_tool_xyz');
      expect(mockContainer.innerHTML).toContain('Reset Filters');

      catalog.destroy();
    });
  });

  describe('Parameter Documentation & Type Inspection', () => {
    it('renders parameter summary badges and toggle button', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      expect(mockContainer.innerHTML).toContain('3 parameters (1 required)');
      expect(mockContainer.innerHTML).toContain('↳ object');
      expect(mockContainer.innerHTML).toContain('View Docs ▼');

      catalog.destroy();
    });

    it('expands parameter documentation drawer with types, defaults, and descriptions', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();

      const key = 'com.example.notes::NotesService#createNote';
      catalog.toggleFunctionExpanded(key);

      expect(mockContainer.innerHTML).toContain('Hide Docs ▲');
      expect(mockContainer.innerHTML).toContain('Parameter Specifications:');
      expect(mockContainer.innerHTML).toContain('title');
      expect(mockContainer.innerHTML).toContain('type-string');
      expect(mockContainer.innerHTML).toContain('Required');
      expect(mockContainer.innerHTML).toContain('The title of the note.');
      expect(mockContainer.innerHTML).toContain('priority');
      expect(mockContainer.innerHTML).toContain('type-int');
      expect(mockContainer.innerHTML).toContain('Optional');
      expect(mockContainer.innerHTML).toContain('default: <code>1</code>');
      expect(mockContainer.innerHTML).toContain('Response Type:');
      expect(mockContainer.innerHTML).toContain('type-object');
      expect(mockContainer.innerHTML).toContain('com.example.notes.Note');

      catalog.destroy();
    });
  });

  describe('Function Selection & Event Callbacks', () => {
    it('automatically selects the first function on discovery if none is selected', async () => {
      const selectListener = vi.fn();
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
        onSelectFunction: selectListener,
      });

      await catalog.discover();

      expect(catalog.getSelectedFunction()?.functionId).toBe('NotesService#createNote');
      expect(selectListener).toHaveBeenCalledWith(mockFunctions[0]);

      catalog.destroy();
    });

    it('selects function and notifies onSelectFunction listeners', async () => {
      const selectListener = vi.fn();
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      catalog.onSelectFunction(selectListener);
      await catalog.discover();

      catalog.selectFunction('com.example.calculator::Calculator#calculate');

      expect(catalog.getSelectedFunction()?.functionId).toBe('Calculator#calculate');
      expect(selectListener).toHaveBeenCalledWith(mockFunctions[2]);
      expect(mockContainer.innerHTML).toContain('function-card selected');

      catalog.destroy();
    });
  });

  describe('Lifecycle, Disconnect & Cleanup', () => {
    it('resets catalog state when device disconnects', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      await catalog.discover();
      expect(catalog.getFunctions().length).toBe(3);

      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);
      disconnectListener?.();

      expect(catalog.getFunctions().length).toBe(0);
      expect(mockContainer.innerHTML).toContain('No Android Device Connected');

      catalog.destroy();
    });

    it('reacts to ADB state change to ready by triggering discovery', async () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      stateListener?.('ready');

      expect(mockDiscovery.discover).toHaveBeenCalled();

      catalog.destroy();
    });

    it('cleans up listeners on destroy()', () => {
      const catalog = new FunctionCatalog(mockContainer, {
        adbManager: mockAdbManager,
        discovery: mockDiscovery,
      });

      catalog.destroy();

      expect(mockAdbManager.onStateChange).toHaveBeenCalled();
      expect(mockAdbManager.onDisconnect).toHaveBeenCalled();
      expect(mockContainer.innerHTML).toBe('');
    });
  });
});
