/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import { AppFunctionDefinition } from '../types/appfunctions';
import { logger } from '../utils/logger';
import {
  DEFAULT_TOOL_PREFIX,
  MapToolOptions,
  mapAppFunctionToWebMcpTool,
} from './schema-mapper';

/**
 * Record of an active tool registered via WebMcpBridge.
 */
export interface RegisteredToolRecord {
  /**
   * The registered WebMCP ModelContextTool definition.
   */
  tool: WebMCP.ModelContextTool;

  /**
   * Dedicated AbortController managing the lifecycle of this registration.
   */
  abortController: AbortController;

  /**
   * Timestamp when the tool was registered (epoch ms).
   */
  registeredAt: number;

  /**
   * Original AppFunctionDefinition if registered from an on-device AppFunction.
   */
  definition?: AppFunctionDefinition;
}

/**
 * Listener callback for WebMCP tool change events.
 */
export type ToolChangeListener = (event: Event) => void;

/**
 * Configuration options for WebMcpBridge.
 */
export interface WebMcpBridgeOptions {
  /**
   * Explicit ModelContext to use (defaults to native document.modelContext).
   */
  modelContext?: WebMCP.ModelContext;

  /**
   * AdbManager instance to link for automatic tool deregistration upon device disconnection.
   */
  adbManager?: AdbManager;

  /**
   * Whether to automatically start listening for toolchange events on modelContext (default: true).
   */
  listenToToolChange?: boolean;

  /**
   * Whether to automatically deregister tools when ADB disconnects (default: true).
   */
  autoDeregisterOnDisconnect?: boolean;

  /**
   * Default tool name prefix for mapped AppFunctions (default: 'android__').
   */
  toolPrefix?: string;
}

/**
 * Checks whether native WebMCP is available on document.modelContext.
 *
 * @returns True if native document.modelContext is present, false otherwise.
 */
export function isWebMcpSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    'modelContext' in document &&
    Boolean(document.modelContext)
  );
}

/**
 * Returns native document.modelContext if available, or undefined.
 *
 * @returns WebMCP.ModelContext or undefined.
 */
export function getModelContext(): WebMCP.ModelContext | undefined {
  if (typeof document !== 'undefined' && 'modelContext' in document) {
    return document.modelContext;
  }
  return undefined;
}

/**
 * Asserts that native WebMCP is available on document.modelContext, throwing
 * a descriptive error if unavailable.
 *
 * @returns Active WebMCP.ModelContext.
 * @throws Error if document.modelContext is not supported.
 */
export function assertWebMcpSupported(): WebMCP.ModelContext {
  const ctx = getModelContext();
  if (!ctx) {
    throw new Error(
      'WebMCP is not supported in this browser environment. Ensure you are using a browser with native document.modelContext support enabled.'
    );
  }
  return ctx;
}

/**
 * WebMcpBridge manages registration, lifecycle, and deregistration of Android
 * AppFunctions as tools on native document.modelContext.
 */
export class WebMcpBridge {
  private modelContext: WebMCP.ModelContext | null = null;
  private adbManager: AdbManager | null = null;
  private registeredTools: Map<string, RegisteredToolRecord> = new Map();
  private toolChangeListeners: Set<ToolChangeListener> = new Set();
  private toolChangeHandler: ((event: Event) => void) | null = null;
  private adbDisconnectUnsubscribe: (() => void) | null = null;
  private adbStateChangeUnsubscribe: (() => void) | null = null;
  private toolPrefix: string = DEFAULT_TOOL_PREFIX;
  private autoDeregisterOnDisconnect: boolean = true;

  constructor(options: WebMcpBridgeOptions = {}) {
    this.modelContext = options.modelContext ?? getModelContext() ?? null;
    this.toolPrefix = options.toolPrefix ?? DEFAULT_TOOL_PREFIX;
    this.autoDeregisterOnDisconnect = options.autoDeregisterOnDisconnect ?? true;

    if (options.listenToToolChange !== false) {
      this.startListeningToToolChange();
    }

    if (options.adbManager) {
      this.attachAdbManager(options.adbManager);
    }
  }

