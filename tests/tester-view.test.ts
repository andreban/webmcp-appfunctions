/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionTester } from '../src/ui/tester-view';
import { AdbManager } from '../src/transport/adb-client';
import { AppFunctionsExecutor } from '../src/android/executor';
import { AppFunctionDefinition } from '../src/types/appfunctions';

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

  querySelector<T = TestDomElement>(selector: string): T | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.innerHTML.includes(`id="${id}"`)) {
        const tag = id.includes('input') || id.includes('tab') ? 'button' : 'div';
        const el = new TestDomElement(tag);
        el.setAttribute('id', id);

        // Extract value or inner text if applicable
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

    if (selector === '[data-param-name]') {
      const regex = /data-param-name="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.innerHTML)) !== null) {
        const el = new TestDomElement('input');
        el.setAttribute('data-param-name', match[1]);
        results.push(el);
      }
    }

    return results as unknown as T[];
  }
}

const mockFunctionWithParams: AppFunctionDefinition = {
  packageName: 'com.example.notes',
  functionId: 'NotesService#createNote',
  className: 'NotesService',
  methodName: 'createNote',
  description: 'Creates a new note with title, markdown body, and priority.',
  parameters: [
    {
      name: 'title',
      dataType: 'string',
      rawType: 'java.lang.String',
      description: 'The note title.',
      isRequired: true,
    },
    {
      name: 'content',
      dataType: 'string',
      rawType: 'java.lang.String',
      description: 'The body content of the note.',
      isRequired: false,
      defaultValue: '',
    },
    {
      name: 'priority',
      dataType: 'int',
      rawType: 'int',
      description: 'Priority ranking from 1 to 5.',
      isRequired: false,
      defaultValue: 1,
    },
    {
      name: 'isPinned',
      dataType: 'boolean',
      rawType: 'boolean',
      description: 'Whether the note is pinned to top.',
      isRequired: false,
      defaultValue: false,
    },
    {
      name: 'tags',
      dataType: 'array',
      rawType: 'List<String>',
      description: 'Array of tag labels.',
      isRequired: false,
    },
    {
      name: 'metadata',
      dataType: 'object',
      rawType: 'Map<String, String>',
      description: 'Custom metadata properties.',
      isRequired: false,
    },
  ],
  response: {
    dataType: 'object',
    rawType: 'com.example.notes.Note',
    description: 'Created note record.',
  },
  enabled: true,
};

const mockFunctionNoParams: AppFunctionDefinition = {
  packageName: 'com.example.system',
  functionId: 'SystemService#getStatus',
  className: 'SystemService',
  methodName: 'getStatus',
  description: 'Retrieves current system health status.',
  parameters: [],
  response: {
    dataType: 'object',
    description: 'Health metrics.',
  },
  enabled: true,
};

