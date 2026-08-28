/**
 * Copyright 2026 Andre Cipriani Bandarra
 * SPDX-License-Identifier: Apache-2.0
 */

import { KeyStore } from './wadb/lib/KeyStore';
import { logger } from '../utils/logger';

const DB_NAME = 'wadb';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const LOCAL_STORAGE_KEY = 'webmcp_wadb_rsa_keys';
const DEFAULT_KEY_SIZE = 2048;

interface SerializedJwkKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/**
 * Checks if IndexedDB is supported and accessible in the current environment.
 */
function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Checks if localStorage is supported and accessible in the current environment.
 */
function isLocalStorageAvailable(): boolean {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return false;
    }
    const testKey = '__wadb_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generates an RSA keypair matching standard ADB authentication requirements
 * (RSASSA-PKCS1-v1_5 with SHA-1, 2048-bit modulus).
 */
export async function generateRsaKeyPair(keySize = DEFAULT_KEY_SIZE): Promise<CryptoKeyPair> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Cryptography API (crypto.subtle) is not available in this environment.');
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: keySize,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: { name: 'SHA-1' },
    },
    true,
    ['sign', 'verify']
  );

  return keyPair;
}

/**
 * Exports a public key to Base64-encoded SPKI string.
 */
export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  const bytes = new Uint8Array(spki);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Exports a public key in ADB formatted format with host banner.
 */
export async function exportPublicKeyAdb(
  publicKey: CryptoKey,
  hostBanner = 'webmcp@browser'
): Promise<string> {
  const b64 = await exportPublicKeyBase64(publicKey);
  return `${b64} ${hostBanner}`;
}

/**
 * Browser-side persistent KeyStore for ADB RSA keys.
 * Prioritizes IndexedDB, falling back to localStorage and in-memory cache.
 */
export class BrowserKeyStore implements KeyStore {
  private inMemoryKeys: CryptoKeyPair[] = [];
  public onAuthChallenge?: () => void;

  /**
   * Loads all stored RSA keypairs.
   */
  async loadKeys(): Promise<CryptoKeyPair[]> {
    this.onAuthChallenge?.();

    // 1. Try IndexedDB
    if (isIndexedDbAvailable()) {
      try {
        const db = await openIndexedDb();
        const keys = await new Promise<CryptoKeyPair[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const request = tx.objectStore(STORE_NAME).getAll();
          request.onsuccess = () => resolve(request.result as CryptoKeyPair[]);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        });

        if (keys && keys.length > 0) {
          logger.debug('ADB', `Loaded ${keys.length} RSA key(s) from IndexedDB`);
          return keys;
        }
      } catch (err) {
        logger.warn('ADB', 'IndexedDB key retrieval failed, trying localStorage fallback', err);
      }
    }

    // 2. Try localStorage fallback
    if (isLocalStorageAvailable()) {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const serializedList: SerializedJwkKeyPair[] = JSON.parse(raw);
          const importedKeys: CryptoKeyPair[] = [];

          for (const item of serializedList) {
            const publicKey = await crypto.subtle.importKey(
              'jwk',
              item.publicKey,
              { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-1' } },
              true,
              ['verify']
            );
            const privateKey = await crypto.subtle.importKey(
              'jwk',
              item.privateKey,
              { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-1' } },
              true,
              ['sign']
            );
            importedKeys.push({ publicKey, privateKey });
          }

          if (importedKeys.length > 0) {
            logger.debug('ADB', `Loaded ${importedKeys.length} RSA key(s) from localStorage`);
            return importedKeys;
          }
        }
      } catch (err) {
        logger.warn('ADB', 'localStorage key retrieval failed, using in-memory keys', err);
      }
    }

    // 3. In-memory fallback
    logger.debug('ADB', `Returning ${this.inMemoryKeys.length} in-memory RSA key(s)`);
    return [...this.inMemoryKeys];
  }

  /**
   * Saves a new RSA keypair to persistent storage.
   */
  async saveKey(key: CryptoKeyPair): Promise<void> {
    this.onAuthChallenge?.();
    this.inMemoryKeys.push(key);

    let saved = false;

    // 1. Try IndexedDB
    if (isIndexedDbAvailable()) {
      try {
        const db = await openIndexedDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const request = tx.objectStore(STORE_NAME).add(key);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        });
        saved = true;
        logger.info('ADB', 'Saved RSA keypair to IndexedDB');
      } catch (err) {
        logger.warn('ADB', 'IndexedDB key save failed, falling back to localStorage', err);
      }
    }

    // 2. Try localStorage fallback or mirror
    if (isLocalStorageAvailable()) {
      try {
        const pubJwk = await crypto.subtle.exportKey('jwk', key.publicKey);
        const privJwk = await crypto.subtle.exportKey('jwk', key.privateKey);

        const existingRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
        const list: SerializedJwkKeyPair[] = existingRaw ? JSON.parse(existingRaw) : [];
        list.push({ publicKey: pubJwk, privateKey: privJwk });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
        saved = true;
        logger.info('ADB', 'Saved RSA keypair to localStorage');
      } catch (err) {
        logger.warn('ADB', 'localStorage key save failed', err);
      }
    }

    if (!saved) {
      logger.info('ADB', 'Persisted RSA keypair in memory');
    }
  }

  /**
   * Clears all stored RSA keys across IndexedDB, localStorage, and in-memory cache.
   */
  async clearKeys(): Promise<void> {
    this.inMemoryKeys = [];

    if (isIndexedDbAvailable()) {
      try {
        const db = await openIndexedDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const request = tx.objectStore(STORE_NAME).clear();
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        });
      } catch (err) {
        logger.warn('ADB', 'Failed to clear IndexedDB keys', err);
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch (err) {
        logger.warn('ADB', 'Failed to clear localStorage keys', err);
      }
    }

    logger.info('ADB', 'Cleared all stored RSA authentication keys');
  }

  /**
   * Returns an existing keypair, or generates and saves a new one if none exist.
   */
  async getOrCreateKey(keySize = DEFAULT_KEY_SIZE): Promise<CryptoKeyPair> {
    const keys = await this.loadKeys();
    if (keys.length > 0) {
      return keys[0];
    }
    const newKey = await generateRsaKeyPair(keySize);
    await this.saveKey(newKey);
    return newKey;
  }
}