  /**
   * Whether WebMCP is supported and ready for tool registration.
   */
  isSupported(): boolean {
    return this.modelContext !== null;
  }

  /**
   * Returns the underlying ModelContext instance, if available.
   */
  getModelContext(): WebMCP.ModelContext | null {
    return this.modelContext;
  }

  /**
   * Updates or replaces the ModelContext instance.
   *
   * @param ctx New ModelContext instance or null.
   */
  setModelContext(ctx: WebMCP.ModelContext | null): void {
    const wasListening = this.toolChangeHandler !== null;
    if (wasListening) {
      this.stopListeningToToolChange();
    }

    this.modelContext = ctx;

    if (wasListening && ctx) {
      this.startListeningToToolChange();
    }
  }

  /**
   * Returns the linked AdbManager instance, if attached.
   */
  getAdbManager(): AdbManager | null {
    return this.adbManager;
  }

  /**
   * Attaches an AdbManager to manage lifecycle events (e.g. automatic tool deregistration on disconnect).
   *
   * @param adbManager AdbManager instance.
   * @returns Unsubscribe function to detach the AdbManager.
   */
  attachAdbManager(adbManager: AdbManager): () => void {
    this.detachAdbManager();
    this.adbManager = adbManager;

    this.adbDisconnectUnsubscribe = adbManager.onDisconnect(() => {
      if (this.autoDeregisterOnDisconnect) {
        this.handleDeviceDisconnect();
      }
    });

    this.adbStateChangeUnsubscribe = adbManager.onStateChange((state) => {
      if (
        this.autoDeregisterOnDisconnect &&
        (state === 'disconnected' || state === 'error')
      ) {
        this.handleDeviceDisconnect();
      }
    });

    return () => {
      this.detachAdbManager();
    };
  }

  /**
   * Detaches the currently attached AdbManager and removes lifecycle listeners.
   */
  detachAdbManager(): void {
    if (this.adbDisconnectUnsubscribe) {
      this.adbDisconnectUnsubscribe();
      this.adbDisconnectUnsubscribe = null;
    }
    if (this.adbStateChangeUnsubscribe) {
      this.adbStateChangeUnsubscribe();
      this.adbStateChangeUnsubscribe = null;
    }
    this.adbManager = null;
  }

  /**
   * Configures whether tools should automatically deregister when the device disconnects.
   */
  setAutoDeregisterOnDisconnect(enable: boolean): void {
    this.autoDeregisterOnDisconnect = enable;
  }

  /**
   * Returns whether auto-deregister on disconnect is enabled.
   */
  isAutoDeregisterOnDisconnect(): boolean {
    return this.autoDeregisterOnDisconnect;
  }

  /**
   * Begins listening to native 'toolchange' events on document.modelContext.
   */
  startListeningToToolChange(): void {
    if (this.toolChangeHandler || !this.modelContext) {
      return;
    }

    this.toolChangeHandler = (event: Event) => {
      this.handleToolChangeEvent(event);
    };

    try {
      this.modelContext.addEventListener('toolchange', this.toolChangeHandler);
      logger.debug('WebMCP', 'Subscribed to native WebMCP toolchange events.');
    } catch (err) {
      logger.warn('WebMCP', 'Failed to attach toolchange event listener:', err);
    }
  }

  /**
   * Stops listening to native 'toolchange' events on document.modelContext.
   */
  stopListeningToToolChange(): void {
    if (!this.toolChangeHandler || !this.modelContext) {
      return;
    }

    try {
      this.modelContext.removeEventListener('toolchange', this.toolChangeHandler);
      logger.debug('WebMCP', 'Unsubscribed from native WebMCP toolchange events.');
    } catch (err) {
      logger.warn('WebMCP', 'Failed to remove toolchange event listener:', err);
    }

    this.toolChangeHandler = null;
  }

  /**
   * Subscribes a listener to WebMCP tool change events.
   *
   * @param listener Callback function invoked when a toolchange event occurs.
   * @returns Unsubscribe function.
   */
  onToolChange(listener: ToolChangeListener): () => void {
    this.toolChangeListeners.add(listener);
    return () => {
      this.toolChangeListeners.delete(listener);
    };
  }

