/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionBar, checkBrowserCompatibility } from '../src/ui/connection-bar';
import { AdbManager } from '../src/transport/adb-client';
import { AdbConnectionState, AdbDeviceInfo, AdbErrorDiagnostic } from '../src/types/adb';

// Lightweight simulated DOM node for tests
class SimpleElement {
  tagName: string;
  innerHTML = '';
  attributes: Record<string, string> = {};
  onclick: ((event?: unknown) => void) | null = null;
  innerText = '';
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

  querySelector<T = SimpleElement>(selector: string): T | null {
    // Simple ID selector matcher
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.innerHTML.includes(`id="${id}"`)) {
        const el = new SimpleElement('button');
        el.setAttribute('id', id);
        // Extract data attributes if present in HTML
        const dataCmdMatch = this.innerHTML.match(new RegExp(`id="${id}"[^>]*data-command="([^"]+)"`));
        if (dataCmdMatch) {
          el.setAttribute('data-command', dataCmdMatch[1]);
        }
        const altDataCmdMatch = this.innerHTML.match(new RegExp(`data-command="([^"]+)"[^>]*id="${id}"`));
        if (altDataCmdMatch) {
          el.setAttribute('data-command', altDataCmdMatch[1]);
        }
        return el as unknown as T;
      }
    }
    return null;
  }

  querySelectorAll<T = SimpleElement>(_selector: string): T[] {
    return [];
  }
}

