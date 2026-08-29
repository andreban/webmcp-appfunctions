/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BrowserKeyStore,
  generateRsaKeyPair,
  exportPublicKeyBase64,
  exportPublicKeyAdb,
} from '../src/transport/auth-keys';

describe('Browser RSA Authentication Keys', () => {
  let keyStore: BrowserKeyStore;

  beforeEach(() => {
    keyStore = new BrowserKeyStore();
  });

  it('generates valid RSASSA-PKCS1-v1_5 RSA keypair', async () => {
    const keyPair = await generateRsaKeyPair(2048);
    expect(keyPair).toBeDefined();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
    expect(keyPair.privateKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
    expect(keyPair.publicKey.extractable).toBe(true);
  });

  it('exports public key to base64 and ADB formatted banner', async () => {
    const keyPair = await generateRsaKeyPair(2048);
    const b64 = await exportPublicKeyBase64(keyPair.publicKey);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(50);

    const adbKey = await exportPublicKeyAdb(keyPair.publicKey, 'test@host');
    expect(adbKey).toBe(`${b64} test@host`);
  });

  it('saves and loads keys from keyStore', async () => {
    const initialKeys = await keyStore.loadKeys();
    expect(initialKeys.length).toBe(0);

    const keyPair = await generateRsaKeyPair(2048);
    await keyStore.saveKey(keyPair);

    const loadedKeys = await keyStore.loadKeys();
    expect(loadedKeys.length).toBe(1);
    expect(loadedKeys[0].publicKey).toBeDefined();
    expect(loadedKeys[0].privateKey).toBeDefined();
  });

  it('clears stored keys', async () => {
    const keyPair = await generateRsaKeyPair(2048);
    await keyStore.saveKey(keyPair);
    expect((await keyStore.loadKeys()).length).toBe(1);

    await keyStore.clearKeys();
    expect((await keyStore.loadKeys()).length).toBe(0);
  });

  it('getOrCreateKey returns existing key if present or creates new one', async () => {
    const key1 = await keyStore.getOrCreateKey();
    expect(key1).toBeDefined();

    const key2 = await keyStore.getOrCreateKey();
    expect(key2).toBeDefined();
    expect(key2.publicKey).toBe(key1.publicKey);
  });

  it('fires onAuthChallenge callback during loadKeys and saveKey', async () => {
    let challenges = 0;
    keyStore.onAuthChallenge = () => {
      challenges++;
    };

    await keyStore.loadKeys();
    expect(challenges).toBe(1);

    const key = await generateRsaKeyPair(2048);
    await keyStore.saveKey(key);
    expect(challenges).toBe(2);
  });

  it('AdbClient.generateKey produces extractable keypairs', async () => {
    const { AdbClient } = await import('../src/transport/wadb/lib/AdbClient');
    const keyPair = await AdbClient.generateKey(false, 2048);
    expect(keyPair).toBeDefined();
    expect(keyPair.publicKey.extractable).toBe(true);
    expect(keyPair.privateKey.extractable).toBe(true);
  });

  it('safely handles non-extractable keys in BrowserKeyStore without throwing InvalidAccessError', async () => {
    const nonExtractableKey = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: { name: 'SHA-1' },
      },
      false,
      ['sign', 'verify']
    );

    expect(nonExtractableKey.privateKey.extractable).toBe(false);
    await expect(keyStore.saveKey(nonExtractableKey)).resolves.not.toThrow();
    const loaded = await keyStore.loadKeys();
    expect(loaded.length).toBe(1);
  });
});
