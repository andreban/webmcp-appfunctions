/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { AdbClient, IndexedDbKeyStore, WebUsbTransport } from "../src/transport/wadb/index";

describe("Project Setup", () => {
  it("initializes successfully", () => {
    expect(true).toBe(true);
  });

  it("exports wadb modules correctly", () => {
    expect(AdbClient).toBeDefined();
    expect(IndexedDbKeyStore).toBeDefined();
    expect(WebUsbTransport).toBeDefined();
  });
});
