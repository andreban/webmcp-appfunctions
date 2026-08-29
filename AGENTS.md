<!--
  Copyright 2026 Andre Cipriani Bandarra
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
- **Strict Rule:** **ALL source code files** (`.ts`, `.js`, `.css`, `.html`, etc.) **MUST** include the clean short-form SPDX header at the top of the file:

```typescript
/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */
```

For HTML and Markdown files:
```html
<!--
  Copyright 2026 Andre Cipriani Bandarra
  SPDX-License-Identifier: Apache-2.0
-->
```

### 2.2 WebMCP Standards & Types
- **API Target:** WebMCP Imperative API (`document.modelContext`).
- **Strict Rule:** Do NOT use `navigator.modelContext`. WebMCP is attached to the DOM `Document` (`document.modelContext`).
- **Official Types:** Use ONLY the official [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) package from the W3C Web Machine Learning Working Group. Do NOT use `@mcp-b/webmcp-types`.
- **NO Polyfills:** Do NOT create, install, or maintain polyfills or fallback shims for environments without WebMCP. Native `document.modelContext` support in the browser is a strict requirement.

### 2.3 Tech Stack Constraints
- **Framework:** Vanilla TypeScript with Vite (no React, Vue, Angular, or heavy UI frameworks).
- **Styling:** Modern CSS (CSS custom properties, Grid, Flexbox, developer aesthetic).
- **Transport:** Vendored TypeScript `wadb` in `src/transport/wadb/` over `navigator.usb` (WebUSB).
- **Issue Scoping:** When implementing GitHub issues, strictly scope changes to the specific tasks listed in the issue description. Do not scaffold or implement components designated for future milestones.

### 2.4 Android ADB Shell Interface
The application exclusively uses the official Android 16 (API 36+) `cmd app_function` commands:
- **Discovery:** `adb shell cmd app_function list-app-functions [--package <pkg>]` (returns JSON schema).
- **Execution:** `adb shell cmd app_function execute-app-function --package <pkg> --function <funcId> --parameters '<json>'` (returns JSON result).
- **State:** `adb shell cmd app_function set-enabled --package <pkg> --function <funcId> --state <enable|disable|default>`.
- **Security:** All parameters must be JSON-serialized and shell-sanitized before execution to prevent command injection.

### 2.5 TypeScript Style & Member Naming
- **Private Variables & Fields:** Do NOT prefix private fields or variables with an underscore (`_`). Use TypeScript's `private` access modifier directly (e.g., `private state:` rather than `private _state:`).

### 2.6 Responsive Layout & UI Design
- **Universal Responsiveness:** All UI components, headers, panels, toolbars, and modal/drawer views **MUST** be responsive and fully functional across desktop (>=1024px), tablet (768px–1023px), and mobile (<768px) viewports.
- **No Overflow or Collisions:** UI elements must not overlap, crowd, or cause unintentional horizontal scrolling on narrow screens.
- **Responsive CSS Conventions:**
  - Use `flex-wrap: wrap` and fluid sizing (`min-width: 0`, `max-width: 100%`) on multi-item flex containers.
  - Stack multi-column grids or side-by-side split panels vertically on smaller viewports using `@media` breakpoints.
  - Ensure interactive buttons, pills, and badges wrap cleanly, maintain touch-friendly targets, and preserve text legibility.

### 2.7 Git & Pull Request Workflow
- **Always Use Dedicated Branches:** The agent **MUST NEVER** commit directly to the `main` branch. All features, tasks, and fixes must be developed on a dedicated branch following naming conventions (`feat/<name>`, `fix/<name>`).
- **No Commits Without Explicit Confirmation:** The agent **MUST NEVER** execute `git commit` without first presenting the code changes/diff to the user and receiving explicit approval.
- **Push & Open Pull Requests:** After committing approved changes to the dedicated branch, push the branch to remote (`git push -u origin <branch>`) and open a Pull Request using `gh pr create` referencing the relevant issue.
- **NEVER Merge Pull Requests:** When creating a Pull Request via `gh pr create`, the agent **MUST NEVER** merge it (`gh pr merge`). Pull requests must always remain open for human review and manual merge.

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

- [ ] Changes are made on a dedicated branch (`feat/*` or `fix/*`), never directly on `main`.
- [ ] All new/modified source files include the standard Apache-2.0 SPDX header.
- [ ] Code strictly targets native `document.modelContext` (no polyfill fallbacks).
- [ ] All types reference the official `webmcp-types` package.
- [ ] No unnecessary third-party UI framework dependencies added.
- [ ] Shell parameter inputs are safely escaped and JSON-encoded.
- [ ] No private variables or fields prefixed with underscore (`_`).
- [ ] Build (`npm run build`) and tests pass without errors or type warnings.
- [ ] All UI components are responsive without element collisions, clipped controls, or horizontal overflow on smaller screens.
- [ ] Explicit user approval has been received prior to running `git commit`.
- [ ] Pull request created via `gh pr create` and left open for human review.
- [ ] No Pull Request has been or will be merged automatically by the agent.