describe('FunctionTester Component', () => {
  let mockContainer: HTMLElement;
  let mockAdbManager: AdbManager;
  let mockExecutor: AppFunctionsExecutor;
  let disconnectListener: (() => void) | null = null;

  beforeEach(() => {
    mockContainer = new TestDomElement('div') as unknown as HTMLElement;

    disconnectListener = null;

    mockAdbManager = {
      isConnected: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('ready'),
      onDisconnect: vi.fn().mockImplementation((listener) => {
        disconnectListener = listener;
        return () => {
          disconnectListener = null;
        };
      }),
    } as unknown as AdbManager;

    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { noteId: 104, title: 'Test Note', createdAt: 1724900000 },
        executionTimeMs: 38,
        rawOutput: '{"noteId": 104, "title": "Test Note", "createdAt": 1724900000}',
      }),
    } as unknown as AppFunctionsExecutor;
  });

  describe('Initial State & Function Selection', () => {
    it('renders empty selection state prompt when no function is selected', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      expect(mockContainer.innerHTML).toContain('Interactive Tester');
      expect(mockContainer.innerHTML).toContain('Select an AppFunction');
      expect(mockContainer.innerHTML).toContain('Choose an AppFunction from the catalog');
      expect(mockContainer.innerHTML).not.toContain('btn-execute-fn');

      tester.destroy();
    });

    it('renders function banner and dynamic form when a function is selected', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);

      expect(mockContainer.innerHTML).toContain('NotesService.createNote');
      expect(mockContainer.innerHTML).toContain('com.example.notes');
      expect(mockContainer.innerHTML).toContain('android__com_example_notes__NotesService_createNote');
      expect(mockContainer.innerHTML).toContain('Device Connected');
      expect(mockContainer.innerHTML).toContain('Dynamic Form');
      expect(mockContainer.innerHTML).toContain('Raw JSON');
      expect(mockContainer.innerHTML).toContain('Execute AppFunction');
      expect(mockContainer.innerHTML).toContain('📋 Copy Command');

      tester.destroy();
    });

    it('renders no-params card for functions requiring 0 input arguments', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionNoParams);

      expect(mockContainer.innerHTML).toContain('SystemService.getStatus');
      expect(mockContainer.innerHTML).toContain('This AppFunction requires no input parameters.');
      expect(mockContainer.innerHTML).toContain('Execute AppFunction');

      tester.destroy();
    });
  });

  describe('Dynamic Form Generation & Field Types', () => {
    it('generates inputs for string, int, boolean, array, and object types', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);

      // Title (string, required)
      expect(mockContainer.innerHTML).toContain('data-param="title"');
      expect(mockContainer.innerHTML).toContain('type-string');
      expect(mockContainer.innerHTML).toContain('Required');

      // Content (string textarea, optional)
      expect(mockContainer.innerHTML).toContain('data-param="content"');
      expect(mockContainer.innerHTML).toContain('form-textarea');

      // Priority (int, optional, default: 1)
      expect(mockContainer.innerHTML).toContain('data-param="priority"');
      expect(mockContainer.innerHTML).toContain('type-int');
      expect(mockContainer.innerHTML).toContain('Optional');

      // isPinned (boolean)
      expect(mockContainer.innerHTML).toContain('data-param="isPinned"');
      expect(mockContainer.innerHTML).toContain('type-boolean');
      expect(mockContainer.innerHTML).toContain('form-select');

      // Tags (array)
      expect(mockContainer.innerHTML).toContain('data-param="tags"');
      expect(mockContainer.innerHTML).toContain('type-array');

      // Metadata (object)
      expect(mockContainer.innerHTML).toContain('data-param="metadata"');
      expect(mockContainer.innerHTML).toContain('type-object');

      tester.destroy();
    });

    it('updates form values on field input and tracks state', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);

      tester.setFormValue('title', 'Meeting Notes');
      tester.setFormValue('priority', 3);
      tester.setFormValue('isPinned', true);

      const values = tester.getFormValues();
      expect(values.title).toBe('Meeting Notes');
      expect(values.priority).toBe(3);
      expect(values.isPinned).toBe(true);

      tester.destroy();
    });
  });

  describe('Form vs Raw JSON Mode Synchronization', () => {
    it('switches to Raw JSON mode and formats current parameters as JSON text', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);
      tester.setFormValue('title', 'Weekly Sync');

      tester.setInputMode('json');

      expect(mockContainer.innerHTML).toContain('JSON Parameter Payload:');
      expect(mockContainer.innerHTML).toContain('Weekly Sync');

      tester.destroy();
    });

    it('switches back to Form mode and parses JSON payload into form values', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);
      tester.setInputMode('json');

      tester.setInputMode('form');

      expect(mockContainer.innerHTML).toContain('Dynamic Form');

      tester.destroy();
    });
  });

  describe('Execution & Telemetry Results', () => {
    it('executes AppFunction with form parameters and displays success result and latency', async () => {
      const execListener = vi.fn();
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
        onExecutionComplete: execListener,
      });

      tester.selectFunction(mockFunctionWithParams);
      tester.setFormValue('title', 'Buy Groceries');

      const result = await tester.execute();

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        'com.example.notes',
        'NotesService#createNote',
        expect.objectContaining({ title: 'Buy Groceries' }),
        expect.any(Object)
      );

      expect(result?.success).toBe(true);
      expect(execListener).toHaveBeenCalledWith(result);

      // Verify UI shows success badge, latency badge, and formatted JSON
      expect(mockContainer.innerHTML).toContain('result-success');
      expect(mockContainer.innerHTML).toContain('✓ Success');
      expect(mockContainer.innerHTML).toContain('⚡ 38ms');
      expect(mockContainer.innerHTML).toContain('104');
      expect(mockContainer.innerHTML).toContain('Test Note');
      expect(mockContainer.innerHTML).toContain('📋 Copy JSON');

      tester.destroy();
    });

    it('displays error badge and error message when execution fails', async () => {
      vi.mocked(mockExecutor.execute).mockResolvedValue({
        success: false,
        error: 'Permission denied: caller lacks READ_NOTES permission.',
        executionTimeMs: 22,
        rawOutput: 'Error: Permission denied',
      });

      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);
      tester.setFormValue('title', 'Secret Note');

      const result = await tester.execute();

      expect(result?.success).toBe(false);
      expect(mockContainer.innerHTML).toContain('result-error');
      expect(mockContainer.innerHTML).toContain('✕ Error');
      expect(mockContainer.innerHTML).toContain('⚡ 22ms');
      expect(mockContainer.innerHTML).toContain('Permission denied: caller lacks READ_NOTES permission.');

      tester.destroy();
    });

    it('handles device disconnected error gracefully', async () => {
      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);

      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);

      const result = await tester.execute();

      expect(result?.success).toBe(false);
      expect(result?.error).toBe('Android device is not connected.');
      expect(mockContainer.innerHTML).toContain('Android device is not connected.');

      tester.destroy();
    });
  });

  describe('Form Reset & Cleanup', () => {
    it('resets form fields to schema defaults on resetForm()', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);
      tester.setFormValue('title', 'Custom Title');
      tester.setFormValue('priority', 5);

      tester.resetForm();

      const values = tester.getFormValues();
      expect(values.title).toBe('');
      expect(values.priority).toBe(1);

      tester.destroy();
    });

    it('reacts to device disconnect event by re-rendering', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.selectFunction(mockFunctionWithParams);
      expect(mockContainer.innerHTML).toContain('NotesService.createNote');

      vi.mocked(mockAdbManager.isConnected).mockReturnValue(false);
      disconnectListener?.();

      expect(mockContainer.innerHTML).toContain('Device Offline');

      tester.destroy();
    });

    it('cleans up disconnect listener on destroy()', () => {
      const tester = new FunctionTester(mockContainer, {
        adbManager: mockAdbManager,
        executor: mockExecutor,
      });

      tester.destroy();

      expect(mockAdbManager.onDisconnect).toHaveBeenCalled();
      expect(mockContainer.innerHTML).toBe('');
    });
  });
});
