/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbClient } from './wadb/lib/AdbClient';
import { WebUsbTransport } from './wadb/lib/transport/WebUsbTransport';
import { Options } from './wadb/lib/Options';
import { BrowserKeyStore } from './auth-keys';
import { execShell } from './shell';
import {
  AdbConnectionState,
  AdbDeviceInfo,
  AdbDisconnectListener,
  AdbErrorDiagnostic,
  AdbErrorListener,
  AdbStateChangeListener,
  ExecOptions,
  ShellResult,
} from '../types/adb';
import { logger } from '../utils/logger';

const DEFAULT_OPTIONS: Options = {
  debug: false,
  dump: false,
  useChecksum: true,
  keySize: 2048,
};

/**
 * Diagnoses an error occurring during ADB connection or execution,
 * returning structured diagnostic codes and user recovery instructions.
 */
export function diagnoseAdbError(error: unknown): AdbErrorDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';

  // 1. User cancelled or no device selected in browser picker
  if (
    name === 'NotFoundError' ||
    (name === 'AbortError' && message.includes('selected')) ||
    message.includes('No device selected') ||
    message.includes('No device was selected') ||
    message.includes('Must be handling a user gesture')
  ) {
    return {
      code: 'DEVICE_NOT_SELECTED',
      message: 'No USB device was selected.',
      suggestion: 'Please click Connect and select your connected Android device in the browser prompt.',
      originalError: error,
    };
  }

  // 2. Interface already claimed / USB busy
  if (
    name === 'SecurityError' ||
    name === 'NetworkError' ||
    message.includes('claimInterface') ||
    message.includes('Unable to claim interface') ||
    message.includes('Device is already open') ||
    message.includes('already claimed')
  ) {
    return {
      code: 'USB_INTERFACE_BUSY',
      message: 'USB interface is currently claimed by another process or driver.',
      suggestion:
        'Ensure no local adb server is running in the background (run "adb kill-server" in your terminal) and close any other browser tabs using WebUSB.',
      originalError: error,
    };
  }

  // 3. Auth rejected or timed out on device
  if (
    message.includes('AUTH failed') ||
    message.includes('Phone didn\'t accept key') ||
    message.includes('unauthorized')
  ) {
    return {
      code: 'AUTH_REJECTED',
      message: 'ADB authentication was rejected or timed out on the device.',
      suggestion:
        'Please unlock your Android phone and tap "Allow" on the "Allow USB debugging?" dialog. Check "Always allow from this computer" for seamless connections.',
      originalError: error,
    };
  }

  // 4. WebUSB not supported in browser environment
  if (
    message.includes('WebUSB is not available') ||
    message.includes('navigator.usb') ||
    message.includes('WebUSB is not supported')
  ) {
    return {
      code: 'WEBUSB_NOT_SUPPORTED',
      message: 'WebUSB API is not supported in this browser.',
      suggestion:
        'Please use a Chromium-based browser (Google Chrome, Microsoft Edge, Brave) served over HTTPS or localhost.',
      originalError: error,
    };
  }

  // 5. Timeout
  if (name === 'AdbTimeoutError' || (error as { code?: string })?.code === 'COMMAND_TIMEOUT') {
    return {
      code: 'COMMAND_TIMEOUT',
      message,
      suggestion: 'The command took longer than expected. Check if the device is responsive.',
      originalError: error,
    };
  }

  // 6. Aborted
  if (name === 'AdbAbortError' || (error as { code?: string })?.code === 'COMMAND_ABORTED') {
    return {
      code: 'COMMAND_ABORTED',
      message,
      suggestion: 'The command execution was cancelled by the caller.',
      originalError: error,
    };
  }

  // 7. Disconnected
  if (
    message.includes('disconnected') ||
    message.includes('Response didn\'t contain any data') ||
    message.includes('transferIn') ||
    message.includes('transferOut')
  ) {
    return {
      code: 'DEVICE_DISCONNECTED',
      message: 'The USB device was disconnected.',
      suggestion: 'Verify that the USB cable is securely connected and that USB Debugging is turned on in Android Developer Options.',
      originalError: error,
    };
  }

  // Default unknown
  return {
    code: 'UNKNOWN_ERROR',
    message: message || 'An unexpected ADB error occurred.',
    suggestion: 'Check the connection and try reconnecting the device.',
    originalError: error,
  };
}

/**
 * AdbManager coordinates the WebUSB transport lifecycle, device authentication,
 * connection state transitions, and shell command execution.
 */
export class AdbManager {
  private state: AdbConnectionState = 'disconnected';
  private deviceInfo: AdbDeviceInfo | null = null;
  private device: USBDevice | null = null;
  private transport: WebUsbTransport | null = null;
  private client: AdbClient | null = null;
  private keyStore: BrowserKeyStore;
  private options: Options;
  private lastError: Error | null = null;
  private lastDiagnostic: AdbErrorDiagnostic | null = null;

