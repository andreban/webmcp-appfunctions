/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import {
  AdbConnectionState,
  AdbDeviceInfo,
  AdbErrorDiagnostic,
} from '../types/adb';
import { logger } from '../utils/logger';

export interface ConnectionBarOptions {
  autoConnect?: boolean;
}

export interface CompatibilityStatus {
  webMcp: boolean;
  webUsb: boolean;
}

/**
 * Checks browser support for native WebMCP (document.modelContext)
 * and WebUSB (navigator.usb).
 */
export function checkBrowserCompatibility(): CompatibilityStatus {
  const webMcp =
    typeof document !== 'undefined' &&
    'modelContext' in document &&
    Boolean((document as unknown as { modelContext?: unknown }).modelContext);

  const webUsb =
    typeof navigator !== 'undefined' &&
    'usb' in navigator &&
    Boolean(navigator.usb);

  return { webMcp, webUsb };
}

/**
 * ConnectionBar component renders the header UI for managing WebUSB ADB
 * connections, displaying real-time status, device metadata, WebMCP compatibility,
 * and context-sensitive troubleshooting guides.
 */
export class ConnectionBar {
  private container: HTMLElement;
  private adbManager: AdbManager;
  private isTroubleshootingOpen = false;
  private copiedCommandTimeout: ReturnType<typeof setTimeout> | null = null;
  private compatibility: CompatibilityStatus;

  private unsubscribeState: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private unsubscribeDisconnect: (() => void) | null = null;

  constructor(
    container: HTMLElement | string,
    adbManager?: AdbManager,
    options: ConnectionBarOptions = {}
  ) {
    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (!el) {
        throw new Error(`ConnectionBar: element with id "${container}" not found.`);
      }
      this.container = el;
    } else {
      this.container = container;
    }

    this.adbManager = adbManager ?? new AdbManager();
    this.compatibility = checkBrowserCompatibility();
    this.isTroubleshootingOpen =
      this.adbManager.getState() === 'error' ||
      this.adbManager.getState() === 'authorizing';

    this.bindAdbEvents();
    this.render();

