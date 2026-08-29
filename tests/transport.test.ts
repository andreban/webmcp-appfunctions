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
import { MessageChannel } from '../src/transport/wadb/lib/message/MessageChannel';
import { Message } from '../src/transport/wadb/lib/message/Message';
import { Stream } from '../src/transport/wadb/lib/Stream';
import { Options } from '../src/transport/wadb/lib/Options';
import { Transport } from '../src/transport/wadb/lib/transport/Transport';
import * as shellModule from '../src/transport/shell';

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

    it('serializes concurrent execShell commands sequentially through shellQueue', async () => {
      manager['setState']('ready');
      const mockClient = {} as unknown as AdbClient;
      manager['client'] = mockClient;

      const executionOrder: string[] = [];
      let resolveFirst: (() => void) | undefined;

      // Mock the underlying execShell function that manager.execShell delegates to
      vi.spyOn(shellModule, 'execShell').mockImplementation(async (_client, cmd) => {
        executionOrder.push(`start:${cmd}`);
        if (cmd === 'first') {
          await new Promise<void>((res) => {
            resolveFirst = res;
          });
        }
        executionOrder.push(`finish:${cmd}`);
        return { stdout: `output:${cmd}`, stderr: '', exitCode: 0, raw: '' };
      });

      const p1 = manager.execShell('first');
      const p2 = manager.execShell('second');

      // Wait a tick for microtask to execute the first queued promise
      await new Promise((res) => setTimeout(res, 10));

      // Command 1 has started, Command 2 should wait for Command 1
      expect(executionOrder).toContain('start:first');
      expect(executionOrder).not.toContain('start:second');

      if (resolveFirst) {
        (resolveFirst as () => void)();
      }
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.stdout).toBe('output:first');
      expect(r2.stdout).toBe('output:second');
      expect(executionOrder).toEqual([
        'start:first',
        'finish:first',
        'start:second',
        'finish:second',
      ]);
    });
  });

  describe('MessageChannel & Stream Concurrency Safety', () => {
    const mockOptions: Options = {
      debug: false,
      dump: false,
      useChecksum: true,
      keySize: 2048,
    };

    it('MessageChannel combines header and data into one atomic ArrayBuffer and serializes writes', async () => {
      const writtenBuffers: ArrayBuffer[] = [];
      let pendingResolve: (() => void) | undefined;

      const mockTransport: Transport = {
        read: vi.fn().mockImplementation(() => new Promise(() => {})),
        write: vi.fn().mockImplementation(async (data: ArrayBuffer) => {
          writtenBuffers.push(data);
          if (writtenBuffers.length === 1) {
            await new Promise<void>((res) => {
              pendingResolve = res;
            });
          }
        }),
      };

      const dummyListener = { newMessage: vi.fn() };
      const channel = new MessageChannel(mockTransport, mockOptions, dummyListener);

      const msg1 = Message.open(1, 0, 'shell:getprop', true);
      const msg2 = Message.open(2, 0, 'shell:cmd app_function', true);

      const write1 = channel.write(msg1);
      const write2 = channel.write(msg2);

      // Wait a tick for microtask to invoke first write
      await new Promise((res) => setTimeout(res, 10));

      // First write was invoked
      expect(mockTransport.write).toHaveBeenCalledTimes(1);

      // Unblock first write
      if (pendingResolve) {
        (pendingResolve as () => void)();
      }
      await Promise.all([write1, write2]);

      // Both writes completed sequentially
      expect(mockTransport.write).toHaveBeenCalledTimes(2);

      // Verify each write received contiguous header + data in a single buffer (24 header + payload)
      expect(writtenBuffers[0].byteLength).toBe(24 + (msg1.data?.byteLength ?? 0));
      expect(writtenBuffers[1].byteLength).toBe(24 + (msg2.data?.byteLength ?? 0));

      channel.close();
    });

    it('Stream.open handles concurrent stream opening without response message loss', async () => {
      const keyStore = new BrowserKeyStore();
      const mockTransport: Transport = {
        read: vi.fn().mockImplementation(() => new Promise(() => {})),
        write: vi.fn().mockResolvedValue(undefined),
      };

      const adbClient = new AdbClient(mockTransport, mockOptions, keyStore);

      const streamPromise1 = Stream.open(adbClient, 'shell:cmd1', mockOptions);
      const streamPromise2 = Stream.open(adbClient, 'shell:cmd2', mockOptions);

      // Simulate device responding with OKAY for stream 2 first (localId=2, remoteId=200), then stream 1 (localId=1, remoteId=100)
      const okay2 = Message.newMessage('OKAY', 200, 2, true);
      const okay1 = Message.newMessage('OKAY', 100, 1, true);

      adbClient.newMessage(okay2);
      adbClient.newMessage(okay1);

      const [s1, s2] = await Promise.all([streamPromise1, streamPromise2]);

      expect(s1.localId).toBe(1);
      expect(s1.remoteId).toBe(100);
      expect(s2.localId).toBe(2);
      expect(s2.remoteId).toBe(200);
    });
  });
});
