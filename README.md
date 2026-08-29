<!--
  Copyright 2026 Andre Cipriani Bandarra
  SPDX-License-Identifier: Apache-2.0
-->

# WebMCP ↔ Android AppFunctions Bridge

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite)](https://vitejs.dev/)
[![WebMCP](https://img.shields.io/badge/WebMCP-document.modelContext-brightgreen)](https://www.npmjs.com/package/webmcp-types)
[![Android](https://img.shields.io/badge/Android-16%2B%20(API%2036%2B)-green?logo=android)](https://developer.android.com/)
[![WebUSB](https://img.shields.io/badge/WebUSB-wadb-orange)](https://wicg.github.io/webusb/)

A lightweight, zero-install, client-side web application that bridges native on-device **Android AppFunctions** (introduced in Android 16 / API 36+) to browser-based **WebMCP** (`document.modelContext`) over **WebUSB** using **`wadb`**.

---

## 🌟 Overview

Modern AI agents and browser-based assistants are traditionally confined to the web sandbox, unable to directly interact with native applications and device capabilities on a connected smartphone. 

`webmcp-appfunctions` solves this by creating a direct, zero-install hardware bridge between **WebMCP** and **Android 16+ AppFunctions**:

1. **Connect:** Pairs directly with an Android device over WebUSB via `wadb` without requiring a local ADB daemon or native CLI setup.
2. **Discover:** Queries the device for registered AppFunctions using `cmd app_function list-app-functions` and parses their JSON schemas.
3. **Register:** Translates and registers discovered Android capabilities as native WebMCP tools directly onto `document.modelContext.registerTool()` using official [`webmcp-types`](https://www.npmjs.com/package/webmcp-types).
4. **Execute:** Dispatches tool calls initiated by in-browser AI agents (or manual testing) down through WebUSB to execute `cmd app_function execute-app-function`, returning structured JSON responses in real time.

```
┌──────────────────────────────────────────────────────────┐
│ Chromium Browser (WebMCP Native)                         │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │ AI Agent / LLM Client                            │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ Tool Execution                │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ document.modelContext (WebMCP Native API)        │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ Tool Registration / Invocation│
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ WebMcpBridge & Schema Mapper                     │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ Shell Commands                │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ wadb Transport Layer (WebUSB)                    │   │
│   └──────────────────────┬───────────────────────────┘   │
└──────────────────────────┼───────────────────────────────┘
                           │ USB Cable (WebUSB)
┌──────────────────────────┼───────────────────────────────┐
│ Android 16+ Device       ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ adbd (ADB Daemon)                                │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ cmd app_function              │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ AppFunctionManagerService                        │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ Invocation                    │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │ Installed Apps (@AppFunction)                    │   │
│   └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## ✨ Features

- **🔌 Zero-Install WebUSB Transport:** Connects to physical Android devices and emulators directly from the browser using WebUSB. Features in-browser RSA keypair generation (`WebCrypto` + `IndexedDB`) for persistent ADB authentication.
- **🔍 Automated AppFunctions Discovery:** Automatically introspects all installed Android applications exposing `@AppFunction` capabilities and translates their parameters, types, and KDoc descriptions into JSON Schema.
- **🛠️ Native WebMCP Integration:** Strictly typed against official W3C [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) and registered directly on `document.modelContext`. Supports real-time `toolchange` notifications.
- **⚡ Lifecycle Management & Abort Signals:** Manages tool lifecycles with `AbortController`. Tools are automatically unregistered when the Android device is disconnected.
- **🧪 Interactive Function Tester:** Dynamic form UI generated from function schemas allowing developers to manually inspect schemas, configure arguments, execute functions, and view return payloads and execution latency.
- **📊 Real-time Log Drawer & Telemetry:** Built-in console showing WebUSB connection events, raw ADB shell commands, and WebMCP tool registrations.
- **🛡️ Secure Command Execution:** Robust argument serialization and POSIX shell escaping to prevent command injection.
- **📱 Fully Responsive UI:** Clean developer aesthetic optimized across desktop, tablet, and mobile viewports with zero third-party UI framework dependencies.

---

## 📋 System Requirements & Prerequisites

### 1. Browser
- A Chromium-based browser supporting **WebUSB** (Chrome, Edge, Brave, Chromium 130+).
- Experimental / Native **WebMCP** support (`document.modelContext`).

### 2. Android Device
- Physical device or emulator running **Android 16+ (API level 36+)**.
- **Developer Options** enabled:
  - **USB Debugging** toggled ON.
- Applications installed that expose AppFunctions via AndroidX / Jetpack AppFunctions libraries.

### 3. Connection
- Standard USB-C or USB-A data cable.

---

## 🚀 Quick Start

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/andreban/webmcp-appfunctions.git
cd webmcp-appfunctions
npm install
```

### Development Server

Start the local Vite development server with Hot Module Replacement (HMR):

```bash
npm run dev
```

Open the printed URL (typically `http://localhost:5173`) in a supported Chromium browser.

### Production Build & Preview

Type-check and generate optimized static assets:

```bash
npm run build
npm run preview
```

### Running Tests

Execute unit tests with Vitest:

```bash
npm test
```

---

## 📖 How It Works

### 1. Connecting over WebUSB
Click **"Connect Android Device"** in the top navigation bar. The browser prompts you to select your connected USB device. Once selected, `AdbManager` initiates the ADB handshake, exchanges RSA authentication keys, and prompts you to accept USB debugging on your Android screen.

### 2. Discovering Registered AppFunctions
Upon connection, the app executes the Android 16 CLI discovery command:
```bash
cmd app_function list-app-functions
```
The raw JSON schema returned by the device is parsed into structured TypeScript definitions containing package names, function identifiers, argument parameters, and return signatures.

### 3. WebMCP Tool Registration
For each discovered function, `WebMcpBridge` maps the Android metadata to a WebMCP `ModelContextTool` object and registers it on `document.modelContext`:

```typescript
import { mapAppFunctionToWebMcpTool } from './webmcp/schema-mapper';

const tool = mapAppFunctionToWebMcpTool(appFunctionDef, async (params, { signal }) => {
  return await executor.execute(appFunctionDef, params, { signal });
});

const abortController = new AbortController();
document.modelContext.registerTool(tool, { signal: abortController.signal });
```

### 4. Tool Invocation
When an AI agent (or the manual tester) invokes a tool, the bridge sanitizes the parameters and runs:
```bash
cmd app_function execute-app-function \
  --package <package_name> \
  --function <function_id> \
  --parameters '<escaped_json_string>'
```
The JSON response payload is parsed and returned directly to the agent.

---

## 🏗️ Project Structure

```
webmcp-appfunctions/
├── LICENSE                         # Apache-2.0 License
├── AGENTS.md                       # Coding guidelines & architecture decisions
├── PRD.md                          # Detailed product requirements document
├── package.json                    # Dependencies & scripts
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite build & test configuration
├── index.html                      # Single-page application entry point
├── src/
│   ├── main.ts                     # App bootstrap & module initialization
│   ├── styles/
│   │   └── main.css                # Modern responsive CSS design system
│   ├── types/
│   │   ├── adb.ts                  # ADB connection & transport types
│   │   └── appfunctions.ts         # Android AppFunctions JSON schemas & contracts
│   ├── transport/
│   │   ├── adb-client.ts           # AdbManager & connection lifecycle handler
│   │   ├── auth-keys.ts            # WebCrypto RSA keypair generator & IndexedDB store
│   │   ├── shell.ts                # Command formatting & execution queue
│   │   └── wadb/                   # Vendored WebUSB ADB implementation
│   ├── android/
│   │   ├── discovery.ts            # Discovers & parses 'cmd app_function list-app-functions'
│   │   ├── executor.ts             # Executes 'cmd app_function execute-app-function'
│   │   └── parser.ts               # JSON schema & response payload parser
│   ├── webmcp/
│   │   ├── bridge.ts               # Registers tools onto native document.modelContext
│   │   └── schema-mapper.ts        # Maps Android schemas to WebMCP JSON Schema
│   ├── ui/
│   │   ├── connection-bar.ts       # USB connection management & device status
│   │   ├── catalog-view.ts         # Discovered functions list, search & filters
│   │   └── tester-view.ts          # Parameter form generator & execution tester
│   └── utils/
│       ├── logger.ts               # Central logging & event emitter
│       └── sanitize.ts             # Shell argument escaping & JSON sanitization
└── tests/                          # Comprehensive Vitest test suite
    ├── auth-keys.test.ts
    ├── bridge.test.ts
    ├── catalog-view.test.ts
    ├── connection-bar.test.ts
    ├── discovery.test.ts
    ├── executor.test.ts
    ├── parser.test.ts
    ├── schema-mapper.test.ts
    ├── tester-view.test.ts
    └── transport.test.ts
```

---

## 🛠️ Android CLI Commands Reference

`webmcp-appfunctions` interacts with the Android OS via the following built-in commands:

| Action | Command |
| :--- | :--- |
| **List Functions** | `cmd app_function list-app-functions [--package <pkg>]` |
| **Execute Function** | `cmd app_function execute-app-function --package <pkg> --function <id> --parameters '<json>'` |
| **Set State** | `cmd app_function set-enabled --package <pkg> --function <id> --state <enable\|disable\|default>` |

---

## 🤝 Contributing

Contributions are welcome! Please ensure all pull requests adhere to the project standards:

- **License Headers:** All new files must contain the Apache-2.0 SPDX header.
- **WebMCP Standards:** Target native `document.modelContext` with `webmcp-types` (no fallback polyfills).
- **TypeScript Conventions:** No private field underscore prefixes (`_`).
- **Tests & Builds:** Run `npm test` and `npm run build` to verify changes before submitting.

---

## 📄 License

Distributed under the Apache 2.0 License. See [`LICENSE`](LICENSE) for more information.