  private stateListeners: Set<AdbStateChangeListener> = new Set();
  private errorListeners: Set<AdbErrorListener> = new Set();
  private disconnectListeners: Set<AdbDisconnectListener> = new Set();
  private usbDisconnectHandler: ((event: USBConnectionEvent) => void) | null = null;

  constructor(options: Partial<Options> = {}, keyStore?: BrowserKeyStore) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.keyStore = keyStore ?? new BrowserKeyStore();

    // When the keyStore is accessed during authentication handshake, transition to 'authorizing'
    this.keyStore.onAuthChallenge = () => {
      if (this.state === 'connecting') {
        this.setState('authorizing');
      }
    };
  }

  /**
   * Current ADB connection state.
   */
  getState(): AdbConnectionState {
    return this.state;
  }

  /**
   * Current connected device information, if ready.
   */
  getDeviceInfo(): AdbDeviceInfo | null {
    return this.deviceInfo;
  }

  /**
   * Raw USBDevice instance, if connected.
   */
  getDevice(): USBDevice | null {
    return this.device;
  }

  /**
   * Active AdbClient instance, if connected.
   */
  getAdbClient(): AdbClient | null {
    return this.client;
  }

  /**
   * KeyStore instance used for RSA authentication.
   */
  getKeyStore(): BrowserKeyStore {
    return this.keyStore;
  }

  /**
   * Most recent error encountered during connection or execution.
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Diagnostic details for the most recent error.
   */
  getLastDiagnostic(): AdbErrorDiagnostic | null {
    return this.lastDiagnostic;
  }

  /**
   * Whether the connection is currently ready for ADB commands.
   */
  isConnected(): boolean {
    return this.state === 'ready' && this.client !== null;
  }

  /**
   * Initiates connection to an Android device over WebUSB.
   * If a USBDevice is provided, connects directly to it; otherwise prompts the user.
   *
   * @param device Optional pre-selected USBDevice.
   * @returns Device information upon successful connection.
   */
  async connect(device?: USBDevice): Promise<AdbDeviceInfo> {
    if (this.state === 'connecting' || this.state === 'authorizing') {
      throw new Error('Connection is already in progress.');
    }

    // Clean up any stale connection
    if (this.state !== 'disconnected') {
      await this.disconnect();
    }

    this.lastError = null;
    this.lastDiagnostic = null;
    this.setState('connecting');
    logger.info('USB', 'Starting WebUSB ADB connection...');

    try {
      if (typeof navigator === 'undefined' || !navigator.usb) {
        throw new Error(
          'WebUSB is not available. Ensure the page is served over HTTPS or localhost, and that you are using a Chromium-based browser.'
        );
      }

      // Open WebUSB transport
      if (device) {
        this.transport = await WebUsbTransport.openDevice(device, this.options);
      } else {
        this.transport = await WebUsbTransport.open(this.options);
      }

      this.device = this.transport.device;
      logger.info(
        'USB',
        `Claimed WebUSB interface for device: ${this.device.productName || 'Android Device'} (VID: 0x${this.device.vendorId.toString(16)}, PID: 0x${this.device.productId.toString(16)})`
      );

      // Register USB disconnect listener
      this.usbDisconnectHandler = (event: USBConnectionEvent) => {
        if (this.device && event.device === this.device) {
          logger.warn('USB', `Device disconnected: ${event.device.productName || 'Android Device'}`);
          this.handleDeviceDisconnect();
        }
      };
      navigator.usb.addEventListener('disconnect', this.usbDisconnectHandler);

      // Create and connect AdbClient
      this.client = new AdbClient(this.transport, this.options, this.keyStore);
      logger.info('ADB', 'Initiating ADB protocol handshake and authentication...');

      const connectionInfo = await this.client.connect();

      const info: AdbDeviceInfo = {
        productName: connectionInfo.productName,
        productDevice: connectionInfo.productDevice,
        productModel: connectionInfo.productModel,
        features: connectionInfo.features,
        manufacturerName: this.device.manufacturerName ?? undefined,
        serialNumber: this.device.serialNumber ?? undefined,
        vendorId: this.device.vendorId,
        productId: this.device.productId,
      };

      this.deviceInfo = info;

      this.setState('ready');
      logger.info(
        'ADB',
        `ADB Connected successfully! Device: ${info.productModel} (${info.productName})`
      );

      return info;
    } catch (err) {
      const diagnostic = diagnoseAdbError(err);
      const errorObj = err instanceof Error ? err : new Error(String(err));
      this.lastError = errorObj;
      this.lastDiagnostic = diagnostic;

      logger.error('ADB', `ADB connection failed [${diagnostic.code}]: ${diagnostic.message}`, err);

      // Clean up transport and client on error
      await this.cleanupResources();
      this.setState('error', errorObj, diagnostic);
      this.emitError(errorObj, diagnostic);

      throw errorObj;
    }
  }

  /**
   * Disconnects from the current device and resets connection state.
   */
  async disconnect(): Promise<void> {
    logger.info('ADB', 'Disconnecting ADB connection...');
    await this.cleanupResources();
    this.deviceInfo = null;
    this.setState('disconnected');
    logger.info('ADB', 'Disconnected.');
  }

  /**
   * Handles device disconnect triggered by WebUSB event or physical disconnection.
   */
  async handleDeviceDisconnect(): Promise<void> {
    await this.cleanupResources();
    this.deviceInfo = null;
    this.setState('disconnected');

    for (const listener of this.disconnectListeners) {
      try {
        listener();
      } catch (err) {
        logger.error('USB', 'Error in disconnect listener:', err);
      }
    }
  }

  /**
   * Executes a shell command on the connected Android device.
   *
   * @param command The command to execute (e.g. 'cmd app_function list-app-functions').
   * @param options Execution options including timeoutMs and AbortSignal.
   * @returns Structured ShellResult.
   */
  async execShell(command: string, options?: ExecOptions): Promise<ShellResult> {
    if (this.state !== 'ready' || !this.client) {
      const err = new Error(
        `Cannot execute command: ADB connection is not ready (current state: ${this.state}).`
      );
      const diagnostic = diagnoseAdbError(err);
      this.emitError(err, diagnostic);
      throw err;
    }

    try {
      return await execShell(this.client, command, options);
    } catch (err) {
      const diagnostic = diagnoseAdbError(err);
      this.emitError(err instanceof Error ? err : new Error(String(err)), diagnostic);
      throw err;
    }
  }

  /**
   * Fetches extended device properties via Android `getprop` shell command.
   * Updates cached deviceInfo and notifies state listeners.
   *
   * @returns Updated AdbDeviceInfo or null if not connected.
   */
  async fetchDeviceMetadata(): Promise<AdbDeviceInfo | null> {
    if (this.state !== 'ready' || !this.client || !this.deviceInfo) {
      return this.deviceInfo;
    }

    try {
      const cmd =
        'getprop ro.product.manufacturer; echo "---PROP---"; getprop ro.product.model; echo "---PROP---"; getprop ro.build.version.release; echo "---PROP---"; getprop ro.build.version.sdk';
      const result = await this.execShell(cmd, { timeoutMs: 3000 });

      if (result.stdout) {
        const parts = result.stdout.split('---PROP---').map((p) => p.trim());
        const [mfg, model, release, sdk] = parts;

        const updated: AdbDeviceInfo = {
          ...this.deviceInfo,
          manufacturer: mfg || this.deviceInfo.manufacturerName || undefined,
          model: model || this.deviceInfo.productModel || undefined,
          androidVersion: release || undefined,
          sdkVersion: sdk || undefined,
        };

        this.deviceInfo = updated;
        logger.debug(
          'ADB',
          `Fetched device metadata: ${updated.manufacturer ?? ''} ${updated.model ?? ''} (Android ${updated.androidVersion ?? '?'}, SDK ${updated.sdkVersion ?? '?'})`
        );

        for (const listener of this.stateListeners) {
          try {
            listener(this.state);
          } catch (err) {
            logger.error('ADB', 'Error in state change listener:', err);
          }
        }
      }
    } catch (err) {
      logger.warn('ADB', 'Failed to fetch extended device properties via getprop:', err);
    }

    return this.deviceInfo;
  }

  /**
   * Subscribes to connection state changes.
   * @returns Unsubscribe function.
   */
  onStateChange(listener: AdbStateChangeListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Subscribes to ADB errors.
   * @returns Unsubscribe function.
   */
  onError(listener: AdbErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * Subscribes to device disconnect events.
   * @returns Unsubscribe function.
   */
  onDisconnect(listener: AdbDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private setState(
    newState: AdbConnectionState,
    error?: Error,
    diagnostic?: AdbErrorDiagnostic
  ): void {
    if (this.state === newState && !error) {
      return;
    }
    this.state = newState;
    logger.debug('ADB', `Connection state changed to: ${newState}`);

    for (const listener of this.stateListeners) {
      try {
        listener(newState, error, diagnostic);
      } catch (err) {
        logger.error('ADB', 'Error in state change listener:', err);
      }
    }
  }

  private emitError(error: Error, diagnostic: AdbErrorDiagnostic): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error, diagnostic);
      } catch (err) {
        logger.error('ADB', 'Error in error listener:', err);
      }
    }
  }

  private async cleanupResources(): Promise<void> {
    if (this.usbDisconnectHandler && typeof navigator !== 'undefined' && navigator.usb) {
      try {
        navigator.usb.removeEventListener('disconnect', this.usbDisconnectHandler);
      } catch {
        // Ignore listener removal errors
      }
      this.usbDisconnectHandler = null;
    }

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        logger.debug('ADB', 'Error disconnecting AdbClient:', err);
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (err) {
        logger.debug('USB', 'Error closing WebUsbTransport:', err);
      }
      this.transport = null;
    }

    this.device = null;
  }
}
