/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import { AppFunctionsExecutor } from '../android/executor';
import { WebMcpBridge } from '../webmcp/bridge';
import {
  AppFunctionDefinition,
  AppFunctionExecutionResult,
  AppFunctionParameter,
} from '../types/appfunctions';
import { formatToolName, formatToolTitle } from '../webmcp/schema-mapper';
import { logger } from '../utils/logger';

export interface FunctionTesterOptions {
  adbManager?: AdbManager;
  executor?: AppFunctionsExecutor;
  bridge?: WebMcpBridge;
  defaultTimeoutMs?: number;
  onExecutionComplete?: (result: AppFunctionExecutionResult) => void;
}

/**
 * FunctionTester UI component allows developers to inspect selected AppFunctions,
 * dynamically generate input forms from schemas, edit raw JSON parameters,
 * manually invoke functions on the connected Android device, and view formatted
 * results with real-time status badges and execution telemetry.
 */
export class FunctionTester {
  private container: HTMLElement;
  private adbManager: AdbManager;
  private executor: AppFunctionsExecutor;
  private bridge: WebMcpBridge | null = null;
  private defaultTimeoutMs = 10000;

  private selectedFunction: AppFunctionDefinition | null = null;
  private inputMode: 'form' | 'json' = 'form';
  private formValues: Record<string, unknown> = {};
  private rawJsonText = '{}';
  private isExecuting = false;
  private executionResult: AppFunctionExecutionResult | null = null;
  private formValidationErrors: Record<string, string> = {};
  private jsonParseError: string | null = null;
  private isRawOutputVisible = false;

  private copiedOutputTimeout: ReturnType<typeof setTimeout> | null = null;
  private copiedCommandTimeout: ReturnType<typeof setTimeout> | null = null;
  private executionListeners: Set<(result: AppFunctionExecutionResult) => void> = new Set();
  private unsubscribeDisconnect: (() => void) | null = null;

  constructor(
    container: HTMLElement | string,
    options: FunctionTesterOptions = {}
  ) {
    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (!el) {
        throw new Error(`FunctionTester: element with id "${container}" not found.`);
      }
      this.container = el;
    } else {
      this.container = container;
    }

    this.adbManager = options.adbManager ?? new AdbManager();
    this.executor =
      options.executor ??
      new AppFunctionsExecutor(this.adbManager, {
        defaultTimeoutMs: options.defaultTimeoutMs ?? this.defaultTimeoutMs,
      });
    this.bridge = options.bridge ?? null;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10000;

    if (options.onExecutionComplete) {
      this.executionListeners.add(options.onExecutionComplete);
    }

