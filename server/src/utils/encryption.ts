import crypto from 'crypto';
import { logger } from '../config/logger';

// Derive a 32-byte key using SHA-256 from the encryption secret or JWT_SECRET
const SECRET_SEED = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'nexus-confetti-default-secret-salt-2026';
const KEY = crypto.createHash('sha256').update(SECRET_SEED).digest();
const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/**
 * Encrypts a plaintext string (such as an R2 confetti URL) using AES-256-GCM.
 * Formats output as `enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`.
 */
export function encryptText(plaintext: string): string {
  if (!plaintext) return plaintext;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err: any) {
    logger.error({ err }, 'Failed to encrypt text');
    return plaintext;
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * If the string does not have the prefix or is plaintext, returns it as-is.
 */
export function decryptText(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith(PREFIX)) {
    // Unencrypted legacy/plain string
    return ciphertext;
  }

  try {
    const parts = ciphertext.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return ciphertext;
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: any) {
    logger.warn({ err }, 'Failed to decrypt text, returning null');
    return null;
  }
}
