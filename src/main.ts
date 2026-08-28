/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import "./styles/main.css";

console.log("WebMCP ↔ Android AppFunctions Bridge initialized");

// Type check verification for WebMCP on document.modelContext
if (typeof document !== "undefined") {
  const isWebMCPAvailable = typeof document.modelContext !== "undefined";
  console.log(`Native WebMCP supported: ${isWebMCPAvailable}`);
}
