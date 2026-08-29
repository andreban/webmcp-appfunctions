/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebMcpBridge,
  isWebMcpSupported,
  getModelContext,
  assertWebMcpSupported,
} from '../src/webmcp/bridge';
import { AdbManager } from '../src/transport/adb-client';
import { AppFunctionDefinition } from '../src/types/appfunctions';
import { logger } from '../src/utils/logger';

/**
 * Helper to create a mock WebMCP.ModelContext conforming to webmcp-types.
 */
function createMockModelContext(): WebMCP.ModelContext {
  const listeners: Record<string, Set<EventListenerOrEventListenerObject>> = {};

  const mockCtx = {
    registerTool: vi.fn().mockImplementation(async (_tool, options?: WebMCP.ModelContextRegisterToolOptions) => {
      if (options?.signal?.aborted) {
        throw new DOMException('Registration aborted', 'AbortError');
      }
    }),
    getTools: vi.fn().mockResolvedValue([]),
    ontoolchange: null,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (!listeners[type]) {
        listeners[type] = new Set();
      }
      listeners[type].add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (listeners[type]) {
        listeners[type].delete(listener);
      }
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const typeListeners = listeners[event.type];
      if (typeListeners) {
        for (const l of typeListeners) {
          if (typeof l === 'function') {
            l(event);
          } else if (l && typeof l.handleEvent === 'function') {
            l.handleEvent(event);
          }
        }
      }
      return true;
    }),
  } as unknown as WebMCP.ModelContext;

  return mockCtx;
}

/**
 * Helper to create a mock AdbManager.
 */
function createMockAdbManager(): {
  manager: AdbManager;
  triggerDisconnect: () => void;
  triggerStateChange: (state: string) => void;
} {
  const disconnectListeners = new Set<() => void>();
  const stateChangeListeners = new Set<(state: string) => void>();

  const manager = {
    isConnected: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue('ready'),
    onDisconnect: vi.fn((listener: () => void) => {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    }),
    onStateChange: vi.fn((listener: (state: string) => void) => {
      stateChangeListeners.add(listener);
      return () => stateChangeListeners.delete(listener);
    }),
  } as unknown as AdbManager;

  return {
    manager,
    triggerDisconnect: () => {
      for (const listener of disconnectListeners) {
        listener();
      }
    },
    triggerStateChange: (state: string) => {
      for (const listener of stateChangeListeners) {
        listener(state);
      }
    },
  };
}

