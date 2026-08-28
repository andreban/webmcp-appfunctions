/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { escapeShellArg, sanitizeJsonForShell } from '../src/utils/sanitize';

describe('Shell Sanitization Utilities', () => {
  describe('escapeShellArg', () => {
    it('handles empty strings', () => {
      expect(escapeShellArg('')).toBe("''");
    });

    it('wraps regular alphanumeric strings in single quotes', () => {
      expect(escapeShellArg('hello')).toBe("'hello'");
      expect(escapeShellArg('package.name.123')).toBe("'package.name.123'");
    });

    it('escapes embedded single quotes safely', () => {
      expect(escapeShellArg("it's a test")).toBe("'it'\\''s a test'");
      expect(escapeShellArg("'quoted'")).toBe("''\\''quoted'\\'''");
    });

    it('neutralizes shell control operators, pipes, semicolons, and subshells', () => {
      const malicious = '$(rm -rf /) ; echo "hacked" | cat && `whoami`';
      const escaped = escapeShellArg(malicious);
      expect(escaped).toBe("'$(rm -rf /) ; echo \"hacked\" | cat && `whoami`'");
      expect(escaped.startsWith("'")).toBe(true);
      expect(escaped.endsWith("'")).toBe(true);
    });

    it('handles newlines and special characters', () => {
      expect(escapeShellArg('line1\nline2\tline3')).toBe("'line1\nline2\tline3'");
    });
  });

  describe('sanitizeJsonForShell', () => {
    it('serializes simple JSON object and escapes for shell', () => {
      const obj = { key: 'value', number: 42, active: true };
      const result = sanitizeJsonForShell(obj);
      expect(result).toBe('\'{"key":"value","number":42,"active":true}\'');
    });

    it('serializes nested objects and arrays with special chars', () => {
      const obj = {
        title: "Doctor's Note",
        tags: ['health', 'urgent'],
        nested: { count: 3 },
      };
      const result = sanitizeJsonForShell(obj);
      expect(result).toContain("'\\''");
    });

    it('validates already-serialized JSON strings', () => {
      const jsonStr = '{"message":"hello world"}';
      const result = sanitizeJsonForShell(jsonStr);
      expect(result).toBe('\'{"message":"hello world"}\'');
    });

    it('handles non-JSON raw strings gracefully by JSON-encoding them', () => {
      const rawStr = 'plain text input';
      const result = sanitizeJsonForShell(rawStr);
      expect(result).toBe('\'"plain text input"\'');
    });

    it('handles null and undefined', () => {
      expect(sanitizeJsonForShell(null)).toBe("'{}'");
      expect(sanitizeJsonForShell(undefined)).toBe("'{}'");
    });
  });
});
