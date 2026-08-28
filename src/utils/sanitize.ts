/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escapes a string argument for safe execution in a POSIX/Android shell command.
 * Encloses the argument in single quotes and escapes existing single quotes.
 *
 * @param arg The raw argument string to escape.
 * @returns Shell-safe quoted string.
 */
export function escapeShellArg(arg: string): string {
  if (arg === '') {
    return "''";
  }
  // Replace single quotes: ' -> '\''
  // and wrap the entire string in single quotes.
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validates and serializes a JSON input, returning a shell-escaped string
 * suitable for CLI arguments (e.g. `--parameters '<JSON>'`).
 *
 * @param input Either an object or an already-encoded JSON string.
 * @returns Shell-safe escaped JSON string.
 */
export function sanitizeJsonForShell(input: unknown): string {
  let jsonString: string;
  if (typeof input === 'string') {
    // Validate that it's valid JSON
    try {
      const parsed = JSON.parse(input);
      jsonString = JSON.stringify(parsed);
    } catch {
      // If it fails to parse as JSON, treat as raw string and serialize
      jsonString = JSON.stringify(input);
    }
  } else {
    jsonString = JSON.stringify(input ?? {});
  }

  return escapeShellArg(jsonString);
}
