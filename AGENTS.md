<!--
  Copyright 2026 Andre Cipriani Bandarra

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  SPDX-License-Identifier: Apache-2.0
-->

# AGENTS.md — Guidelines for AI Agents Working on `webmcp-appfunctions`

This document outlines key technical decisions, strict conventions, and architectural context for any AI coding agent working on this repository.

---

## 1. Project Overview & Objective

`webmcp-appfunctions` is a client-side web application built with **Vanilla TypeScript** and **Vite** that bridges on-device **Android AppFunctions** to browser-based **WebMCP** (`document.modelContext`) over **WebUSB** using **`wadb`**.

### The Core Loop
1. Connect to an Android 16+ (API 36+) device over WebUSB via `wadb`.
2. Discover registered AppFunctions on the device using `cmd app_function list-app-functions`.
3. Translate and register these functions as WebMCP tools on `document.modelContext.registerTool(tool, { signal })`.
4. When a WebMCP agent calls a tool, execute `cmd app_function execute-app-function --package <pkg> --function <funcId> --parameters '<json>'` via ADB shell over WebUSB and return structured JSON results.

---

## 2. Critical Rules & Non-Negotiables

### 2.1 License & SPDX Headers
- **Project License:** Apache License 2.0 (`LICENSE`).
- **Strict Rule:** **ALL source code files** (`.ts`, `.js`, `.css`, `.html`, `.svg`, etc.) **MUST** include the standard Apache-2.0 SPDX license header at the top of the file:

```typescript
/**
 * Copyright 2026 Andre Cipriani Bandarra
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
```

### 2.2 WebMCP Standards & Types
- **API Target:** WebMCP Imperative API (`document.modelContext`).
- **Strict Rule:** Do NOT use `navigator.modelContext`. WebMCP is attached to the DOM `Document` (`document.modelContext`).
- **Official Types:** Use ONLY the official [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) package from the W3C Web Machine Learning Working Group. Do NOT use `@mcp-b/webmcp-types`.
- **NO Polyfills:** Do NOT create, install, or maintain polyfills or fallback shims for environments without WebMCP. Native `document.modelContext` support in the browser is a strict requirement.

### 2.3 Tech Stack Constraints
- **Framework:** Vanilla TypeScript with Vite (no React, Vue, Angular, or heavy UI frameworks).
- **Styling:** Modern CSS (CSS custom properties, Grid, Flexbox, developer aesthetic).
- **Transport:** `@googlechromelabs/wadb` or bundled TypeScript `wadb` over `navigator.usb` (WebUSB).

### 2.4 Android ADB Shell Interface
The application exclusively uses the official Android 16 (API 36+) `cmd app_function` commands:
- **Discovery:** `adb shell cmd app_function list-app-functions [--package <pkg>]` (returns JSON schema).
- **Execution:** `adb shell cmd app_function execute-app-function --package <pkg> --function <funcId> --parameters '<json>'` (returns JSON result).
- **State:** `adb shell cmd app_function set-enabled --package <pkg> --function <funcId> --state <enable|disable|default>`.
- **Security:** All parameters must be JSON-serialized and shell-sanitized before execution to prevent command injection.

---

## 3. Repository Architecture

```
webmcp-appfunctions/
├── LICENSE                         # Apache-2.0
├── AGENTS.md                       # Agent guidelines & project memory
├── PRD.md                          # Detailed product requirements
├── package.json                    # Dependencies (webmcp-types, vite, typescript, etc.)
├── tsconfig.json                   # Types configured with webmcp-types and w3c-web-usb
├── vite.config.ts
├── index.html                      # Single-page web app entry
├── src/
│   ├── main.ts                     # Entry point & app bootstrap
│   ├── styles/
│   │   └── main.css                # Modern clean CSS
│   ├── types/
│   │   ├── adb.ts                  # ADB / wadb connection types
│   │   └── appfunctions.ts         # Android AppFunctions JSON schemas
│   ├── transport/
│   │   ├── adb-client.ts           # wadb wrapper over WebUSB
│   │   ├── auth-keys.ts            # Persistent RSA keypair generation in browser
│   │   └── shell.ts                # Command formatting & stream execution
│   ├── android/
│   │   ├── discovery.ts            # Runs & parses 'cmd app_function list-app-functions'
│   │   ├── executor.ts             # Runs 'cmd app_function execute-app-function'
│   │   └── parser.ts               # JSON schema & payload parser
│   ├── webmcp/
│   │   ├── bridge.ts               # Registers tools onto native document.modelContext
│   │   └── schema-mapper.ts        # Maps Android types to WebMCP JSON Schema
│   ├── ui/
│   │   ├── connection-bar.ts       # USB connect button & device status
│   │   ├── catalog-view.ts         # Discovered functions list & search
│   │   ├── tester-view.ts          # Dynamic parameter input form & manual tester
│   │   └── log-drawer.ts           # Real-time streaming log component
│   └── utils/
│       ├── logger.ts               # Central event emitter & log collector
│       └── sanitize.ts             # Shell parameter escaping
└── tests/
    ├── discovery.test.ts
    ├── schema-mapper.test.ts
    └── executor.test.ts
```

---

## 4. Development & Build Commands

- `npm install` — Install dependencies (`webmcp-types`, `@types/w3c-web-usb`, `vite`, `typescript`).
- `npm run dev` — Start Vite local development server with HMR.
- `npm run build` — Type-check with `tsc` and produce static production bundle in `dist/`.
- `npm run preview` — Preview the built production bundle locally.
- `npm test` — Run unit tests.

---

## 5. Summary Checklist Before Committing Changes

- [ ] All new/modified source files include the standard Apache-2.0 SPDX header.
- [ ] Code strictly targets native `document.modelContext` (no polyfill fallbacks).
- [ ] All types reference the official `webmcp-types` package.
- [ ] No unnecessary third-party UI framework dependencies added.
- [ ] Shell parameter inputs are safely escaped and JSON-encoded.
- [ ] Build (`npm run build`) and tests pass without errors or type warnings.
