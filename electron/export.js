/**
 * PharmaCore – Portable Collection Encryption (PCE) format
 *
 * Handles encrypted export/import of individual data collections
 * (medicines or sales) independently of the main database.
 *
 * PCE binary format:
 *   [4 bytes: magic "PCE\x01"] [32 bytes: scrypt salt]
 *   [12 bytes: AES-GCM IV] [16 bytes: GCM auth tag]
 *   [variable: AES-256-GCM ciphertext of UTF-8 JSON]
 *
 * The JSON payload is:
 *   { version: 1, collection: string, exportedAt: ISO string, records: array }
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, dialog } from 'electron';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAGIC        = Buffer.from([0x50, 0x43, 0x45, 0x01]); // "PCE\x01"
const ALGORITHM    = 'aes-256-gcm';
const KEY_LEN      = 32;
const IV_LEN       = 12;
const TAG_LEN      = 16;
const SALT_LEN     = 32;
const SCRYPT_N     = 16384;
const SCRYPT_R     = 8;
const SCRYPT_P     = 1;

// ─── KDF ──────────────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => err ? reject(err) : resolve(key));
  });
}

// ─── Core Crypto ──────────────────────────────────────────────────────────────

async function encryptPayload(plaintext, password) {
  const salt   = crypto.randomBytes(SALT_LEN);
  const key    = await deriveKey(password, salt);
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return Buffer.concat([MAGIC, salt, iv, tag, ct]);
}

async function decryptPayload(buf, password) {
  // Validate magic bytes
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error('File is too small to be a valid .pce file.');
  }
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid PharmaCore export file (.pce format).');
  }

  let offset   = MAGIC.length;
  const salt   = buf.subarray(offset, offset + SALT_LEN); offset += SALT_LEN;
  const iv     = buf.subarray(offset, offset + IV_LEN);   offset += IV_LEN;
  const tag    = buf.subarray(offset, offset + TAG_LEN);  offset += TAG_LEN;
  const ct     = buf.subarray(offset);

  const key = await deriveKey(password, salt);
  const dec = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  dec.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    throw new Error('Incorrect export password or corrupted file.');
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Encrypts a collection array and saves it via a native Save dialog.
 *
 * @param {object} browserWindow  Electron BrowserWindow (for dialog parent)
 * @param {string} collectionName e.g. 'medicines' | 'sales'
 * @param {Array}  records        The raw records from the DB
 * @param {string} password       Export password
 * @returns {Promise<{success:boolean, filePath?:string, error?:string}>}
 */
export async function exportCollection(browserWindow, collectionName, records, password) {
  const payload = JSON.stringify({
    version: 1,
    collection: collectionName,
    exportedAt: new Date().toISOString(),
    records,
  });

  const encrypted = await encryptPayload(payload, password);

  const defaultName = `pharmacore-${collectionName}-${new Date().toISOString().split('T')[0]}.pce`;
  
  const { filePath, canceled } = await dialog.showSaveDialog(browserWindow, {
    title: `Export ${collectionName}`,
    defaultPath: defaultName,
    filters: [{ name: 'PharmaCore Export', extensions: ['pce'] }],
  });

  if (canceled || !filePath) {
    return { success: false, error: 'Export cancelled by user.' };
  }

  fs.writeFileSync(filePath, encrypted);
  return { success: true, filePath };
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Opens a file picker, reads a .pce file, decrypts it, and returns the records.
 * Validates collection type matches expected.
 *
 * @param {object} browserWindow
 * @param {string} expectedCollection  'medicines' | 'sales'
 * @param {string} password
 * @returns {Promise<{success:boolean, records?:Array, exportedAt?:string, error?:string}>}
 */
export async function importCollection(browserWindow, expectedCollection, password) {
  const { filePaths, canceled } = await dialog.showOpenDialog(browserWindow, {
    title: `Import ${expectedCollection}`,
    filters: [{ name: 'PharmaCore Export', extensions: ['pce'] }],
    properties: ['openFile'],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { success: false, error: 'Import cancelled by user.' };
  }

  const buf = fs.readFileSync(filePaths[0]);

  let payload;
  try {
    payload = await decryptPayload(buf, password);
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (payload.collection !== expectedCollection) {
    return {
      success: false,
      error: `Wrong file type. Expected a "${expectedCollection}" export, but this file contains "${payload.collection}".`,
    };
  }

  if (typeof payload.records !== 'object' || payload.records === null) {
    return { success: false, error: 'Invalid export file: records data is malformed.' };
  }

  return { success: true, records: payload.records, exportedAt: payload.exportedAt };
}
