/**
 * PharmaCore – Keystore
 *
 * Implements "envelope encryption": a single random 32-byte masterKey
 * encrypts the database.  Each authorised user gets their own encrypted
 * copy of that masterKey, wrapped with a key derived from THEIR password
 * via scrypt.
 *
 * This means any user who knows their own password can independently unlock
 * the same shared database, with no single-user dependency.
 *
 * File: <userData>/keystore.json (plaintext JSON — safe because the
 *       per-user blobs inside it are AES-256-GCM encrypted)
 *
 * Keystore schema:
 * {
 *   "version": 1,
 *   "entries": [
 *     {
 *       "userId":       "uuid",
 *       "username":     "admin",
 *       "role":         "admin" | "pharmacist",
 *       "kdfSalt":      "hex(32 bytes)",   ← scrypt salt, unique per user
 *       "iv":           "hex(12 bytes)",   ← AES-GCM IV for this entry
 *       "tag":          "hex(16 bytes)",   ← AES-GCM auth tag
 *       "encryptedKey": "hex(32 bytes)"    ← AES-GCM( masterKey, userDerivedKey )
 *     }
 *   ]
 * }
 */

import path   from 'path';
import fs     from 'fs';
import crypto from 'crypto';
import { getDataDir } from './paths.js';

// ─── Crypto constants (must match auth.js) ────────────────────────────────────

const ALGORITHM       = 'aes-256-gcm';
const KEY_LENGTH      = 32;    // 256-bit AES key
const IV_LENGTH       = 12;    // 96-bit IV
const AUTH_TAG_LENGTH = 16;    // 128-bit GCM auth tag
const SCRYPT_SALT_LEN = 32;    // bytes — per-user KDF salt
const SCRYPT_N        = 16384; // cost factor (2^14) — ~100 ms on modern hardware
const SCRYPT_R        = 8;
const SCRYPT_P        = 1;

// ─── Path ─────────────────────────────────────────────────────────────────────

function getKeystorePath() {
  return path.join(getDataDir(), 'keystore.json');
}

// ─── Keystore I/O ─────────────────────────────────────────────────────────────

function loadKeystore() {
  const p = getKeystorePath();
  if (!fs.existsSync(p)) return { version: 1, entries: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveKeystore(ks) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(getKeystorePath(), JSON.stringify(ks, null, 2), 'utf8');
}

// ─── KDF ──────────────────────────────────────────────────────────────────────

/**
 * Derives a 256-bit key from a plaintext password + salt using scrypt.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Promise<Buffer>}
 */
export function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password, salt, KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

// ─── AES-GCM helpers ──────────────────────────────────────────────────────────

function encryptBuffer(plainBuf, key) {
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ct     = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ct: ct.toString('hex') };
}

function decryptBuffer(ivHex, tagHex, ctHex, key) {
  const dec = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), { authTagLength: AUTH_TAG_LENGTH });
  dec.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([dec.update(Buffer.from(ctHex, 'hex')), dec.final()]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the keystore has zero user entries (first-ever launch).
 */
export function hasUsers() {
  return loadKeystore().entries.length > 0;
}

/**
 * Returns the list of known usernames (for the login UI drop-down / hint).
 *
 * @returns {string[]}
 */
export function listUsernames() {
  return loadKeystore().entries.map(e => e.username);
}

/**
 * Adds a new user to the keystore, storing an AES-GCM-encrypted copy of
 * the masterKey wrapped with a key derived from their password.
 *
 * @param {object}  opts
 * @param {string}  opts.userId      UUID
 * @param {string}  opts.username
 * @param {string}  opts.password    Plaintext — used only during this call
 * @param {string}  opts.role        'admin' | 'pharmacist'
 * @param {Buffer}  opts.masterKey   The shared 32-byte database key
 * @param {string}  [opts.createdAt] ISO timestamp — defaults to now
 * @returns {Promise<void>}
 */
export async function addUserToKeystore({ userId, username, name, password, role, masterKey, createdAt }) {
  const ks = loadKeystore();

  const kdfSalt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const userKey = await deriveKey(password, kdfSalt);
  const { iv, tag, ct } = encryptBuffer(masterKey, userKey);

  ks.entries.push({
    userId,
    username,
    name: name || username,
    role,
    createdAt: createdAt || new Date().toISOString(),
    kdfSalt:      kdfSalt.toString('hex'),
    iv,
    tag,
    encryptedKey: ct,
  });

  saveKeystore(ks);
}

/**
 * Returns the raw keystore entries array (for use in auth.js / api.js
 * when we need createdAt or other fields).
 *
 * @returns {Array<{ userId, username, role, createdAt?, kdfSalt, iv, tag, encryptedKey }>}
 */
export function getKeystoreEntries() {
  return loadKeystore().entries;
}

/**
 * Updates a user's username in the keystore, looked up by userId.
 *
 * @param {string} userId
 * @param {string} newUsername
 * @returns {boolean}  true if a matching entry was found & updated
 */
export function updateUsernameInKeystore(userId, newUsername, newName) {
  const ks = loadKeystore();
  const entry = ks.entries.find(e => e.userId === userId);
  if (!entry) return false;
  entry.username = newUsername;
  if (newName) entry.name = newName;
  saveKeystore(ks);
  return true;
}

/**
 * Resets a user's password in the keystore: re-derives a wrapping key
 * from the new password and re-encrypts the masterKey with it.
 *
 * The caller must have already decrypted the masterKey via an admin
 * session (we don't accept the old password — admins can reset without
 * knowing the previous password).
 *
 * @param {string} userId
 * @param {string} newPassword
 * @param {Buffer} masterKey
 * @returns {Promise<boolean>}  true if a matching entry was found & updated
 */
export async function resetUserPasswordInKeystore(userId, newPassword, masterKey) {
  const ks = loadKeystore();
  const entry = ks.entries.find(e => e.userId === userId);
  if (!entry) return false;

  const kdfSalt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const userKey = await deriveKey(newPassword, kdfSalt);
  const { iv, tag, ct } = encryptBuffer(masterKey, userKey);

  entry.kdfSalt = kdfSalt.toString('hex');
  entry.iv      = iv;
  entry.tag     = tag;
  entry.encryptedKey = ct;

  saveKeystore(ks);
  return true;
}

/**
 * Attempts to decrypt the masterKey for the given username using the
 * supplied password.
 *
 * Returns the 32-byte masterKey Buffer on success.
 * Throws a clean, user-facing Error on failure (unknown user or wrong password).
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ masterKey: Buffer, entry: object }>}
 */
export async function unlockMasterKey(username, password) {
  const ks    = loadKeystore();
  const entry = ks.entries.find(e => e.username.toLowerCase() === username.toLowerCase());

  if (!entry) {
    throw new Error('Invalid username or password.');
  }

  let masterKey;
  try {
    const userKey = await deriveKey(password, Buffer.from(entry.kdfSalt, 'hex'));
    masterKey = decryptBuffer(entry.iv, entry.tag, entry.encryptedKey, userKey);
  } catch {
    // GCM auth tag mismatch = wrong password
    throw new Error('Invalid username or password.');
  }

  return { masterKey, entry };
}