    this.bindAdbEvents();
    this.render();
  }

  /**
   * Returns the currently selected AppFunction definition.
   */
  getSelectedFunction(): AppFunctionDefinition | null {
    return this.selectedFunction;
  }

  /**
   * Returns the linked WebMcpBridge instance, if attached.
   */
  getBridge(): WebMcpBridge | null {
    return this.bridge;
  }

  /**
   * Selects an AppFunction to test and initializes the form fields.
   */
  selectFunction(def: AppFunctionDefinition | null): void {
    this.selectedFunction = def;
    this.executionResult = null;
    this.formValidationErrors = {};
    this.jsonParseError = null;
    this.isRawOutputVisible = false;

    if (def) {
      this.initializeFormValues(def);
    } else {
      this.formValues = {};
      this.rawJsonText = '{}';
    }

    this.render();
  }

  /**
   * Sets the active input mode ('form' or 'json').
   */
  setInputMode(mode: 'form' | 'json'): void {
    if (this.inputMode === mode) {
      return;
    }

    if (mode === 'json') {
      // Synchronize form values to raw JSON text
      this.rawJsonText = JSON.stringify(this.formValues, null, 2);
      this.jsonParseError = null;
    } else {
      // Synchronize raw JSON text to form values if valid
      try {
        const parsed = JSON.parse(this.rawJsonText || '{}');
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          this.formValues = parsed as Record<string, unknown>;
          this.jsonParseError = null;
        }
      } catch (err) {
        this.jsonParseError = 'Cannot switch to form mode: invalid JSON syntax.';
        this.render();
        return;
      }
    }

    this.inputMode = mode;
    this.render();
  }

  /**
   * Returns the current form parameter values.
   */
  getFormValues(): Record<string, unknown> {
    return { ...this.formValues };
  }

  /**
   * Sets a specific form parameter value.
   */
  setFormValue(key: string, value: unknown): void {
    this.formValues[key] = value;
    this.rawJsonText = JSON.stringify(this.formValues, null, 2);
    if (this.formValidationErrors[key]) {
      delete this.formValidationErrors[key];
    }
  }

  /**
   * Subscribes a listener to execution completion events.
   */
  onExecutionComplete(
    listener: (result: AppFunctionExecutionResult) => void
  ): () => void {
    this.executionListeners.add(listener);
    return () => {
      this.executionListeners.delete(listener);
    };
  }

  /**
   * Resets form values to schema defaults.
   */
  resetForm(): void {
    if (this.selectedFunction) {
      this.initializeFormValues(this.selectedFunction);
    } else {
      this.formValues = {};
      this.rawJsonText = '{}';
    }
    this.formValidationErrors = {};
    this.jsonParseError = null;
    this.executionResult = null;
    this.isRawOutputVisible = false;
    this.render();
  }

  /**
   * Executes the currently selected AppFunction with current parameters.
   */
  async execute(): Promise<AppFunctionExecutionResult | null> {
    if (!this.selectedFunction) {
      return null;
    }

    if (!this.adbManager.isConnected()) {
      this.executionResult = {
        success: false,
        error: 'Android device is not connected.',
        executionTimeMs: 0,
      };
      this.render();
      return this.executionResult;
    }

    let payloadToExecute: unknown;

    if (this.inputMode === 'json') {
      try {
        payloadToExecute = this.rawJsonText ? JSON.parse(this.rawJsonText) : {};
        this.jsonParseError = null;
      } catch (err) {
        this.jsonParseError = 'Invalid JSON parameter payload.';
        this.render();
        return null;
      }
    } else {
      const isValid = this.validateForm();
      if (!isValid) {
        this.render();
        return null;
      }
      payloadToExecute = this.preparePayloadFromForm();
    }

    this.isExecuting = true;
    this.executionResult = null;
    this.render();

    try {
      logger.info(
        'APP',
        `Executing AppFunction '${this.selectedFunction.functionId}' on package '${this.selectedFunction.packageName}'...`
      );

      const result = await this.executor.execute(
        this.selectedFunction.packageName,
        this.selectedFunction.functionId,
        payloadToExecute,
        { timeoutMs: this.defaultTimeoutMs }
      );

      this.isExecuting = false;
      this.executionResult = result;
      this.render();

      for (const listener of this.executionListeners) {
        try {
          listener(result);
        } catch (err) {
          logger.error('APP', 'Error in execution listener:', err);
        }
      }

      return result;
    } catch (err) {
      this.isExecuting = false;
      this.executionResult = {
        success: false,
        error: err instanceof Error ? err.message : 'Execution failed.',
        executionTimeMs: 0,
      };
      this.render();
      return this.executionResult;
    }
  }

  /**
   * Cleans up listeners and timers.
   */
  destroy(): void {
    if (this.unsubscribeDisconnect) {
      this.unsubscribeDisconnect();
      this.unsubscribeDisconnect = null;
    }
    if (this.copiedOutputTimeout) {
      clearTimeout(this.copiedOutputTimeout);
      this.copiedOutputTimeout = null;
    }
    if (this.copiedCommandTimeout) {
      clearTimeout(this.copiedCommandTimeout);
      this.copiedCommandTimeout = null;
    }
    this.executionListeners.clear();
    this.container.innerHTML = '';
  }

  private bindAdbEvents(): void {
    this.unsubscribeDisconnect = this.adbManager.onDisconnect(() => {
      this.isExecuting = false;
      this.render();
    });
  }

  private initializeFormValues(def: AppFunctionDefinition): void {
    const values: Record<string, unknown> = {};

    for (const param of def.parameters) {
      if (param.defaultValue !== undefined) {
        values[param.name] = param.defaultValue;
      } else {
        switch (param.dataType) {
          case 'string':
            values[param.name] = '';
            break;
          case 'int':
          case 'long':
          case 'float':
          case 'double':
            values[param.name] = param.isRequired ? 0 : undefined;
            break;
          case 'boolean':
            values[param.name] = false;
            break;
          case 'array':
            values[param.name] = [];
            break;
          case 'object':
            values[param.name] = {};
            break;
          default:
            values[param.name] = '';
            break;
        }
      }
    }

    this.formValues = values;
    this.rawJsonText = JSON.stringify(values, null, 2);
  }

  private validateForm(): boolean {
    this.formValidationErrors = {};

    if (!this.selectedFunction) {
      return false;
    }

    for (const param of this.selectedFunction.parameters) {
      const val = this.formValues[param.name];

      if (param.isRequired) {
        if (val === undefined || val === null || val === '') {
          this.formValidationErrors[param.name] = 'This parameter is required.';
          continue;
        }
      }

      if (val !== undefined && val !== null && val !== '') {
        if (param.dataType === 'int' || param.dataType === 'long') {
          const num = Number(val);
          if (isNaN(num) || !Number.isInteger(num)) {
            this.formValidationErrors[param.name] = 'Must be a valid integer.';
          }
        } else if (param.dataType === 'float' || param.dataType === 'double') {
          const num = Number(val);
          if (isNaN(num)) {
            this.formValidationErrors[param.name] = 'Must be a valid number.';
          }
        } else if (param.dataType === 'array' && typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            if (!Array.isArray(parsed)) {
              this.formValidationErrors[param.name] = 'Must be a valid JSON array (e.g. ["item1", "item2"]).';
            }
          } catch {
            this.formValidationErrors[param.name] = 'Invalid JSON array syntax.';
          }
        } else if (param.dataType === 'object' && typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
              this.formValidationErrors[param.name] = 'Must be a valid JSON object (e.g. {"key": "val"}).';
            }
          } catch {
            this.formValidationErrors[param.name] = 'Invalid JSON object syntax.';
          }
        }
      }
    }

    return Object.keys(this.formValidationErrors).length === 0;
  }

  private preparePayloadFromForm(): Record<string, unknown> {
    if (!this.selectedFunction) {
      return {};
    }

    const payload: Record<string, unknown> = {};

    for (const param of this.selectedFunction.parameters) {
      const rawVal = this.formValues[param.name];

      // Omit optional empty values
      if (!param.isRequired && (rawVal === undefined || rawVal === '' || rawVal === null)) {
        continue;
      }

      switch (param.dataType) {
        case 'int':
        case 'long':
          payload[param.name] = rawVal !== undefined && rawVal !== '' ? parseInt(String(rawVal), 10) : 0;
          break;
        case 'float':
        case 'double':
          payload[param.name] = rawVal !== undefined && rawVal !== '' ? parseFloat(String(rawVal)) : 0.0;
          break;
        case 'boolean':
          payload[param.name] = Boolean(rawVal);
          break;
        case 'array':
          if (typeof rawVal === 'string') {
            try {
              payload[param.name] = JSON.parse(rawVal);
            } catch {
              payload[param.name] = [];
            }
          } else {
            payload[param.name] = Array.isArray(rawVal) ? rawVal : [];
          }
          break;
        case 'object':
          if (typeof rawVal === 'string') {
            try {
              payload[param.name] = JSON.parse(rawVal);
            } catch {
              payload[param.name] = {};
            }
          } else {
            payload[param.name] = typeof rawVal === 'object' && rawVal !== null ? rawVal : {};
          }
          break;
        default:
          payload[param.name] = rawVal !== undefined ? String(rawVal) : '';
          break;
      }
    }

    return payload;
  }

  /**
   * Constructs the CLI command corresponding to current invocation.
   */
  private getShellCommand(): string {
    if (!this.selectedFunction) {
      return '';
    }

    const params = this.inputMode === 'json'
      ? (this.rawJsonText ? JSON.parse(this.rawJsonText || '{}') : {})
      : this.preparePayloadFromForm();

    return AppFunctionsExecutor.buildCommand(
      this.selectedFunction.packageName,
      this.selectedFunction.functionId,
      params
    );
  }

  /**
   * Renders the FunctionTester UI.
   */
  render(): void {
    const isConnected = this.adbManager.isConnected();
    const fn = this.selectedFunction;

    this.container.innerHTML = `
      <div class="tester-view-inner">
        ${this.renderHeader(fn, isConnected)}
        ${
          !fn
            ? this.renderEmptyState()
            : `
          ${this.renderFunctionMeta(fn)}
          ${this.renderInputSection(fn)}
          ${this.renderActionBar(isConnected)}
          ${this.renderResultSection()}
        `
        }
      </div>
    `;

    this.attachDomListeners();
  }

  private renderHeader(fn: AppFunctionDefinition | null, isConnected: boolean): string {
    return `
      <div class="tester-header">
        <div class="tester-title-group">
          <div class="tester-title">
            <span class="tester-icon">⚡</span>
            <h3>Interactive Tester</h3>
          </div>
          ${
            fn
              ? `<span class="tester-badge ${isConnected ? 'badge-ready' : 'badge-offline'}">
                   ${isConnected ? 'Device Connected' : 'Device Offline'}
                 </span>`
              : ''
          }
        </div>
        ${
          fn
            ? `
          <div class="mode-tabs">
            <button
              type="button"
              class="tab-btn ${this.inputMode === 'form' ? 'active' : ''}"
              id="tab-mode-form"
            >
              Dynamic Form
            </button>
            <button
              type="button"
              class="tab-btn ${this.inputMode === 'json' ? 'active' : ''}"
              id="tab-mode-json"
            >
              Raw JSON
            </button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private renderEmptyState(): string {
    return `
      <div class="tester-empty-state">
        <span class="empty-icon">👈</span>
        <h4>Select an AppFunction</h4>
        <p>Choose an AppFunction from the catalog on the left to dynamically generate its parameter input form and execute it over WebUSB.</p>
      </div>
    `;
  }

  private renderFunctionMeta(fn: AppFunctionDefinition): string {
    const title = formatToolTitle(fn);
    const toolName = formatToolName(fn);

    return `
      <div class="tester-function-banner">
        <div class="banner-top-row">
          <div class="banner-title-area">
            <h4 class="banner-fn-name" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
            <div class="banner-package-name" title="Android Package">
              <span>📦 ${escapeHtml(fn.packageName)}</span>
            </div>
          </div>
          <div class="banner-tool-code" title="WebMCP ModelContext Tool Name">
            <code>${escapeHtml(toolName)}</code>
          </div>
        </div>
        ${
          fn.description
            ? `<p class="banner-description">${escapeHtml(fn.description)}</p>`
            : ''
        }
      </div>
    `;
  }

  private renderInputSection(fn: AppFunctionDefinition): string {
    if (this.inputMode === 'json') {
      return `
        <div class="tester-input-section json-mode-section">
          <div class="section-label-row">
            <label for="raw-json-input" class="section-label">JSON Parameter Payload:</label>
            <span class="format-hint">Valid JSON object</span>
          </div>
          <textarea
            class="form-input form-textarea font-mono ${this.jsonParseError ? 'input-error' : ''}"
            id="raw-json-input"
            rows="7"
            placeholder='{"param": "value"}'
            spellcheck="false"
          >${escapeHtml(this.rawJsonText)}</textarea>
          ${
            this.jsonParseError
              ? `<div class="field-error">${escapeHtml(this.jsonParseError)}</div>`
              : ''
          }
        </div>
      `;
    }

    // Dynamic Form Mode
    if (fn.parameters.length === 0) {
      return `
        <div class="tester-input-section form-mode-section">
          <div class="no-params-card">
            <span class="info-icon">ℹ️</span>
            <span>This AppFunction requires no input parameters. Click Execute below to run.</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="tester-input-section form-mode-section">
        <div class="form-grid">
          ${fn.parameters.map((p) => this.renderFormField(p)).join('')}
        </div>
      </div>
    `;
  }

  private renderFormField(param: AppFunctionParameter): string {
    const val = this.formValues[param.name];
    const error = this.formValidationErrors[param.name];
    const fieldId = `param-input-${escapeHtml(param.name)}`;

    return `
      <div class="form-field-group ${error ? 'field-has-error' : ''}" data-param="${escapeHtml(param.name)}">
        <div class="field-label-row">
          <label for="${fieldId}" class="field-label">
            ${escapeHtml(param.name)}
          </label>
          <div class="field-meta-badges">
            <span class="type-badge type-${param.dataType.toLowerCase()}">${escapeHtml(param.dataType)}</span>
            ${
              param.isRequired
                ? '<span class="badge-req req-yes">Required</span>'
                : '<span class="badge-req req-no">Optional</span>'
            }
          </div>
        </div>

        ${this.renderFormControl(param, fieldId, val)}

        ${
          param.description
            ? `<div class="field-help-text">${escapeHtml(param.description)}</div>`
            : ''
        }
        ${error ? `<div class="field-error">${escapeHtml(error)}</div>` : ''}
      </div>
    `;
  }

  private renderFormControl(
    param: AppFunctionParameter,
    fieldId: string,
    val: unknown
  ): string {
    const errorClass = this.formValidationErrors[param.name] ? 'input-error' : '';

    switch (param.dataType) {
      case 'boolean':
        return `
          <select
            class="form-input form-select ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
          >
            <option value="true" ${val === true ? 'selected' : ''}>true</option>
            <option value="false" ${val === false || val === undefined ? 'selected' : ''}>false</option>
          </select>
        `;

      case 'int':
      case 'long':
        return `
          <input
            type="number"
            step="1"
            class="form-input ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
            value="${val !== undefined ? escapeHtml(String(val)) : ''}"
            placeholder="${param.defaultValue !== undefined ? String(param.defaultValue) : 'e.g. 0'}"
          />
        `;

      case 'float':
      case 'double':
        return `
          <input
            type="number"
            step="any"
            class="form-input ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
            value="${val !== undefined ? escapeHtml(String(val)) : ''}"
            placeholder="${param.defaultValue !== undefined ? String(param.defaultValue) : 'e.g. 0.0'}"
          />
        `;

      case 'array':
        const arrayStr =
          typeof val === 'string'
            ? val
            : JSON.stringify(Array.isArray(val) ? val : [], null, 2);
        return `
          <textarea
            class="form-input form-textarea font-mono ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
            rows="3"
            placeholder='["item1", "item2"]'
            spellcheck="false"
          >${escapeHtml(arrayStr)}</textarea>
        `;

      case 'object':
        const objStr =
          typeof val === 'string'
            ? val
            : JSON.stringify(typeof val === 'object' && val !== null ? val : {}, null, 2);
        return `
          <textarea
            class="form-input form-textarea font-mono ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
            rows="3"
            placeholder='{"key": "value"}'
            spellcheck="false"
          >${escapeHtml(objStr)}</textarea>
        `;

      case 'string':
      default:
        // Use textarea if parameter description or name hints at multiline/long text
        const isLongText =
          param.name.toLowerCase().includes('body') ||
          param.name.toLowerCase().includes('content') ||
          param.name.toLowerCase().includes('message') ||
          param.name.toLowerCase().includes('text') ||
          param.name.toLowerCase().includes('query') ||
          (param.description && param.description.length > 60);

        if (isLongText) {
          return `
            <textarea
              class="form-input form-textarea ${errorClass}"
              id="${fieldId}"
              data-param-name="${escapeHtml(param.name)}"
              rows="3"
              placeholder="${param.defaultValue !== undefined ? String(param.defaultValue) : 'Enter text...'}"
            >${val !== undefined ? escapeHtml(String(val)) : ''}</textarea>
          `;
        }

        return `
          <input
            type="text"
            class="form-input ${errorClass}"
            id="${fieldId}"
            data-param-name="${escapeHtml(param.name)}"
            value="${val !== undefined ? escapeHtml(String(val)) : ''}"
            placeholder="${param.defaultValue !== undefined ? String(param.defaultValue) : 'Enter value...'}"
          />
        `;
    }
  }

  private renderActionBar(isConnected: boolean): string {
    const isBusy = this.isExecuting;
    const canExecute = isConnected && !isBusy && this.selectedFunction !== null;

    return `
      <div class="tester-action-bar">
        <div class="action-primary-group">
          <button
            type="button"
            class="btn btn-primary btn-execute ${isBusy ? 'btn-loading' : ''}"
            id="btn-execute-fn"
            ${!canExecute ? 'disabled' : ''}
            title="${isConnected ? 'Execute this AppFunction on device' : 'Connect Android device to execute'}"
          >
            ${
              isBusy
                ? '<span class="spinner"></span> Executing...'
                : '<span class="btn-icon">⚡</span> Execute AppFunction'
            }
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-reset"
            id="btn-reset-form"
            ${isBusy ? 'disabled' : ''}
            title="Reset parameters to schema defaults"
          >
            Reset
          </button>
        </div>

        <div class="action-secondary-group">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            id="btn-copy-command"
            title="Copy ADB shell CLI command"
          >
            📋 Copy Command
          </button>
        </div>
      </div>
    `;
  }

  private renderResultSection(): string {
    if (this.isExecuting) {
      return `
        <div class="tester-result-container result-executing">
          <div class="result-header">
            <span class="spinner spinner-large"></span>
            <h5>Executing AppFunction on device...</h5>
          </div>
          <p class="executing-hint">Sending sanitized JSON parameters over WebUSB via ADB shell...</p>
        </div>
      `;
    }

    if (!this.executionResult) {
      return '';
    }

    const res = this.executionResult;
    const isSuccess = res.success;
    const jsonFormatted = res.data !== undefined ? JSON.stringify(res.data, null, 2) : '{}';

    return `
      <div class="tester-result-container ${isSuccess ? 'result-success' : 'result-error'}">
        <div class="result-header">
          <div class="result-status-group">
            <span class="status-badge ${isSuccess ? 'badge-success' : 'badge-error'}">
              ${isSuccess ? '✓ Success' : '✕ Error'}
            </span>
            <span class="latency-badge" title="Execution latency">
              ⚡ ${res.executionTimeMs}ms
            </span>
          </div>
          <div class="result-actions">
            <button
              type="button"
              class="btn-copy-result"
              id="btn-copy-result"
              title="Copy result JSON to clipboard"
            >
              📋 Copy JSON
            </button>
            ${
              res.rawOutput && res.rawOutput !== jsonFormatted
                ? `
              <button
                type="button"
                class="btn-toggle-raw"
                id="btn-toggle-raw"
                title="Toggle raw ADB output"
              >
                ${this.isRawOutputVisible ? 'Hide Raw Output' : 'View Raw Output'}
              </button>
            `
                : ''
            }
          </div>
        </div>

        ${
          !isSuccess && res.error
            ? `
          <div class="result-error-box">
            <span class="error-icon">⚠️</span>
            <div class="error-content">
              <strong>Execution Error:</strong>
              <p>${escapeHtml(res.error)}</p>
            </div>
          </div>
        `
            : ''
        }

        <div class="result-body">
          <pre class="json-code-block"><code class="json-code">${escapeHtml(jsonFormatted)}</code></pre>
        </div>

        ${
          this.isRawOutputVisible && res.rawOutput
            ? `
          <div class="raw-output-drawer">
            <div class="raw-label">Raw CLI Output:</div>
            <pre class="raw-code-block"><code>${escapeHtml(res.rawOutput)}</code></pre>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private attachDomListeners(): void {
    // Mode tabs
    const tabForm = this.container.querySelector<HTMLButtonElement>('#tab-mode-form');
    if (tabForm) {
      tabForm.onclick = () => this.setInputMode('form');
    }

    const tabJson = this.container.querySelector<HTMLButtonElement>('#tab-mode-json');
    if (tabJson) {
      tabJson.onclick = () => this.setInputMode('json');
    }

    // Raw JSON input
    const rawJsonInput = this.container.querySelector<HTMLTextAreaElement>('#raw-json-input');
    if (rawJsonInput) {
      rawJsonInput.oninput = () => {
        this.rawJsonText = rawJsonInput.value;
        try {
          const parsed = JSON.parse(this.rawJsonText || '{}');
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            this.formValues = parsed as Record<string, unknown>;
          }
          this.jsonParseError = null;
        } catch {
          this.jsonParseError = 'Invalid JSON syntax.';
        }
      };
    }

    // Dynamic Form field inputs
    const inputs = this.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      '[data-param-name]'
    );
    inputs.forEach((input) => {
      const name = input.getAttribute('data-param-name');
      if (!name) {
        return;
      }

      input.oninput = () => {
        if (input instanceof HTMLSelectElement) {
          this.setFormValue(name, input.value === 'true');
        } else if (input.type === 'number') {
          this.setFormValue(name, input.value === '' ? undefined : Number(input.value));
        } else {
          this.setFormValue(name, input.value);
        }
      };

      input.onchange = () => {
        if (input instanceof HTMLSelectElement) {
          this.setFormValue(name, input.value === 'true');
        }
      };
    });

    // Execute button
    const btnExecute = this.container.querySelector<HTMLButtonElement>('#btn-execute-fn');
    if (btnExecute) {
      btnExecute.onclick = () => {
        void this.execute();
      };
    }

    // Reset button
    const btnReset = this.container.querySelector<HTMLButtonElement>('#btn-reset-form');
    if (btnReset) {
      btnReset.onclick = () => {
        this.resetForm();
      };
    }

    // Copy command button
    const btnCopyCommand = this.container.querySelector<HTMLButtonElement>('#btn-copy-command');
    if (btnCopyCommand) {
      btnCopyCommand.onclick = async () => {
        const cmd = this.getShellCommand();
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(cmd);
          }
          btnCopyCommand.innerText = '✅ Copied!';
          if (this.copiedCommandTimeout) {
            clearTimeout(this.copiedCommandTimeout);
          }
          this.copiedCommandTimeout = setTimeout(() => {
            btnCopyCommand.innerText = '📋 Copy Command';
          }, 2000);
        } catch {
          btnCopyCommand.innerText = 'Copied!';
        }
      };
    }

    // Copy result button
    const btnCopyResult = this.container.querySelector<HTMLButtonElement>('#btn-copy-result');
    if (btnCopyResult) {
      btnCopyResult.onclick = async () => {
        const jsonText = this.executionResult?.data !== undefined
          ? JSON.stringify(this.executionResult.data, null, 2)
          : '{}';
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(jsonText);
          }
          btnCopyResult.innerText = '✅ Copied!';
          if (this.copiedOutputTimeout) {
            clearTimeout(this.copiedOutputTimeout);
          }
          this.copiedOutputTimeout = setTimeout(() => {
            btnCopyResult.innerText = '📋 Copy JSON';
          }, 2000);
        } catch {
          btnCopyResult.innerText = 'Copied!';
        }
      };
    }

    // Toggle raw output button
    const btnToggleRaw = this.container.querySelector<HTMLButtonElement>('#btn-toggle-raw');
    if (btnToggleRaw) {
      btnToggleRaw.onclick = () => {
        this.isRawOutputVisible = !this.isRawOutputVisible;
        this.render();
      };
    }
  }
}

/**
 * Escapes HTML entities in strings.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
