/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import './styles/main.css';
import { AdbManager } from './transport/adb-client';
import { ConnectionBar } from './ui/connection-bar';
import { logger } from './utils/logger';

logger.info('APP', 'WebMCP ↔ Android AppFunctions Bridge initializing...');

// Native WebMCP compatibility verification
if (typeof document !== 'undefined') {
  const isWebMCPAvailable =
    'modelContext' in document && Boolean(document.modelContext);
  logger.info('WebMCP', `Native WebMCP supported: ${isWebMCPAvailable}`);
}

// Initialize ADB transport manager
const adbManager = new AdbManager();

// Mount ConnectionBar UI component
const connectionBarContainer = document.getElementById('connection-bar');
if (connectionBarContainer) {
  new ConnectionBar(connectionBarContainer, adbManager);
  logger.info('APP', 'ConnectionBar mounted successfully.');
}
