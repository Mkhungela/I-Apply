import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 11);
}

export async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Secret encryption (connector credentials, SMTP overrides).
 * AES-256-GCM with a key derived from the application secret.
 * ------------------------------------------------------------------ */

function key() {
  return crypto.createHash('sha256').update(`${config.secret}:field-encryption`).digest();
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value ?? {}), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptJson(payload) {
  if (!payload) return {};
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (version !== 'v1') return {};
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch {
    return {};
  }
}

/** Mask a secret for display: never return raw credentials to the browser. */
export function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function stableHash(obj) {
  return sha256(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
