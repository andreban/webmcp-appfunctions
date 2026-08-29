/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import { AppFunctionsDiscovery } from '../android/discovery';
import { WebMcpBridge } from '../webmcp/bridge';
import {
  AppFunctionDataType,
  AppFunctionDefinition,
  AppFunctionParameter,
  DiscoveryOptions,
} from '../types/appfunctions';
import { formatToolName, formatToolTitle } from '../webmcp/schema-mapper';
import { logger } from '../utils/logger';

export interface FunctionCatalogOptions {
  adbManager?: AdbManager;
  discovery?: AppFunctionsDiscovery;
  bridge?: WebMcpBridge;
  autoDiscover?: boolean;
  onSelectFunction?: (def: AppFunctionDefinition) => void;
}

/**
 * FunctionCatalog UI component renders the list of discovered AppFunctions
 * grouped by Android package, featuring search/filter capabilities, parameter
 * documentation, type inspection, and selection for testing.
 */
export class FunctionCatalog {
  private container: HTMLElement;
  private adbManager: AdbManager;
  private discovery: AppFunctionsDiscovery;
  private bridge: WebMcpBridge | null = null;

  private functions: AppFunctionDefinition[] = [];
  private filteredFunctions: AppFunctionDefinition[] = [];
  private selectedFunctionId: string | null = null;
  private searchQuery = '';
  private selectedPackageFilter = '';
  private isDiscovering = false;
  private discoveryError: string | null = null;
  private expandedFunctionKeys: Set<string> = new Set();
  private collapsedPackages: Set<string> = new Set();
  private selectListeners: Set<(def: AppFunctionDefinition) => void> = new Set();

  private unsubscribeState: (() => void) | null = null;
  private unsubscribeDisconnect: (() => void) | null = null;

  constructor(
    container: HTMLElement | string,
    options: FunctionCatalogOptions = {}
  ) {
    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (!el) {
        throw new Error(`FunctionCatalog: element with id "${container}" not found.`);
      }
      this.container = el;
    } else {
      this.container = container;
    }

    this.adbManager = options.adbManager ?? new AdbManager();
    this.discovery = options.discovery ?? new AppFunctionsDiscovery(this.adbManager);
    this.bridge = options.bridge ?? null;

    if (options.onSelectFunction) {
      this.selectListeners.add(options.onSelectFunction);
    }

    this.bindAdbEvents();
    this.render();