    if (options.autoConnect) {
      void this.connect();
    }
  }

  /**
   * Returns the underlying AdbManager instance.
   */
  getAdbManager(): AdbManager {
    return this.adbManager;
  }

  /**
   * Returns the current connection state.
   */
  getState(): AdbConnectionState {
    return this.adbManager.getState();
  }

  /**
   * Returns the current device metadata, if connected.
   */
  getDeviceInfo(): AdbDeviceInfo | null {
    return this.adbManager.getDeviceInfo();
  }

  /**
   * Initiates WebUSB device selection and ADB connection.
   */
  async connect(): Promise<void> {
    try {
      this.isTroubleshootingOpen = false;
      this.render();

      logger.info('APP', 'User initiated ADB connection.');
      const info = await this.adbManager.connect();

      // Fetch extended device metadata via getprop
      await this.adbManager.fetchDeviceMetadata();
      this.render();
      logger.info('APP', `Connected to ${info.productModel}`);
    } catch (err) {
      this.isTroubleshootingOpen = true;
      this.render();
      logger.error('APP', 'Connection attempt failed:', err);
    }
  }

  /**
   * Disconnects the active ADB connection.
   */
  async disconnect(): Promise<void> {
    try {
      logger.info('APP', 'User initiated disconnect.');
      await this.adbManager.disconnect();
      this.isTroubleshootingOpen = false;
      this.render();
    } catch (err) {
      logger.error('APP', 'Error during disconnect:', err);
    }
  }

  /**
   * Cleans up listeners and DOM references.
   */
  destroy(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }
    if (this.unsubscribeDisconnect) {
      this.unsubscribeDisconnect();
      this.unsubscribeDisconnect = null;
    }
    if (this.copiedCommandTimeout) {
      clearTimeout(this.copiedCommandTimeout);
      this.copiedCommandTimeout = null;
    }
    this.container.innerHTML = '';
  }

  private bindAdbEvents(): void {
    this.unsubscribeState = this.adbManager.onStateChange((state) => {
      if (state === 'authorizing') {
        this.isTroubleshootingOpen = true;
      }
      if (state === 'ready') {
        this.isTroubleshootingOpen = false;
      }
      if (state === 'error') {
        this.isTroubleshootingOpen = true;
      }
      this.render();
    });

    this.unsubscribeError = this.adbManager.onError(() => {
      this.isTroubleshootingOpen = true;
      this.render();
    });

    this.unsubscribeDisconnect = this.adbManager.onDisconnect(() => {
      this.render();
    });
  }

  /**
   * Renders the complete ConnectionBar UI.
   */
  render(): void {
    const state = this.adbManager.getState();
    const deviceInfo = this.adbManager.getDeviceInfo();
    const lastDiagnostic = this.adbManager.getLastDiagnostic();

    this.container.innerHTML = `
      <div class="connection-bar-inner">
        <div class="connection-bar-brand">
          <div class="brand-title">
            <span class="brand-icon">⚡</span>
            <span class="brand-text">WebMCP ↔ Android</span>
          </div>
          <div class="brand-badges">
            ${this.renderWebMcpBadge()}
            ${this.renderWebUsbBadge()}
          </div>
        </div>

        <div class="connection-bar-center">
          ${this.renderDeviceMetadata(state, deviceInfo)}
        </div>

        <div class="connection-bar-actions">
          ${this.renderStatusPill(state)}
          ${this.renderActionButton(state)}
          <button
            type="button"
            class="btn-icon btn-help ${this.isTroubleshootingOpen ? 'active' : ''}"
            id="btn-toggle-troubleshooting"
            title="Connection troubleshooting & help"
            aria-label="Troubleshooting help"
          >
            ?
          </button>
        </div>
      </div>

      ${this.renderTroubleshootingDrawer(state, lastDiagnostic)}
    `;

    this.attachDomListeners();
  }

  private renderWebMcpBadge(): string {
    if (this.compatibility.webMcp) {
      return `
        <span
          class="compat-badge badge-supported"
          title="Native document.modelContext is supported in this browser."
        >
          <span class="badge-dot"></span>
          WebMCP Native
        </span>
      `;
    }
    return `
      <span
        class="compat-badge badge-unsupported"
        title="Native document.modelContext not detected. WebMCP enabled browser required for agent tool calls."
      >
        <span class="badge-dot"></span>
        WebMCP Missing
      </span>
    `;
  }

  private renderWebUsbBadge(): string {
    if (this.compatibility.webUsb) {
      return `
        <span
          class="compat-badge badge-supported"
          title="WebUSB API (navigator.usb) is supported in this browser."
        >
          <span class="badge-dot"></span>
          WebUSB Ready
        </span>
      `;
    }
    return `
      <span
        class="compat-badge badge-error"
        title="WebUSB is not supported in this browser. Use Chrome/Edge over HTTPS or localhost."
      >
        <span class="badge-dot"></span>
        WebUSB Unsupported
      </span>
    `;
  }

  private renderStatusPill(state: AdbConnectionState): string {
    switch (state) {
      case 'connecting':
        return `
          <div class="status-pill status-connecting" title="Establishing USB transport...">
            <span class="status-dot pulsing"></span>
            <span class="status-text">Connecting...</span>
          </div>
        `;
      case 'authorizing':
        return `
          <div class="status-pill status-authorizing" title="Waiting for RSA authorization on device...">
            <span class="status-dot pulsing"></span>
            <span class="status-text">Authorizing...</span>
          </div>
        `;
      case 'ready':
        return `
          <div class="status-pill status-ready" title="Device connected and ready for ADB commands">
            <span class="status-dot"></span>
            <span class="status-text">Connected</span>
          </div>
        `;
      case 'error':
        return `
          <div class="status-pill status-error" title="Connection error encountered">
            <span class="status-dot"></span>
            <span class="status-text">Error</span>
          </div>
        `;
      case 'disconnected':
      default:
        return `
          <div class="status-pill status-disconnected" title="No Android device connected">
            <span class="status-dot"></span>
            <span class="status-text">Disconnected</span>
          </div>
        `;
    }
  }

  private renderDeviceMetadata(
    state: AdbConnectionState,
    deviceInfo: AdbDeviceInfo | null
  ): string {
    if (state !== 'ready' || !deviceInfo) {
      return `
        <div class="device-metadata-empty">
          <span class="empty-icon">🔌</span>
          <span class="empty-text">No Android device connected</span>
        </div>
      `;
    }

    const manufacturer = deviceInfo.manufacturer || deviceInfo.manufacturerName || '';
    const model = deviceInfo.model || deviceInfo.productModel || deviceInfo.productName;
    const deviceDisplay = manufacturer && !model.toLowerCase().includes(manufacturer.toLowerCase())
      ? `${manufacturer} ${model}`
      : model;

    const androidVer = deviceInfo.androidVersion ? `Android ${deviceInfo.androidVersion}` : 'Android 16+';
    const sdkVer = deviceInfo.sdkVersion ? `API ${deviceInfo.sdkVersion}` : 'API 36+';
    const serial = deviceInfo.serialNumber
      ? `<span class="meta-tag serial-tag" title="Serial: ${deviceInfo.serialNumber}">#${deviceInfo.serialNumber.slice(-6)}</span>`
      : '';

    return `
      <div class="device-metadata-card">
        <div class="device-primary">
          <span class="device-icon">📱</span>
          <span class="device-name" title="${deviceDisplay} (${deviceInfo.productName})">${deviceDisplay}</span>
        </div>
        <div class="device-tags">
          <span class="meta-tag version-tag" title="Android OS Version">${androidVer}</span>
          <span class="meta-tag api-tag" title="Android SDK Level">${sdkVer}</span>
          ${serial}
        </div>
      </div>
    `;
  }

  private renderActionButton(state: AdbConnectionState): string {
    const isBusy = state === 'connecting' || state === 'authorizing';
    const isUsbSupported = this.compatibility.webUsb;

    if (state === 'ready') {
      return `
        <button
          type="button"
          class="btn btn-secondary btn-disconnect"
          id="btn-disconnect"
          title="Disconnect active device"
        >
          <span class="btn-icon">⏏</span>
          Disconnect
        </button>
      `;
    }

    if (isBusy) {
      const label = state === 'authorizing' ? 'Authorizing...' : 'Connecting...';
      return `
        <button type="button" class="btn btn-primary btn-loading" disabled>
          <span class="spinner"></span>
          ${label}
        </button>
      `;
    }

    const disabledAttr = !isUsbSupported ? 'disabled title="WebUSB is not supported in this browser"' : '';
    return `
      <button
        type="button"
        class="btn btn-primary btn-connect"
        id="btn-connect"
        ${disabledAttr}
      >
        <span class="btn-icon">🔌</span>
        Connect Android Device
      </button>
    `;
  }

  private renderTroubleshootingDrawer(
    state: AdbConnectionState,
    diagnostic: AdbErrorDiagnostic | null
  ): string {
    if (!this.isTroubleshootingOpen && state !== 'authorizing') {
      return '';
    }

    if (state === 'authorizing') {
      return `
        <div class="troubleshooting-banner banner-warning">
          <div class="banner-icon">🔑</div>
          <div class="banner-content">
            <h4 class="banner-heading">Authorize USB Debugging on Device</h4>
            <p class="banner-message">
              Please unlock your Android phone and check the screen for the <strong>"Allow USB debugging?"</strong> prompt.
              Check <em>"Always allow from this computer"</em> and tap <strong>Allow</strong>.
            </p>
          </div>
        </div>
      `;
    }

    const code = diagnostic?.code ?? 'UNKNOWN_ERROR';
    const content = this.getTroubleshootingContent(code, diagnostic);

    return `
      <div class="troubleshooting-drawer" id="troubleshooting-drawer">
        <div class="troubleshooting-header">
          <div class="troubleshooting-title">
            <span class="troubleshooting-icon">${content.icon}</span>
            <h4>${content.title}</h4>
          </div>
          <button
            type="button"
            class="btn-close"
            id="btn-close-troubleshooting"
            title="Dismiss troubleshooting"
            aria-label="Close troubleshooting"
          >
            ✕
          </button>
        </div>

        <div class="troubleshooting-body">
          <p class="troubleshooting-summary">${content.summary}</p>
          
          <div class="troubleshooting-steps">
            <h5>Recommended Resolution Steps:</h5>
            <ol>
              ${content.steps.map((step) => `<li>${step}</li>`).join('')}
            </ol>
          </div>

          ${
            content.command
              ? `
            <div class="troubleshooting-command-box">
              <span class="command-label">Run in terminal:</span>
              <div class="command-row">
                <code>${content.command}</code>
                <button
                  type="button"
                  class="btn-copy"
                  id="btn-copy-command"
                  data-command="${content.command}"
                  title="Copy to clipboard"
                >
                  📋 Copy
                </button>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <div class="troubleshooting-footer">
          <button type="button" class="btn btn-primary btn-retry" id="btn-retry-connection">
            🔄 Retry Connection
          </button>
        </div>
      </div>
    `;
  }

  private getTroubleshootingContent(
    code: string,
    diagnostic: AdbErrorDiagnostic | null
  ): {
    title: string;
    icon: string;
    summary: string;
    steps: string[];
    command?: string;
  } {
    switch (code) {
      case 'AUTH_REJECTED':
        return {
          title: 'Device Authentication Required (RSA Key)',
          icon: '🔑',
          summary:
            'The Android device rejected the connection or the authorization dialog timed out.',
          steps: [
            'Unlock your phone and stay on the home screen.',
            'Look for the popup dialog: <strong>"Allow USB debugging?"</strong>.',
            'Check the box <strong>"Always allow from this computer"</strong>.',
            'Tap <strong>"Allow"</strong> on the phone, then click Retry Connection below.',
          ],
        };

      case 'USB_INTERFACE_BUSY':
        return {
          title: 'USB Interface Already Claimed',
          icon: '⚠️',
          summary:
            'The WebUSB interface could not be claimed because another application or local ADB daemon holds an exclusive lock on the USB port.',
          steps: [
            'Kill any running background ADB server on your host machine.',
            'Close other browser tabs or development tools communicating with Android over WebUSB.',
            'Disconnect and reconnect the USB cable, then click Retry Connection.',
          ],
          command: 'adb kill-server',
        };

      case 'DEVICE_NOT_SELECTED':
        return {
          title: 'No Android Device Selected',
          icon: '🔍',
          summary:
            'No device was selected in the browser WebUSB device picker dialog.',
          steps: [
            'Ensure your Android phone is connected via a reliable USB data cable.',
            'Confirm <strong>USB Debugging</strong> is enabled in <em>Settings → Developer Options</em>.',
            'If your device is charging only, change USB mode to <strong>File Transfer / MTP</strong> or <strong>PTP</strong>.',
            'Click Connect and select your device from the browser popup.',
          ],
        };

      case 'WEBUSB_NOT_SUPPORTED':
        return {
          title: 'WebUSB API Not Supported',
          icon: '🚫',
          summary:
            'WebUSB (navigator.usb) is not available in this browser environment.',
          steps: [
            'Open this web application in Google Chrome, Microsoft Edge, Brave, or Chromium.',
            'Ensure the page is served over a secure origin (<strong>https://</strong> or <strong>http://localhost</strong>).',
          ],
        };

      case 'DEVICE_DISCONNECTED':
        return {
          title: 'Device Disconnected',
          icon: '🔌',
          summary:
            'The USB connection to the Android device was unexpectedly terminated.',
          steps: [
            'Check the physical USB cable connection.',
            'Ensure your device did not enter sleep mode or lock screen state.',
            'Click Retry Connection to reconnect.',
          ],
        };

      default:
        return {
          title: 'Connection Issue Detected',
          icon: '🛠️',
          summary:
            diagnostic?.message ||
            'An unexpected issue occurred while communicating with the Android device.',
          steps: [
            diagnostic?.suggestion ||
              'Ensure USB debugging is enabled and the phone is unlocked.',
            'Check terminal for any competing ADB processes (run "adb kill-server").',
            'Unplug and replug the USB cable, then retry.',
          ],
          command: 'adb kill-server',
        };
    }
  }

  private attachDomListeners(): void {
    const btnConnect = this.container.querySelector<HTMLButtonElement>('#btn-connect');
    if (btnConnect) {
      btnConnect.onclick = () => {
        void this.connect();
      };
    }

    const btnDisconnect = this.container.querySelector<HTMLButtonElement>('#btn-disconnect');
    if (btnDisconnect) {
      btnDisconnect.onclick = () => {
        void this.disconnect();
      };
    }

    const btnToggleTroubleshooting = this.container.querySelector<HTMLButtonElement>(
      '#btn-toggle-troubleshooting'
    );
    if (btnToggleTroubleshooting) {
      btnToggleTroubleshooting.onclick = () => {
        this.isTroubleshootingOpen = !this.isTroubleshootingOpen;
        this.render();
      };
    }

    const btnCloseTroubleshooting = this.container.querySelector<HTMLButtonElement>(
      '#btn-close-troubleshooting'
    );
    if (btnCloseTroubleshooting) {
      btnCloseTroubleshooting.onclick = () => {
        this.isTroubleshootingOpen = false;
        this.render();
      };
    }

    const btnRetry = this.container.querySelector<HTMLButtonElement>('#btn-retry-connection');
    if (btnRetry) {
      btnRetry.onclick = () => {
        void this.connect();
      };
    }

    const btnCopy = this.container.querySelector<HTMLButtonElement>('#btn-copy-command');
    if (btnCopy) {
      btnCopy.onclick = async () => {
        const cmd = btnCopy.getAttribute('data-command') || 'adb kill-server';
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(cmd);
          }
          btnCopy.innerText = '✅ Copied!';
          if (this.copiedCommandTimeout) {
            clearTimeout(this.copiedCommandTimeout);
          }
          this.copiedCommandTimeout = setTimeout(() => {
            btnCopy.innerText = '📋 Copy';
          }, 2000);
        } catch {
          btnCopy.innerText = 'Copied!';
        }
      };
    }
  }
}