  /**
   * Registers a single WebMCP ModelContextTool directly with document.modelContext.
   * Manages registration lifecycle using an internal AbortController.
   *
   * @param tool ModelContextTool definition.
   * @param options Optional registration options (signal, exposedTo).
   */
  async registerTool(
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions
  ): Promise<void> {
    if (!this.modelContext) {
      const err = new Error(
        'WebMCP is not supported: document.modelContext is not available.'
      );
      logger.error('WebMCP', err.message);
      throw err;
    }

    // If already registered with the same name, deregister previous instance first
    if (this.registeredTools.has(tool.name)) {
      this.unregisterTool(tool.name);
    }

    const abortController = new AbortController();

    // Link caller-supplied AbortSignal if provided
    if (options?.signal) {
      if (options.signal.aborted) {
        abortController.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          'abort',
          () => abortController.abort(options.signal?.reason),
          { once: true }
        );
      }
    }

    // Clean up internal map when the abort signal fires
    abortController.signal.addEventListener(
      'abort',
      () => {
        if (this.registeredTools.get(tool.name)?.abortController === abortController) {
          this.registeredTools.delete(tool.name);
        }
      },
      { once: true }
    );

    try {
      await this.modelContext.registerTool(tool, {
        signal: abortController.signal,
        exposedTo: options?.exposedTo,
      });

      const record: RegisteredToolRecord = {
        tool,
        abortController,
        registeredAt: Date.now(),
      };

      this.registeredTools.set(tool.name, record);

      logger.info('WebMCP', `Registered WebMCP tool: ${tool.name}`, {
        title: tool.title,
        description: tool.description,
      });
    } catch (err) {
      logger.error('WebMCP', `Failed to register WebMCP tool '${tool.name}':`, err);
      abortController.abort();
      throw err;
    }
  }

  /**
   * Batch registers an array of WebMCP ModelContextTools.
   *
   * @param tools Array of ModelContextTool objects.
   * @param options Optional registration options.
   */
  async registerTools(
    tools: WebMCP.ModelContextTool[],
    options?: WebMCP.ModelContextRegisterToolOptions
  ): Promise<void> {
    for (const tool of tools) {
      await this.registerTool(tool, options);
    }
  }

  /**
   * Maps an Android AppFunctionDefinition to a WebMCP ModelContextTool and registers it.
   *
   * @param def AppFunctionDefinition discovered from Android device.
   * @param optionsOrExecute Mapping options or tool execution callback.
   * @param registerOptions Registration options (signal, exposedTo).
   * @returns Registered WebMCP ModelContextTool.
   */
  async registerAppFunction(
    def: AppFunctionDefinition,
    optionsOrExecute?: WebMCP.ToolExecuteCallback | MapToolOptions,
    registerOptions?: WebMCP.ModelContextRegisterToolOptions
  ): Promise<WebMCP.ModelContextTool> {
    const mapOptions: MapToolOptions =
      typeof optionsOrExecute === 'function'
        ? { execute: optionsOrExecute, prefix: this.toolPrefix }
        : { prefix: this.toolPrefix, ...optionsOrExecute };

    const tool = mapAppFunctionToWebMcpTool(def, mapOptions);
    await this.registerTool(tool, registerOptions);

    const record = this.registeredTools.get(tool.name);
    if (record) {
      record.definition = def;
    }

    return tool;
  }

  /**
   * Batch maps and registers multiple Android AppFunctionDefinitions.
   *
   * @param functions Array of AppFunctionDefinitions.
   * @param optionsOrExecute Mapping options or shared execution callback.
   * @param registerOptions Registration options.
   * @returns Array of registered WebMCP ModelContextTools.
   */
  async registerAppFunctions(
    functions: AppFunctionDefinition[],
    optionsOrExecute?: WebMCP.ToolExecuteCallback | MapToolOptions,
    registerOptions?: WebMCP.ModelContextRegisterToolOptions
  ): Promise<WebMCP.ModelContextTool[]> {
    const registered: WebMCP.ModelContextTool[] = [];

    for (const def of functions) {
      const tool = await this.registerAppFunction(
        def,
        optionsOrExecute,
        registerOptions
      );
      registered.push(tool);
    }

    logger.info(
      'WebMCP',
      `Batch registered ${registered.length} AppFunction(s) as native WebMCP tool(s).`
    );

    return registered;
  }

  /**
   * Deregisters a specific tool by name by triggering its AbortController.
   *
   * @param toolName Name of the tool to unregister.
   * @returns True if the tool was found and deregistered, false otherwise.
   */
  unregisterTool(toolName: string): boolean {
    const record = this.registeredTools.get(toolName);
    if (!record) {
      return false;
    }

    record.abortController.abort();
    this.registeredTools.delete(toolName);
    logger.info('WebMCP', `Deregistered WebMCP tool: ${toolName}`);
    return true;
  }

  /**
   * Deregisters all active tools managed by this bridge by triggering their AbortControllers.
   *
   * @returns Number of tools deregistered.
   */
  unregisterAll(): number {
    const count = this.registeredTools.size;
    if (count === 0) {
      return 0;
    }

    for (const record of this.registeredTools.values()) {
      try {
        record.abortController.abort();
      } catch (err) {
        logger.debug('WebMCP', 'Error aborting tool controller:', err);
      }
    }

    this.registeredTools.clear();
    logger.info('WebMCP', `Deregistered all ${count} WebMCP tool(s).`);
    return count;
  }

  /**
   * Alias for unregisterAll().
   */
  deregisterAll(): number {
    return this.unregisterAll();
  }

  /**
   * Checks whether a tool is currently registered by name.
   *
   * @param toolName Name of the tool.
   * @returns True if registered, false otherwise.
   */
  isToolRegistered(toolName: string): boolean {
    return this.registeredTools.has(toolName);
  }

  /**
   * Returns the registered ModelContextTool by name.
   *
   * @param toolName Name of the tool.
   * @returns ModelContextTool or undefined.
   */
  getRegisteredTool(toolName: string): WebMCP.ModelContextTool | undefined {
    return this.registeredTools.get(toolName)?.tool;
  }

  /**
   * Returns the original AppFunctionDefinition for a registered tool.
   *
   * @param toolName Name of the tool.
   * @returns AppFunctionDefinition or undefined.
   */
  getToolDefinition(toolName: string): AppFunctionDefinition | undefined {
    return this.registeredTools.get(toolName)?.definition;
  }

  /**
   * Returns a list of all currently registered tool names.
   */
  getRegisteredToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }

  /**
   * Returns an array of all currently registered ModelContextTools.
   */
  getRegisteredTools(): WebMCP.ModelContextTool[] {
    return Array.from(this.registeredTools.values()).map((r) => r.tool);
  }

  /**
   * Returns an array of all active tool registration records.
   */
  getRegisteredRecords(): RegisteredToolRecord[] {
    return Array.from(this.registeredTools.values());
  }

  /**
   * Returns the registration record for a specific tool.
   */
  getRegisteredRecord(toolName: string): RegisteredToolRecord | undefined {
    return this.registeredTools.get(toolName);
  }

  /**
   * Returns the count of currently registered tools.
   */
  getToolCount(): number {
    return this.registeredTools.size;
  }

  /**
   * Destroys the bridge, deregistering all tools, stopping event listeners,
   * and detaching from the AdbManager.
   */
  dispose(): void {
    this.unregisterAll();
    this.stopListeningToToolChange();
    this.detachAdbManager();
    this.toolChangeListeners.clear();
  }

  /**
   * Alias for dispose().
   */
  destroy(): void {
    this.dispose();
  }

  private handleToolChangeEvent(event: Event): void {
    logger.info('WebMCP', 'WebMCP toolchange event received', {
      type: event.type,
      timestamp: Date.now(),
    });

    for (const listener of this.toolChangeListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('WebMCP', 'Error in toolchange listener:', err);
      }
    }
  }

  private handleDeviceDisconnect(): void {
    if (this.registeredTools.size > 0) {
      logger.warn(
        'WebMCP',
        `Device disconnected: automatically deregistering ${this.registeredTools.size} tool(s)...`
      );
      this.unregisterAll();
    }
  }
}

export { WebMcpBridge as WebMCPBridge };