describe('WebMCP Bridge & Lifecycle Management', () => {
  let mockModelContext: WebMCP.ModelContext;

  beforeEach(() => {
    mockModelContext = createMockModelContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WebMCP Availability Helpers', () => {
    it('isWebMcpSupported returns true when document.modelContext exists', () => {
      const originalDoc = globalThis.document;
      try {
        Object.defineProperty(globalThis, 'document', {
          value: { modelContext: mockModelContext },
          configurable: true,
          writable: true,
        });
        expect(isWebMcpSupported()).toBe(true);
        expect(getModelContext()).toBe(mockModelContext);
        expect(assertWebMcpSupported()).toBe(mockModelContext);
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: originalDoc,
          configurable: true,
          writable: true,
        });
      }
    });

    it('isWebMcpSupported returns false and assert throws when document.modelContext is missing', () => {
      const originalDoc = globalThis.document;
      try {
        Object.defineProperty(globalThis, 'document', {
          value: {},
          configurable: true,
          writable: true,
        });
        expect(isWebMcpSupported()).toBe(false);
        expect(getModelContext()).toBeUndefined();
        expect(() => assertWebMcpSupported()).toThrow(
          'WebMCP is not supported in this browser environment'
        );
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: originalDoc,
          configurable: true,
          writable: true,
        });
      }
    });

    it('isWebMcpSupported returns false when document is undefined', () => {
      const originalDoc = globalThis.document;
      try {
        Object.defineProperty(globalThis, 'document', {
          value: undefined,
          configurable: true,
          writable: true,
        });
        expect(isWebMcpSupported()).toBe(false);
        expect(getModelContext()).toBeUndefined();
        expect(() => assertWebMcpSupported()).toThrow(
          'WebMCP is not supported in this browser environment'
        );
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: originalDoc,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('WebMcpBridge Initialization & Setup', () => {
    it('initializes with custom ModelContext and starts listening to toolchange', () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      expect(bridge.isSupported()).toBe(true);
      expect(bridge.getModelContext()).toBe(mockModelContext);
      expect(mockModelContext.addEventListener).toHaveBeenCalledWith(
        'toolchange',
        expect.any(Function)
      );
      expect(bridge.getToolCount()).toBe(0);
    });

    it('allows disabling toolchange listening via options', () => {
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        listenToToolChange: false,
      });

      expect(mockModelContext.addEventListener).not.toHaveBeenCalledWith(
        'toolchange',
        expect.any(Function)
      );
      expect(bridge.isSupported()).toBe(true);
    });

    it('allows setting or changing ModelContext dynamically', () => {
      const bridge = new WebMcpBridge({ listenToToolChange: false });
      expect(bridge.isSupported()).toBe(false);

      bridge.setModelContext(mockModelContext);
      expect(bridge.isSupported()).toBe(true);
      expect(bridge.getModelContext()).toBe(mockModelContext);
    });
  });

  describe('Tool Registration', () => {
    it('registers a single ModelContextTool with document.modelContext passing an AbortSignal', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const mockTool: WebMCP.ModelContextTool = {
        name: 'android__com_example_notes__createNote',
        title: 'createNote',
        description: 'Creates a note',
        execute: vi.fn().mockResolvedValue({ id: 1 }),
      };

      await bridge.registerTool(mockTool);

      expect(mockModelContext.registerTool).toHaveBeenCalledTimes(1);
      const [registeredTool, options] = vi.mocked(mockModelContext.registerTool).mock.calls[0];

      expect(registeredTool).toBe(mockTool);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.signal?.aborted).toBe(false);

      expect(bridge.isToolRegistered('android__com_example_notes__createNote')).toBe(true);
      expect(bridge.getRegisteredTool('android__com_example_notes__createNote')).toBe(mockTool);
      expect(bridge.getToolCount()).toBe(1);
      expect(bridge.getRegisteredToolNames()).toEqual([
        'android__com_example_notes__createNote',
      ]);
      expect(bridge.getRegisteredTools()).toEqual([mockTool]);

      const record = bridge.getRegisteredRecord('android__com_example_notes__createNote');
      expect(record).toBeDefined();
      expect(record?.tool).toBe(mockTool);
      expect(record?.abortController).toBeInstanceOf(AbortController);
      expect(record?.registeredAt).toBeGreaterThan(0);
    });

    it('throws when trying to register a tool without ModelContext support', async () => {
      const bridge = new WebMcpBridge({ modelContext: undefined, listenToToolChange: false });

      const mockTool: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'A test tool',
        execute: vi.fn(),
      };

      await expect(bridge.registerTool(mockTool)).rejects.toThrow(
        'WebMCP is not supported: document.modelContext is not available.'
      );
    });

    it('replaces previously registered tool with the same name and aborts previous controller', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const tool1: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'V1',
        execute: vi.fn(),
      };

      const tool2: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'V2',
        execute: vi.fn(),
      };

      await bridge.registerTool(tool1);
      const record1 = bridge.getRegisteredRecord('test_tool');
      expect(record1?.tool.description).toBe('V1');
      expect(record1?.abortController.signal.aborted).toBe(false);

      await bridge.registerTool(tool2);
      expect(record1?.abortController.signal.aborted).toBe(true);

      const record2 = bridge.getRegisteredRecord('test_tool');
      expect(record2?.tool.description).toBe('V2');
      expect(record2?.abortController.signal.aborted).toBe(false);
      expect(bridge.getToolCount()).toBe(1);
    });

    it('links caller AbortSignal to internal AbortController', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const callerController = new AbortController();
      const mockTool: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'Test',
        execute: vi.fn(),
      };

      await bridge.registerTool(mockTool, { signal: callerController.signal });

      const record = bridge.getRegisteredRecord('test_tool');
      expect(record?.abortController.signal.aborted).toBe(false);

      callerController.abort('caller requested abort');
      expect(record?.abortController.signal.aborted).toBe(true);
      expect(bridge.isToolRegistered('test_tool')).toBe(false);
    });

    it('handles already aborted caller AbortSignal immediately', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const callerController = new AbortController();
      callerController.abort('already aborted');

      const mockTool: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'Test',
        execute: vi.fn(),
      };

      // ModelContext registerTool will reject on aborted signal
      await expect(
        bridge.registerTool(mockTool, { signal: callerController.signal })
      ).rejects.toThrow();

      expect(bridge.isToolRegistered('test_tool')).toBe(false);
    });

    it('cleans up and aborts controller if modelContext.registerTool fails', async () => {
      vi.mocked(mockModelContext.registerTool).mockRejectedValueOnce(
        new Error('Failed to register with browser')
      );

      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const mockTool: WebMCP.ModelContextTool = {
        name: 'failing_tool',
        description: 'Fails',
        execute: vi.fn(),
      };

      await expect(bridge.registerTool(mockTool)).rejects.toThrow(
        'Failed to register with browser'
      );
      expect(bridge.isToolRegistered('failing_tool')).toBe(false);
    });

    it('batch registers an array of ModelContextTools via registerTools', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const tools: WebMCP.ModelContextTool[] = [
        { name: 'tool_1', description: 'Tool 1', execute: vi.fn() },
        { name: 'tool_2', description: 'Tool 2', execute: vi.fn() },
      ];

      await bridge.registerTools(tools);

      expect(bridge.getToolCount()).toBe(2);
      expect(bridge.getRegisteredToolNames()).toEqual(['tool_1', 'tool_2']);
    });
  });

  describe('AppFunction Registration & Schema Mapping', () => {
    it('maps and registers an AppFunctionDefinition via registerAppFunction', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const def: AppFunctionDefinition = {
        packageName: 'com.example.calculator',
        functionId: 'CalculatorService#add',
        className: 'CalculatorService',
        methodName: 'add',
        description: 'Adds two numbers',
        parameters: [
          { name: 'a', dataType: 'int', isRequired: true },
          { name: 'b', dataType: 'int', isRequired: true },
        ],
        response: { dataType: 'int' },
      };

      const mockExecute = vi.fn().mockResolvedValue(42);
      const registered = await bridge.registerAppFunction(def, mockExecute);

      expect(registered.name).toBe(
        'android__com_example_calculator__CalculatorService_add'
      );
      expect(registered.title).toBe('CalculatorService.add');
      expect(registered.description).toBe('Adds two numbers');
      expect(registered.execute).toBe(mockExecute);

      expect(
        bridge.isToolRegistered(
          'android__com_example_calculator__CalculatorService_add'
        )
      ).toBe(true);
      expect(
        bridge.getToolDefinition(
          'android__com_example_calculator__CalculatorService_add'
        )
      ).toBe(def);
    });

    it('batch maps and registers AppFunctionDefinitions via registerAppFunctions', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const functions: AppFunctionDefinition[] = [
        {
          packageName: 'com.example.notes',
          functionId: 'createNote',
          parameters: [{ name: 'title', dataType: 'string', isRequired: true }],
        },
        {
          packageName: 'com.example.notes',
          functionId: 'getNotes',
          parameters: [],
        },
      ];

      const registered = await bridge.registerAppFunctions(functions);

      expect(registered).toHaveLength(2);
      expect(registered[0].name).toBe('android__com_example_notes__createNote');
      expect(registered[1].name).toBe('android__com_example_notes__getNotes');
      expect(registered[1].annotations?.readOnlyHint).toBe(true);
      expect(bridge.getToolCount()).toBe(2);
    });
  });

  describe('Tool Deregistration & Lifecycle', () => {
    it('unregisters a single tool by name and aborts its AbortController', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const mockTool: WebMCP.ModelContextTool = {
        name: 'test_tool',
        description: 'Test',
        execute: vi.fn(),
      };

      await bridge.registerTool(mockTool);
      const record = bridge.getRegisteredRecord('test_tool');

      expect(bridge.isToolRegistered('test_tool')).toBe(true);
      expect(record?.abortController.signal.aborted).toBe(false);

      const unregistered = bridge.unregisterTool('test_tool');
      expect(unregistered).toBe(true);
      expect(record?.abortController.signal.aborted).toBe(true);
      expect(bridge.isToolRegistered('test_tool')).toBe(false);
      expect(bridge.getToolCount()).toBe(0);

      // Subsequent unregister of non-existent tool returns false
      expect(bridge.unregisterTool('test_tool')).toBe(false);
    });

    it('unregisters all tools and aborts all controllers via unregisterAll / deregisterAll', async () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const tools: WebMCP.ModelContextTool[] = [
        { name: 'tool_1', description: 'Tool 1', execute: vi.fn() },
        { name: 'tool_2', description: 'Tool 2', execute: vi.fn() },
        { name: 'tool_3', description: 'Tool 3', execute: vi.fn() },
      ];

      await bridge.registerTools(tools);
      const records = bridge.getRegisteredRecords();

      expect(bridge.getToolCount()).toBe(3);

      const count = bridge.unregisterAll();
      expect(count).toBe(3);
      expect(bridge.getToolCount()).toBe(0);

      for (const record of records) {
        expect(record.abortController.signal.aborted).toBe(true);
      }

      // Calling again returns 0
      expect(bridge.deregisterAll()).toBe(0);
    });
  });

  describe('AdbManager Lifecycle Integration', () => {
    it('automatically unregisters all tools when AdbManager disconnects', async () => {
      const { manager, triggerDisconnect } = createMockAdbManager();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: manager,
      });

      const tools: WebMCP.ModelContextTool[] = [
        { name: 'tool_1', description: 'Tool 1', execute: vi.fn() },
        { name: 'tool_2', description: 'Tool 2', execute: vi.fn() },
      ];

      await bridge.registerTools(tools);
      expect(bridge.getToolCount()).toBe(2);

      // Trigger device disconnect on AdbManager
      triggerDisconnect();

      expect(bridge.getToolCount()).toBe(0);
    });

    it('automatically unregisters all tools when AdbManager transitions to error or disconnected state', async () => {
      const { manager, triggerStateChange } = createMockAdbManager();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: manager,
      });

      await bridge.registerTool({
        name: 'tool_err',
        description: 'Test',
        execute: vi.fn(),
      });
      expect(bridge.getToolCount()).toBe(1);

      // Trigger error state transition
      triggerStateChange('error');
      expect(bridge.getToolCount()).toBe(0);

      // Re-register and test disconnected state transition
      await bridge.registerTool({
        name: 'tool_disc',
        description: 'Test',
        execute: vi.fn(),
      });
      expect(bridge.getToolCount()).toBe(1);

      triggerStateChange('disconnected');
      expect(bridge.getToolCount()).toBe(0);
    });

    it('respects autoDeregisterOnDisconnect setting', async () => {
      const { manager, triggerDisconnect } = createMockAdbManager();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: manager,
        autoDeregisterOnDisconnect: false,
      });

      expect(bridge.isAutoDeregisterOnDisconnect()).toBe(false);

      await bridge.registerTool({
        name: 'persisted_tool',
        description: 'Test',
        execute: vi.fn(),
      });

      triggerDisconnect();
      // Should not have unregistered because autoDeregisterOnDisconnect is false
      expect(bridge.getToolCount()).toBe(1);

      // Enable and trigger disconnect again
      bridge.setAutoDeregisterOnDisconnect(true);
      expect(bridge.isAutoDeregisterOnDisconnect()).toBe(true);

      triggerDisconnect();
      expect(bridge.getToolCount()).toBe(0);
    });

    it('allows attaching and detaching AdbManager dynamically', async () => {
      const { manager, triggerDisconnect } = createMockAdbManager();
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const detach = bridge.attachAdbManager(manager);
      expect(bridge.getAdbManager()).toBe(manager);

      await bridge.registerTool({
        name: 'tool_dyn',
        description: 'Test',
        execute: vi.fn(),
      });

      // Detach and trigger disconnect
      detach();
      expect(bridge.getAdbManager()).toBeNull();

      triggerDisconnect();
      // Should still be registered
      expect(bridge.getToolCount()).toBe(1);
    });
  });

  describe('WebMCP Tool Change Events', () => {
    it('listens to native toolchange events and notifies subscribed listeners', () => {
      const logSpy = vi.spyOn(logger, 'info');
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });

      const mockListener = vi.fn();
      const unsubscribe = bridge.onToolChange(mockListener);

      const event = new Event('toolchange');
      mockModelContext.dispatchEvent(event);

      expect(mockListener).toHaveBeenCalledWith(event);
      expect(logSpy).toHaveBeenCalledWith(
        'WebMCP',
        'WebMCP toolchange event received',
        expect.objectContaining({ type: 'toolchange' })
      );

      // Unsubscribe
      unsubscribe();
      mockModelContext.dispatchEvent(new Event('toolchange'));
      expect(mockListener).toHaveBeenCalledTimes(1);
    });

    it('stops listening to toolchange events when stopListeningToToolChange is called', () => {
      const bridge = new WebMcpBridge({ modelContext: mockModelContext });
      const mockListener = vi.fn();
      bridge.onToolChange(mockListener);

      bridge.stopListeningToToolChange();

      expect(mockModelContext.removeEventListener).toHaveBeenCalledWith(
        'toolchange',
        expect.any(Function)
      );
    });
  });

  describe('Bridge Disposal & Cleanup', () => {
    it('cleans up all tools, event listeners, and ADB manager when dispose() / destroy() is called', async () => {
      const { manager } = createMockAdbManager();
      const bridge = new WebMcpBridge({
        modelContext: mockModelContext,
        adbManager: manager,
      });

      await bridge.registerTool({
        name: 'tool_dispose',
        description: 'Test',
        execute: vi.fn(),
      });

      expect(bridge.getToolCount()).toBe(1);

      bridge.dispose();

      expect(bridge.getToolCount()).toBe(0);
      expect(bridge.getAdbManager()).toBeNull();
      expect(mockModelContext.removeEventListener).toHaveBeenCalledWith(
        'toolchange',
        expect.any(Function)
      );
    });
  });
});
