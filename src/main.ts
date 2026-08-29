/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import './styles/main.css';
import { AdbManager } from './transport/adb-client';
import { ConnectionBar, FunctionCatalog, FunctionTester, LogDrawer } from './ui';
import { WebMcpBridge, isWebMcpSupported } from './webmcp';
import { logger } from './utils/logger';

logger.info('APP', 'WebMCP ↔ Android AppFunctions Bridge initializing...');

// Native WebMCP compatibility verification
const isWebMCPAvailable = isWebMcpSupported();
logger.info('WebMCP', `Native WebMCP supported: ${isWebMCPAvailable}`);

// Initialize ADB transport manager
export const adbManager = new AdbManager();

// Initialize WebMCP bridge linked to ADB manager
export const bridge = new WebMcpBridge({ adbManager });

// Mount ConnectionBar UI component
const connectionBarContainer = document.getElementById('connection-bar');
export let connectionBar: ConnectionBar | null = null;
if (connectionBarContainer) {
  connectionBar = new ConnectionBar(connectionBarContainer, adbManager);
  logger.info('APP', 'ConnectionBar mounted successfully.');
}

// Mount FunctionTester UI component
const testerContainer = document.getElementById('tester-view');
export let functionTester: FunctionTester | null = null;
if (testerContainer) {
  functionTester = new FunctionTester(testerContainer, {
    adbManager,
    bridge,
  });
  logger.info('APP', 'FunctionTester mounted successfully.');
}

// Mount FunctionCatalog UI component
const catalogContainer = document.getElementById('catalog-view');
export let functionCatalog: FunctionCatalog | null = null;
if (catalogContainer) {
  functionCatalog = new FunctionCatalog(catalogContainer, {
    adbManager,
    bridge,
    onSelectFunction: (def) => {
      if (functionTester) {
        functionTester.selectFunction(def);
      }
    },
  });
  logger.info('APP', 'FunctionCatalog mounted successfully.');
}

// Mount LogDrawer UI component
const logDrawerContainer = document.getElementById('log-drawer');
export let logDrawer: LogDrawer | null = null;
if (logDrawerContainer) {
  logDrawer = new LogDrawer(logDrawerContainer);
  logger.info('APP', 'LogDrawer mounted successfully.');
}