describe('ConnectionBar Component', () => {
  let mockContainer: HTMLElement;
  let mockManager: AdbManager;
  let stateListener: ((state: AdbConnectionState, error?: Error, diagnostic?: AdbErrorDiagnostic) => void) | null = null;
  let errorListener: ((error: Error, diagnostic: AdbErrorDiagnostic) => void) | null = null;
  let disconnectListener: (() => void) | null = null;

  beforeEach(() => {
    mockContainer = new SimpleElement('div') as unknown as HTMLElement;

    stateListener = null;
    errorListener = null;
    disconnectListener = null;

    mockManager = {
      getState: vi.fn().mockReturnValue('disconnected'),
      getDeviceInfo: vi.fn().mockReturnValue(null),
      getLastDiagnostic: vi.fn().mockReturnValue(null),
      getLastError: vi.fn().mockReturnValue(null),
      connect: vi.fn().mockResolvedValue({
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      fetchDeviceMetadata: vi.fn().mockResolvedValue({
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        androidVersion: '16',
        sdkVersion: '36',
      }),
      onStateChange: vi.fn().mockImplementation((listener) => {
        stateListener = listener;
        return () => {
          stateListener = null;
        };
      }),
      onError: vi.fn().mockImplementation((listener) => {
        errorListener = listener;
        return () => {
          errorListener = null;
        };
      }),
      onDisconnect: vi.fn().mockImplementation((listener) => {
        disconnectListener = listener;
        return () => {
          disconnectListener = null;
        };
      }),
    } as unknown as AdbManager;
  });

  describe('checkBrowserCompatibility', () => {
    it('detects native WebMCP and WebUSB availability', () => {
      const originalDoc = globalThis.document;
      const originalNav = globalThis.navigator;

      try {
        // Set mock document.modelContext and navigator.usb
        Object.defineProperty(globalThis, 'document', {
          value: { modelContext: {} },
          configurable: true,
          writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
          value: { usb: {} },
          configurable: true,
          writable: true,
        });

        const status = checkBrowserCompatibility();
        expect(status.webMcp).toBe(true);
        expect(status.webUsb).toBe(true);
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: originalDoc,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });

    it('detects missing WebMCP or WebUSB support', () => {
      const originalDoc = globalThis.document;
      const originalNav = globalThis.navigator;

      try {
        Object.defineProperty(globalThis, 'document', {
          value: {},
          configurable: true,
          writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
          value: {},
          configurable: true,
          writable: true,
        });

        const status = checkBrowserCompatibility();
        expect(status.webMcp).toBe(false);
        expect(status.webUsb).toBe(false);
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: originalDoc,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('Initial Rendering & Status Pills', () => {
    it('renders initial disconnected state with Connect button and badges', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('WebMCP ↔ Android');
      expect(mockContainer.innerHTML).toContain('status-disconnected');
      expect(mockContainer.innerHTML).toContain('Disconnected');
      expect(mockContainer.innerHTML).toContain('Connect Android Device');
      expect(mockContainer.innerHTML).toContain('No Android device connected');

      bar.destroy();
    });

    it('renders connecting status pill when state changes to connecting', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      vi.mocked(mockManager.getState).mockReturnValue('connecting');
      stateListener?.('connecting');

      expect(mockContainer.innerHTML).toContain('status-connecting');
      expect(mockContainer.innerHTML).toContain('Connecting...');
      expect(mockContainer.innerHTML).toContain('btn-loading');

      bar.destroy();
    });

    it('renders authorizing status pill and prompt banner when state is authorizing', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      vi.mocked(mockManager.getState).mockReturnValue('authorizing');
      stateListener?.('authorizing');

      expect(mockContainer.innerHTML).toContain('status-authorizing');
      expect(mockContainer.innerHTML).toContain('Authorizing...');
      expect(mockContainer.innerHTML).toContain('Authorize USB Debugging on Device');
      expect(mockContainer.innerHTML).toContain('Allow USB debugging?');

      bar.destroy();
    });

    it('renders connected status pill and metadata when ready', () => {
      const mockInfo: AdbDeviceInfo = {
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        androidVersion: '16',
        sdkVersion: '36',
        serialNumber: 'ABC123XYZ',
      };

      vi.mocked(mockManager.getState).mockReturnValue('ready');
      vi.mocked(mockManager.getDeviceInfo).mockReturnValue(mockInfo);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('status-ready');
      expect(mockContainer.innerHTML).toContain('Connected');
      expect(mockContainer.innerHTML).toContain('Google Pixel 9 Pro');
      expect(mockContainer.innerHTML).toContain('Android 16');
      expect(mockContainer.innerHTML).toContain('API 36');
      expect(mockContainer.innerHTML).toContain('#123XYZ');
      expect(mockContainer.innerHTML).toContain('Disconnect');

      bar.destroy();
    });

    it('renders error status pill and troubleshooting drawer when state is error', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'USB_INTERFACE_BUSY',
        message: 'USB interface is currently claimed by another process.',
        suggestion: 'Run "adb kill-server" in your terminal.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('status-error');
      expect(mockContainer.innerHTML).toContain('Error');
      expect(mockContainer.innerHTML).toContain('USB Interface Already Claimed');
      expect(mockContainer.innerHTML).toContain('adb kill-server');

      bar.destroy();
    });
  });

  describe('Troubleshooting Guides for Common Issues', () => {
    it('displays AUTH_REJECTED recovery steps', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'AUTH_REJECTED',
        message: 'ADB authentication was rejected.',
        suggestion: 'Allow USB debugging on device.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('Device Authentication Required (RSA Key)');
      expect(mockContainer.innerHTML).toContain('Always allow from this computer');
      expect(mockContainer.innerHTML).toContain('Retry Connection');

      bar.destroy();
    });

    it('displays USB_INTERFACE_BUSY recovery steps and copyable command', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'USB_INTERFACE_BUSY',
        message: 'USB busy.',
        suggestion: 'Kill adb server.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('USB Interface Already Claimed');
      expect(mockContainer.innerHTML).toContain('adb kill-server');
      expect(mockContainer.innerHTML).toContain('data-command="adb kill-server"');

      bar.destroy();
    });

    it('displays DEVICE_NOT_SELECTED guidance', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'DEVICE_NOT_SELECTED',
        message: 'No device selected.',
        suggestion: 'Select your device.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('No Android Device Selected');
      expect(mockContainer.innerHTML).toContain('USB Debugging');

      bar.destroy();
    });

    it('displays DEVICE_DISCONNECTED guidance', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'DEVICE_DISCONNECTED',
        message: 'Device disconnected.',
        suggestion: 'Check USB cable.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('Device Disconnected');
      expect(mockContainer.innerHTML).toContain('physical USB cable');

      bar.destroy();
    });

    it('displays WEBUSB_NOT_SUPPORTED guidance', () => {
      const mockDiag: AdbErrorDiagnostic = {
        code: 'WEBUSB_NOT_SUPPORTED',
        message: 'WebUSB not supported.',
        suggestion: 'Use Chrome/Edge.',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockContainer.innerHTML).toContain('WebUSB API Not Supported');
      expect(mockContainer.innerHTML).toContain('Google Chrome, Microsoft Edge');

      bar.destroy();
    });
  });

  describe('User Actions & Event Handling', () => {
    it('calls adbManager.connect() when connect button is clicked', async () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      await bar.connect();

      expect(mockManager.connect).toHaveBeenCalled();
      expect(mockManager.fetchDeviceMetadata).toHaveBeenCalled();

      bar.destroy();
    });

    it('calls adbManager.disconnect() when disconnect button is clicked', async () => {
      vi.mocked(mockManager.getState).mockReturnValue('ready');
      const bar = new ConnectionBar(mockContainer, mockManager);

      await bar.disconnect();

      expect(mockManager.disconnect).toHaveBeenCalled();

      bar.destroy();
    });

    it('reacts to ADB error events and opens troubleshooting', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(errorListener).toBeDefined();
      const mockErr = new Error('Auth rejected');
      const mockDiag: AdbErrorDiagnostic = {
        code: 'AUTH_REJECTED',
        message: 'Auth rejected',
        suggestion: 'Tap allow on device',
      };

      vi.mocked(mockManager.getState).mockReturnValue('error');
      vi.mocked(mockManager.getLastDiagnostic).mockReturnValue(mockDiag);

      errorListener?.(mockErr, mockDiag);

      expect(mockContainer.innerHTML).toContain('Device Authentication Required (RSA Key)');

      bar.destroy();
    });

    it('reacts to disconnect events and re-renders disconnected state', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(disconnectListener).toBeDefined();
      vi.mocked(mockManager.getState).mockReturnValue('disconnected');
      vi.mocked(mockManager.getDeviceInfo).mockReturnValue(null);

      disconnectListener?.();

      expect(mockContainer.innerHTML).toContain('status-disconnected');
      expect(mockContainer.innerHTML).toContain('No Android device connected');

      bar.destroy();
    });

    it('cleans up event listeners on destroy()', () => {
      const bar = new ConnectionBar(mockContainer, mockManager);

      expect(mockManager.onStateChange).toHaveBeenCalled();
      expect(mockManager.onError).toHaveBeenCalled();
      expect(mockManager.onDisconnect).toHaveBeenCalled();

      bar.destroy();
      expect(mockContainer.innerHTML).toBe('');
    });
  });

  describe('Responsive Structure & CSS Class Mapping', () => {
    it('renders all structural sections required for responsive layout adaptation', () => {
      const mockInfo: AdbDeviceInfo = {
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        androidVersion: '16',
        sdkVersion: '36',
        serialNumber: 'ABC123XYZ',
      };

      vi.mocked(mockManager.getState).mockReturnValue('ready');
      vi.mocked(mockManager.getDeviceInfo).mockReturnValue(mockInfo);

      const bar = new ConnectionBar(mockContainer, mockManager);

      // Verify outer flex container
      expect(mockContainer.innerHTML).toContain('connection-bar-inner');

      // Verify 3 responsive section containers
      expect(mockContainer.innerHTML).toContain('connection-bar-brand');
      expect(mockContainer.innerHTML).toContain('connection-bar-center');
      expect(mockContainer.innerHTML).toContain('connection-bar-actions');

      // Verify brand details and badge container
      expect(mockContainer.innerHTML).toContain('brand-title');
      expect(mockContainer.innerHTML).toContain('brand-badges');
      expect(mockContainer.innerHTML).toContain('compat-badge');

      // Verify metadata details and tag containers
      expect(mockContainer.innerHTML).toContain('device-metadata-card');
      expect(mockContainer.innerHTML).toContain('device-primary');
      expect(mockContainer.innerHTML).toContain('device-tags');
      expect(mockContainer.innerHTML).toContain('meta-tag version-tag');
      expect(mockContainer.innerHTML).toContain('meta-tag api-tag');

      // Verify action items
      expect(mockContainer.innerHTML).toContain('status-pill');
      expect(mockContainer.innerHTML).toContain('btn-disconnect');
      expect(mockContainer.innerHTML).toContain('btn-help');

      bar.destroy();
    });
  });
});
