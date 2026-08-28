/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdbManager, diagnoseAdbError } from '../src/transport/adb-client';
import { BrowserKeyStore } from '../src/transport/auth-keys';
import { WebUsbTransport } from '../src/transport/wadb/lib/transport/WebUsbTransport';
import { AdbClient } from '../src/transport/wadb/lib/AdbClient';
import { AdbConnectionInformation } from '../src/transport/wadb/lib/AdbConnectionInformation';
import { AdbConnectionState } from '../src/types/adb';

describe('ADB Transport Manager & Diagnostics', () => {
  describe('diagnoseAdbError', () => {
    it('diagnoses user cancellation as DEVICE_NOT_SELECTED', () => {
      const err = new DOMException('No device selected', 'NotFoundError');
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('DEVICE_NOT_SELECTED');
      expect(diag.suggestion).toContain('select your connected Android device');
    });

    it('diagnoses interface claim conflict as USB_INTERFACE_BUSY', () => {
      const err = new DOMException('Unable to claim interface', 'NetworkError');
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('USB_INTERFACE_BUSY');
      expect(diag.suggestion).toContain('adb kill-server');
    });

    it('diagnoses authentication rejection as AUTH_REJECTED', () => {
      const err = new Error("AUTH failed. Phone didn't accept key");
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('AUTH_REJECTED');
      expect(diag.suggestion).toContain('Allow USB debugging');
    });

    it('diagnoses missing WebUSB API as WEBUSB_NOT_SUPPORTED', () => {
      const err = new Error('WebUSB is not available in this environment');
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('WEBUSB_NOT_SUPPORTED');
      expect(diag.suggestion).toContain('Chromium-based browser');
    });

    it('diagnoses disconnection as DEVICE_DISCONNECTED', () => {
      const err = new Error('Response didn\'t contain any data');
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('DEVICE_DISCONNECTED');
      expect(diag.suggestion).toContain('USB cable is securely connected');
    });

    it('falls back to UNKNOWN_ERROR for generic errors', () => {
      const err = new Error('Something strange happened');
      const diag = diagnoseAdbError(err);
      expect(diag.code).toBe('UNKNOWN_ERROR');
      expect(diag.message).toBe('Something strange happened');
    });
  });

  describe('AdbManager Lifecycle', () => {
    let manager: AdbManager;
    let keyStore: BrowserKeyStore;

    beforeEach(() => {
      keyStore = new BrowserKeyStore();
      manager = new AdbManager({}, keyStore);
    });

    it('initializes in disconnected state', () => {
      expect(manager.getState()).toBe('disconnected');
      expect(manager.isConnected()).toBe(false);
      expect(manager.getDeviceInfo()).toBeNull();
      expect(manager.getDevice()).toBeNull();
      expect(manager.getLastError()).toBeNull();
      expect(manager.getLastDiagnostic()).toBeNull();
    });

    it('throws error when execShell is called while disconnected', async () => {
      await expect(manager.execShell('ls')).rejects.toThrow(
        'Cannot execute command: ADB connection is not ready'
      );
    });

    it('subscribes and unsubscribes from state change listener', () => {
      const states: AdbConnectionState[] = [];
      const unsubscribe = manager.onStateChange((state) => {
        states.push(state);
      });

      manager['setState']('connecting');
      manager['setState']('ready');

      expect(states).toEqual(['connecting', 'ready']);

      unsubscribe();
      manager['setState']('disconnected');
      expect(states).toEqual(['connecting', 'ready']);
    });

    it('handles device disconnect event and notifies listeners', async () => {
      let disconnectedNotified = false;
      manager.onDisconnect(() => {
        disconnectedNotified = true;
      });

      manager['setState']('ready');
      await manager.handleDeviceDisconnect();

      expect(manager.getState()).toBe('disconnected');
      expect(manager.getDeviceInfo()).toBeNull();
      expect(disconnectedNotified).toBe(true);
    });

    it('handles successful connection flow with mock device and transport', async () => {
      const stateHistory: AdbConnectionState[] = [];
      manager.onStateChange((state) => {
        stateHistory.push(state);
      });

      const mockDevice = {
        productName: 'Pixel 9 Pro',
        manufacturerName: 'Google',
        serialNumber: 'TEST123456',
        vendorId: 0x18d1,
        productId: 0x4ee7,
      } as unknown as USBDevice;

      const mockTransport = {
        device: mockDevice,
        read: vi.fn().mockImplementation(() => new Promise(() => {})),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebUsbTransport;

      vi.spyOn(WebUsbTransport, 'openDevice').mockResolvedValue(mockTransport);

      const mockConnInfo = new AdbConnectionInformation(
        'komodo',
        'komodo',
        'Pixel 9 Pro',
        ['cmd', 'shell_v2', 'stat_v2']
      );

      vi.spyOn(AdbClient.prototype, 'connect').mockResolvedValue(mockConnInfo);

      // Mock navigator.usb
      const originalUsb = globalThis.navigator?.usb;
      Object.defineProperty(globalThis.navigator, 'usb', {
        value: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      try {
        const info = await manager.connect(mockDevice);

        expect(info).toEqual({
          productName: 'komodo',
          productDevice: 'komodo',
          productModel: 'Pixel 9 Pro',
          features: ['cmd', 'shell_v2', 'stat_v2'],
          manufacturerName: 'Google',
          serialNumber: 'TEST123456',
          vendorId: 0x18d1,
          productId: 0x4ee7,
        });

        expect(manager.getState()).toBe('ready');
        expect(manager.isConnected()).toBe(true);
        expect(stateHistory).toContain('connecting');
        expect(stateHistory).toContain('ready');

        // Test disconnect
        await manager.disconnect();
        expect(manager.getState()).toBe('disconnected');
        expect(manager.isConnected()).toBe(false);
      } finally {
        if (originalUsb) {
          Object.defineProperty(globalThis.navigator, 'usb', {
            value: originalUsb,
            configurable: true,
          });
        }
      }
    });

    it('transitions to error state on connection failure and notifies error listeners', async () => {
      let emittedError: Error | null = null;
      let emittedDiag: unknown = null;

      manager.onError((err, diag) => {
        emittedError = err;
        emittedDiag = diag;
      });

      vi.spyOn(WebUsbTransport, 'openDevice').mockRejectedValue(
        new DOMException('Unable to claim interface', 'SecurityError')
      );

      const mockDevice = {} as USBDevice;

      // Mock navigator.usb
      const originalUsb = globalThis.navigator?.usb;
      Object.defineProperty(globalThis.navigator, 'usb', {
        value: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      try {
        await expect(manager.connect(mockDevice)).rejects.toThrow();

        expect(manager.getState()).toBe('error');
        expect(manager.getLastDiagnostic()?.code).toBe('USB_INTERFACE_BUSY');
        expect(emittedError).toBeDefined();
        expect(emittedDiag).toBeDefined();
      } finally {
        if (originalUsb) {
          Object.defineProperty(globalThis.navigator, 'usb', {
            value: originalUsb,
            configurable: true,
          });
        }
      }
    });

    it('fetches and parses extended device metadata via getprop', async () => {
      manager['setState']('ready');
      manager['client'] = {} as unknown as AdbClient;
      manager['deviceInfo'] = {
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
      };

      vi.spyOn(manager, 'execShell').mockResolvedValue({
        stdout: 'Google\n---PROP---\nPixel 9 Pro\n---PROP---\n16\n---PROP---\n36',
        stderr: '',
        exitCode: 0,
        raw: '',
      });

      const updated = await manager.fetchDeviceMetadata();
      expect(updated).toEqual({
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        androidVersion: '16',
        sdkVersion: '36',
      });
    });

    it('handles getprop failure gracefully without throwing', async () => {
      manager['setState']('ready');
      manager['client'] = {} as unknown as AdbClient;
      manager['deviceInfo'] = {
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
      };

      vi.spyOn(manager, 'execShell').mockRejectedValue(new Error('getprop failed'));

      const result = await manager.fetchDeviceMetadata();
      expect(result).toEqual({
        productName: 'komodo',
        productDevice: 'komodo',
        productModel: 'Pixel 9 Pro',
        features: ['cmd'],
      });
    });
  });
});
