/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdbManager } from '../transport/adb-client';
import {
  DiscoveryOptions,
  DiscoveryResult,
} from '../types/appfunctions';
import { parseRawAppFunctionsJson } from './parser';
import { logger } from '../utils/logger';
import { escapeShellArg } from '../utils/sanitize';

/**
 * Discovery client that executes and parses `cmd app_function list-app-functions`
 * commands over ADB on connected Android 16+ devices.
 */
export class AppFunctionsDiscovery {
  private adbManager: AdbManager;

  constructor(adbManager: AdbManager) {
    this.adbManager = adbManager;
  }

  /**
   * Returns the underlying AdbManager instance.
   */
  getAdbManager(): AdbManager {
    return this.adbManager;
  }

  /**
   * Constructs the shell command to list registered AppFunctions.
   *
   * @param packageName Optional package name filter.
   * @returns Formatted shell command string.
   */
  static buildCommand(packageName?: string): string {
    const trimmed = packageName?.trim();
    if (!trimmed) {
      return 'cmd app_function list-app-functions';
    }
    return `cmd app_function list-app-functions --package ${escapeShellArg(trimmed)}`;
  }

  /**
   * Queries the connected Android device for registered AppFunctions and parses their schemas.
   *
   * @param options Discovery options including optional package filter, timeout, and cancellation signal.
   * @returns DiscoveryResult containing structured function schemas and discovery metadata.
   */
  async discover(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
    if (!this.adbManager.isConnected()) {
      throw new Error(
        `Cannot discover AppFunctions: ADB connection is not ready (current state: ${this.adbManager.getState()}).`
      );
    }

    const command = AppFunctionsDiscovery.buildCommand(options.packageName);
    logger.info(
      'ADB',
      `Discovering AppFunctions${options.packageName ? ` for package '${options.packageName}'` : ''}...`
    );

    const startTime = Date.now();

    const shellResult = await this.adbManager.execShell(command, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });

    const executionTimeMs = Date.now() - startTime;

    if (shellResult.exitCode !== 0 && shellResult.stderr) {
      const stderr = shellResult.stderr.trim();
      if (stderr.includes('SecurityException')) {
        throw new Error(`Permission denied querying AppFunctions: ${stderr}`);
      }
      if (stderr.includes('Unknown command') || stderr.includes('not found')) {
        throw new Error(
          `AppFunctions service not available on this Android device (requires Android 16+ / API 36+): ${stderr}`
        );
      }
      throw new Error(`Failed to list AppFunctions: ${stderr}`);
    }

    const rawOutput = shellResult.stdout || shellResult.raw;
    const functions = parseRawAppFunctionsJson(rawOutput);

    // Extract unique sorted package names
    const packagesSet = new Set<string>();
    for (const fn of functions) {
      if (fn.packageName) {
        packagesSet.add(fn.packageName);
      }
    }
    const packages = Array.from(packagesSet).sort();

    logger.info(
      'ADB',
      `Discovered ${functions.length} AppFunction(s) across ${packages.length} package(s) in ${executionTimeMs}ms.`
    );

    return {
      functions,
      totalCount: functions.length,
      packageCount: packages.length,
      packages,
      executionTimeMs,
      rawOutput,
    };
  }

  /**
   * Convenience helper to discover AppFunctions for a specific package.
   *
   * @param packageName Target Android package name (e.g. 'com.example.notes').
   * @param options Optional discovery options.
   * @returns DiscoveryResult for the specified package.
   */
  async discoverByPackage(
    packageName: string,
    options: Omit<DiscoveryOptions, 'packageName'> = {}
  ): Promise<DiscoveryResult> {
    return this.discover({ ...options, packageName });
  }

  /**
   * Queries and returns a list of unique package names that have registered AppFunctions.
   *
   * @param options Discovery options.
   * @returns Array of package names.
   */
  async listPackages(options: DiscoveryOptions = {}): Promise<string[]> {
    const result = await this.discover(options);
    return result.packages;
  }
}
