/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle states for ADB connection over WebUSB.
 */
export type AdbConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authorizing'
  | 'ready'
  | 'error';

/**
 * Diagnostic error codes for common ADB / WebUSB issues.
 */
export type AdbErrorCode =
  | 'WEBUSB_NOT_SUPPORTED'
  | 'DEVICE_NOT_SELECTED'
  | 'USB_INTERFACE_BUSY'
  | 'AUTH_REJECTED'
  | 'DEVICE_DISCONNECTED'
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_ABORTED'
  | 'NOT_CONNECTED'
  | 'UNKNOWN_ERROR';

/**
 * Rich error diagnostic information with actionable recovery advice.
 */
export interface AdbErrorDiagnostic {
  code: AdbErrorCode;
  message: string;
  suggestion: string;
  originalError?: unknown;
}

/**
 * Structured device information retrieved after successful connection.
 */
export interface AdbDeviceInfo {
  productName: string;
  productDevice: string;
  productModel: string;
  features: string[];
  manufacturerName?: string;
  serialNumber?: string;
  vendorId?: number;
  productId?: number;
}

/**
 * Execution result for an ADB shell command.
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  raw: string;
}

/**
 * Options for executing an ADB shell command.
 */
export interface ExecOptions {
  /**
   * Execution timeout in milliseconds (default: 10000ms).
   */
  timeoutMs?: number;

  /**
   * Optional AbortSignal to cancel command execution.
   */
  signal?: AbortSignal;
}

/**
 * Listener for ADB connection state changes.
 */
export type AdbStateChangeListener = (
  state: AdbConnectionState,
  error?: Error,
  diagnostic?: AdbErrorDiagnostic
) => void;

/**
 * Listener for ADB errors.
 */
export type AdbErrorListener = (
  error: Error,
  diagnostic: AdbErrorDiagnostic
) => void;

/**
 * Listener for device disconnect events.
 */
export type AdbDisconnectListener = () => void;