    if (options.autoDiscover && this.adbManager.isConnected()) {
      void this.discover();
    }
  }

  /**
   * Returns the array of all discovered functions.
   */
  getFunctions(): AppFunctionDefinition[] {
    return this.functions;
  }

  /**
   * Returns the array of functions matching active search and package filters.
   */
  getFilteredFunctions(): AppFunctionDefinition[] {
    return this.filteredFunctions;
  }

  /**
   * Returns the currently selected AppFunctionDefinition, if any.
   */
  getSelectedFunction(): AppFunctionDefinition | null {
    if (!this.selectedFunctionId) {
      return null;
    }
    return (
      this.functions.find(
        (fn) => this.getFunctionKey(fn) === this.selectedFunctionId
      ) ?? null
    );
  }

  /**
   * Sets the discovered functions directly (e.g. for testing or external hydration).
   */
  setFunctions(functions: AppFunctionDefinition[]): void {
    this.functions = [...functions];
    this.discoveryError = null;
    this.applyFilters();
    this.render();
  }

  /**
   * Subscribes a listener to function selection events.
   *
   * @param listener Callback invoked when a function is selected.
   * @returns Unsubscribe function.
   */
  onSelectFunction(listener: (def: AppFunctionDefinition) => void): () => void {
    this.selectListeners.add(listener);
    return () => {
      this.selectListeners.delete(listener);
    };
  }

  /**
   * Selects a function by its unique key or definition.
   */
  selectFunction(
    functionKeyOrDef: string | AppFunctionDefinition | null
  ): void {
    if (!functionKeyOrDef) {
      this.selectedFunctionId = null;
      this.render();
      return;
    }

    let targetKey: string;
    let targetDef: AppFunctionDefinition | undefined;

    if (typeof functionKeyOrDef === 'string') {
      targetKey = functionKeyOrDef;
      targetDef = this.functions.find(
        (fn) => this.getFunctionKey(fn) === targetKey
      );
    } else {
      targetKey = this.getFunctionKey(functionKeyOrDef);
      targetDef = functionKeyOrDef;
    }

    this.selectedFunctionId = targetKey;
    this.render();

    if (targetDef) {
      for (const listener of this.selectListeners) {
        try {
          listener(targetDef);
        } catch (err) {
          logger.error('APP', 'Error in FunctionCatalog select listener:', err);
        }
      }
    }
  }

  /**
   * Sets the active search query and updates the filtered list.
   */
  setSearchQuery(query: string): void {
    this.searchQuery = query.trim();
    this.applyFilters();
    this.render();
  }

  /**
   * Sets the active package filter and updates the filtered list.
   */
  setSelectedPackage(packageName: string): void {
    this.selectedPackageFilter = packageName.trim();
    this.applyFilters();
    this.render();
  }

  /**
   * Toggles parameter documentation expansion for a function.
   */
  toggleFunctionExpanded(functionKey: string): void {
    if (this.expandedFunctionKeys.has(functionKey)) {
      this.expandedFunctionKeys.delete(functionKey);
    } else {
      this.expandedFunctionKeys.add(functionKey);
    }
    this.render();
  }

  /**
   * Toggles collapsed state for an entire package group.
   */
  togglePackageCollapsed(packageName: string): void {
    if (this.collapsedPackages.has(packageName)) {
      this.collapsedPackages.delete(packageName);
    } else {
      this.collapsedPackages.add(packageName);
    }
    this.render();
  }

  /**
   * Queries the connected Android device for registered AppFunctions.
   */
  async discover(options: DiscoveryOptions = {}): Promise<AppFunctionDefinition[]> {
    if (!this.adbManager.isConnected()) {
      this.discoveryError = 'Android device is not connected.';
      this.render();
      return [];
    }

    this.isDiscovering = true;
    this.discoveryError = null;
    this.render();

    try {
      logger.info('APP', 'Starting AppFunctions discovery...');
      const result = await this.discovery.discover(options);
      this.functions = result.functions;
      this.isDiscovering = false;
      this.discoveryError = null;

      // Batch register discovered functions into native WebMCP if bridge is attached
      if (this.bridge && this.functions.length > 0) {
        try {
          await this.bridge.registerAppFunctions(this.functions);
        } catch (bridgeErr) {
          logger.warn('WebMCP', 'Could not register tools to WebMCP bridge:', bridgeErr);
        }
      }

      this.applyFilters();
      this.render();

      // If no function is currently selected, select the first discovered function
      if (!this.selectedFunctionId && this.functions.length > 0) {
        this.selectFunction(this.functions[0]);
      }

      return this.functions;
    } catch (err) {
      this.isDiscovering = false;
      this.discoveryError =
        err instanceof Error ? err.message : 'Failed to discover AppFunctions.';
      logger.error('APP', 'Discovery error:', err);
      this.render();
      return [];
    }
  }

  /**
   * Cleans up event listeners and DOM contents.
   */
  destroy(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    if (this.unsubscribeDisconnect) {
      this.unsubscribeDisconnect();
      this.unsubscribeDisconnect = null;
    }
    this.selectListeners.clear();
    this.container.innerHTML = '';
  }

  private bindAdbEvents(): void {
    this.unsubscribeState = this.adbManager.onStateChange((state) => {
      if (state === 'ready') {
        void this.discover();
      } else if (state === 'disconnected' || state === 'error') {
        this.functions = [];
        this.filteredFunctions = [];
        this.selectedFunctionId = null;
        this.discoveryError = null;
        this.isDiscovering = false;
        this.render();
      }
    });

    this.unsubscribeDisconnect = this.adbManager.onDisconnect(() => {
      this.functions = [];
      this.filteredFunctions = [];
      this.selectedFunctionId = null;
      this.discoveryError = null;
      this.isDiscovering = false;
      this.render();
    });
  }

  private getFunctionKey(fn: AppFunctionDefinition): string {
    return `${fn.packageName}::${fn.functionId}`;
  }

  private applyFilters(): void {
    const query = this.searchQuery.toLowerCase();
    const pkgFilter = this.selectedPackageFilter;

    this.filteredFunctions = this.functions.filter((fn) => {
      if (pkgFilter && fn.packageName !== pkgFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const matchName = fn.functionId.toLowerCase().includes(query);
      const matchPkg = fn.packageName.toLowerCase().includes(query);
      const matchClass = fn.className ? fn.className.toLowerCase().includes(query) : false;
      const matchMethod = fn.methodName ? fn.methodName.toLowerCase().includes(query) : false;
      const matchDesc = fn.description ? fn.description.toLowerCase().includes(query) : false;
      const matchToolName = formatToolName(fn).toLowerCase().includes(query);
      const matchParam = fn.parameters.some(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.dataType.toLowerCase().includes(query) ||
          (p.description ? p.description.toLowerCase().includes(query) : false)
      );

      return (
        matchName ||
        matchPkg ||
        matchClass ||
        matchMethod ||
        matchDesc ||
        matchToolName ||
        matchParam
      );
    });
  }

  /**
   * Groups functions by their package name.
   */
  private getFunctionsGroupedByPackage(): Map<string, AppFunctionDefinition[]> {
    const groups = new Map<string, AppFunctionDefinition[]>();
    for (const fn of this.filteredFunctions) {
      const pkg = fn.packageName || 'Uncategorized';
      if (!groups.has(pkg)) {
        groups.set(pkg, []);
      }
      groups.get(pkg)!.push(fn);
    }
    return groups;
  }

  /**
   * Renders the FunctionCatalog UI.
   */
  render(): void {
    const isConnected = this.adbManager.isConnected();
    const allPackages = Array.from(
      new Set(this.functions.map((fn) => fn.packageName))
    ).sort();

    this.container.innerHTML = `
      <div class="catalog-view-inner">
        ${this.renderHeader(isConnected)}
        ${isConnected ? this.renderToolbar(allPackages) : ''}
        ${this.renderBody(isConnected)}
      </div>
    `;

    this.attachDomListeners();
  }

  private renderHeader(isConnected: boolean): string {
    const countBadge = isConnected
      ? `<span class="catalog-badge" id="catalog-count-badge">
           ${this.functions.length} ${this.functions.length === 1 ? 'tool' : 'tools'}
         </span>`
      : '';

    return `
      <div class="catalog-header">
        <div class="catalog-title-group">
          <div class="catalog-title">
            <span class="catalog-icon">📚</span>
            <h3>Function Catalog</h3>
          </div>
          ${countBadge}
        </div>
        <div class="catalog-header-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm btn-refresh"
            id="btn-refresh-catalog"
            ${!isConnected || this.isDiscovering ? 'disabled' : ''}
            title="Refresh AppFunctions from device"
          >
            <span class="btn-icon-sm ${this.isDiscovering ? 'spinning' : ''}">🔄</span>
            Refresh
          </button>
        </div>
      </div>
    `;
  }

  private renderToolbar(allPackages: string[]): string {
    return `
      <div class="catalog-toolbar">
        <div class="catalog-search-box">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            class="catalog-search-input"
            id="catalog-search-input"
            placeholder="Search functions, parameters, packages..."
            value="${escapeHtml(this.searchQuery)}"
          />
          ${
            this.searchQuery
              ? `<button type="button" class="btn-clear-search" id="btn-clear-search" title="Clear search">✕</button>`
              : ''
          }
        </div>
        ${
          allPackages.length > 1
            ? `
          <div class="catalog-package-filter">
            <select class="catalog-select" id="catalog-package-select" aria-label="Filter by package">
              <option value="">All Packages (${allPackages.length})</option>
              ${allPackages
                .map(
                  (pkg) => `
                <option value="${escapeHtml(pkg)}" ${pkg === this.selectedPackageFilter ? 'selected' : ''}>
                  ${escapeHtml(pkg)}
                </option>
              `
                )
                .join('')}
            </select>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private renderBody(isConnected: boolean): string {
    if (!isConnected) {
      return `
        <div class="catalog-empty-state catalog-disconnected">
          <span class="empty-icon">🔌</span>
          <h4>No Android Device Connected</h4>
          <p>Connect your Android 16+ device via USB to discover and explore on-device AppFunctions.</p>
        </div>
      `;
    }

    if (this.isDiscovering) {
      return `
        <div class="catalog-loading-state">
          <div class="spinner spinner-large"></div>
          <h4>Discovering AppFunctions...</h4>
          <p>Executing <code>cmd app_function list-app-functions</code> over WebUSB...</p>
        </div>
      `;
    }

    if (this.discoveryError) {
      return `
        <div class="catalog-error-state">
          <span class="error-icon">⚠️</span>
          <h4>Discovery Failed</h4>
          <p class="error-message">${escapeHtml(this.discoveryError)}</p>
          <button type="button" class="btn btn-primary btn-sm" id="btn-retry-discovery">
            🔄 Retry Discovery
          </button>
        </div>
      `;
    }

    if (this.functions.length === 0) {
      return `
        <div class="catalog-empty-state">
          <span class="empty-icon">📭</span>
          <h4>No AppFunctions Found</h4>
          <p>The connected Android device did not return any registered AppFunctions. Ensure apps targeting API 36+ expose AppFunction annotations.</p>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-retry-discovery">
            🔄 Query Again
          </button>
        </div>
      `;
    }

    if (this.filteredFunctions.length === 0) {
      return `
        <div class="catalog-empty-state">
          <span class="empty-icon">🔍</span>
          <h4>No Matching Functions</h4>
          <p>No AppFunctions matched your current filter criteria: <em>"${escapeHtml(this.searchQuery)}"</em>.</p>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-filters">
            Reset Filters
          </button>
        </div>
      `;
    }

    const groups = this.getFunctionsGroupedByPackage();

    return `
      <div class="catalog-groups">
        ${Array.from(groups.entries())
          .map(([packageName, fns]) => this.renderPackageGroup(packageName, fns))
          .join('')}
      </div>
    `;
  }

  private renderPackageGroup(
    packageName: string,
    fns: AppFunctionDefinition[]
  ): string {
    const isCollapsed = this.collapsedPackages.has(packageName);

    return `
      <div class="package-group ${isCollapsed ? 'collapsed' : ''}" data-package="${escapeHtml(packageName)}">
        <div class="package-group-header" data-action="toggle-package" data-package="${escapeHtml(packageName)}">
          <div class="package-info">
            <span class="package-collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
            <span class="package-icon">📦</span>
            <span class="package-name" title="${escapeHtml(packageName)}">${escapeHtml(packageName)}</span>
          </div>
          <span class="package-badge">${fns.length} ${fns.length === 1 ? 'func' : 'funcs'}</span>
        </div>
        ${
          !isCollapsed
            ? `
          <div class="package-function-list">
            ${fns.map((fn) => this.renderFunctionCard(fn)).join('')}
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private renderFunctionCard(fn: AppFunctionDefinition): string {
    const key = this.getFunctionKey(fn);
    const isSelected = this.selectedFunctionId === key;
    const isExpanded = this.expandedFunctionKeys.has(key);
    const toolName = formatToolName(fn);
    const title = formatToolTitle(fn);
    const paramCount = fn.parameters.length;
    const requiredCount = fn.parameters.filter((p) => p.isRequired).length;

    return `
      <div
        class="function-card ${isSelected ? 'selected' : ''}"
        data-function-key="${escapeHtml(key)}"
      >
        <div class="function-card-header">
          <div class="function-title-area">
            <div class="function-name-row">
              <span class="function-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
              ${
                fn.enabled === false
                  ? '<span class="status-tag tag-disabled" title="Function is disabled on device">Disabled</span>'
                  : ''
              }
            </div>
            <div class="function-tool-tag" title="WebMCP Tool Identifier">
              <code>${escapeHtml(toolName)}</code>
            </div>
          </div>
          <div class="function-card-actions">
            <button
              type="button"
              class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'} btn-select-function"
              data-action="select-function"
              data-function-key="${escapeHtml(key)}"
              title="Select this AppFunction to test with custom parameters"
            >
              ${isSelected ? '✓ Selected' : 'Test ⚡'}
            </button>
          </div>
        </div>

        ${
          fn.description
            ? `<p class="function-description">${escapeHtml(fn.description)}</p>`
            : ''
        }

        <div class="function-meta-row">
          <div class="function-param-summary">
            <span class="meta-pill ${paramCount > 0 ? 'pill-active' : ''}">
              ${paramCount} ${paramCount === 1 ? 'parameter' : 'parameters'}${requiredCount > 0 ? ` (${requiredCount} required)` : ''}
            </span>
            ${
              fn.response
                ? `<span class="meta-pill pill-response" title="Return type: ${fn.response.dataType}">↳ ${escapeHtml(fn.response.dataType)}</span>`
                : ''
            }
          </div>
          ${
            paramCount > 0 || fn.response
              ? `
            <button
              type="button"
              class="btn-toggle-docs"
              data-action="toggle-docs"
              data-function-key="${escapeHtml(key)}"
              aria-label="Toggle parameter documentation"
            >
              ${isExpanded ? 'Hide Docs ▲' : 'View Docs ▼'}
            </button>
          `
              : ''
          }
        </div>

        ${isExpanded ? this.renderParameterDocs(fn) : ''}
      </div>
    `;
  }

  private renderParameterDocs(fn: AppFunctionDefinition): string {
    return `
      <div class="function-docs-drawer">
        <h5 class="docs-heading">Parameter Specifications:</h5>
        ${
          fn.parameters.length === 0
            ? '<p class="docs-empty">This AppFunction takes no input parameters.</p>'
            : `
          <div class="docs-table-wrapper">
            <table class="docs-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Description / Default</th>
                </tr>
              </thead>
              <tbody>
                ${fn.parameters.map((p) => this.renderParameterDocRow(p)).join('')}
              </tbody>
            </table>
          </div>
        `
        }

        ${
          fn.response
            ? `
          <div class="docs-response-section">
            <h5 class="docs-heading">Response Type:</h5>
            <div class="response-spec">
              ${this.renderTypeBadge(fn.response.dataType)}
              ${
                fn.response.rawType
                  ? `<code class="raw-type">${escapeHtml(fn.response.rawType)}</code>`
                  : ''
              }
              ${
                fn.response.description
                  ? `<span class="response-desc">${escapeHtml(fn.response.description)}</span>`
                  : ''
              }
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private renderParameterDocRow(param: AppFunctionParameter): string {
    const defVal =
      param.defaultValue !== undefined
        ? ` <span class="param-default" title="Default value">default: <code>${escapeHtml(JSON.stringify(param.defaultValue))}</code></span>`
        : '';

    return `
      <tr>
        <td class="param-name-cell">
          <code>${escapeHtml(param.name)}</code>
        </td>
        <td class="param-type-cell">
          ${this.renderTypeBadge(param.dataType)}
          ${
            param.rawType && param.rawType !== param.dataType
              ? `<span class="param-raw-type">${escapeHtml(param.rawType)}</span>`
              : ''
          }
        </td>
        <td class="param-req-cell">
          ${
            param.isRequired
              ? '<span class="badge-req req-yes">Required</span>'
              : '<span class="badge-req req-no">Optional</span>'
          }
        </td>
        <td class="param-desc-cell">
          ${param.description ? `<span>${escapeHtml(param.description)}</span>` : '<span class="text-muted">—</span>'}
          ${defVal}
        </td>
      </tr>
    `;
  }

  private renderTypeBadge(dataType: AppFunctionDataType): string {
    const typeClass = `type-${dataType.toLowerCase()}`;
    return `<span class="type-badge ${typeClass}">${escapeHtml(dataType)}</span>`;
  }

  private attachDomListeners(): void {
    // Refresh button
    const btnRefresh = this.container.querySelector<HTMLButtonElement>('#btn-refresh-catalog');
    if (btnRefresh) {
      btnRefresh.onclick = () => {
        void this.discover();
      };
    }

    // Retry discovery buttons
    const btnRetry = this.container.querySelector<HTMLButtonElement>('#btn-retry-discovery');
    if (btnRetry) {
      btnRetry.onclick = () => {
        void this.discover();
      };
    }

    // Search input
    const searchInput = this.container.querySelector<HTMLInputElement>('#catalog-search-input');
    if (searchInput) {
      searchInput.oninput = () => {
        this.searchQuery = searchInput.value;
        this.applyFilters();
        this.render();
        // Restore focus to input after render
        const newSearchInput = this.container.querySelector<HTMLInputElement>(
          '#catalog-search-input'
        );
        if (newSearchInput) {
          newSearchInput.focus();
          newSearchInput.setSelectionRange(
            newSearchInput.value.length,
            newSearchInput.value.length
          );
        }
      };
    }

    // Clear search button
    const btnClearSearch = this.container.querySelector<HTMLButtonElement>('#btn-clear-search');
    if (btnClearSearch) {
      btnClearSearch.onclick = () => {
        this.searchQuery = '';
        this.applyFilters();
        this.render();
      };
    }

    // Reset filters button
    const btnResetFilters = this.container.querySelector<HTMLButtonElement>('#btn-reset-filters');
    if (btnResetFilters) {
      btnResetFilters.onclick = () => {
        this.searchQuery = '';
        this.selectedPackageFilter = '';
        this.applyFilters();
        this.render();
      };
    }

    // Package dropdown filter
    const pkgSelect = this.container.querySelector<HTMLSelectElement>('#catalog-package-select');
    if (pkgSelect) {
      pkgSelect.onchange = () => {
        this.selectedPackageFilter = pkgSelect.value;
        this.applyFilters();
        this.render();
      };
    }

    // Package accordion toggles
    const pkgHeaders = this.container.querySelectorAll<HTMLElement>('[data-action="toggle-package"]');
    pkgHeaders.forEach((el) => {
      el.onclick = () => {
        const pkg = el.getAttribute('data-package');
        if (pkg) {
          this.togglePackageCollapsed(pkg);
        }
      };
    });

    // Select function buttons
    const selectButtons = this.container.querySelectorAll<HTMLElement>(
      '[data-action="select-function"]'
    );
    selectButtons.forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const key = el.getAttribute('data-function-key');
        if (key) {
          this.selectFunction(key);
        }
      };
    });

    // Toggle docs buttons
    const docButtons = this.container.querySelectorAll<HTMLElement>('[data-action="toggle-docs"]');
    docButtons.forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const key = el.getAttribute('data-function-key');
        if (key) {
          this.toggleFunctionExpanded(key);
        }
      };
    });

    // Click on function card row also selects it
    const cards = this.container.querySelectorAll<HTMLElement>('.function-card');
    cards.forEach((card) => {
      card.onclick = (e) => {
        // Prevent re-selection if clicking inside documentation drawer
        if ((e.target as HTMLElement).closest('.function-docs-drawer')) {
          return;
        }
        const key = card.getAttribute('data-function-key');
        if (key) {
          this.selectFunction(key);
        }
      };
    });
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
