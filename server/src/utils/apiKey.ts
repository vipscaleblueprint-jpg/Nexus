import crypto from 'crypto';

/**
 * Computes the SHA-256 hash of an API key.
 * Used for storing and looking up API keys securely without storing plaintext.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim()).digest('hex');
}

/**
 * Checks whether a given string is already a 64-character SHA-256 hex digest.
 */
export function isHashedApiKey(key: string): boolean {
  return typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key.trim());
}

/**
 * Generates a new random API key and its corresponding SHA-256 hash.
 */
export function generateApiKey(prefix = 'nx_'): { rawKey: string; hashedKey: string } {
  const randomHex = crypto.randomBytes(24).toString('hex');
  const rawKey = `${prefix}${randomHex}`;
  const hashedKey = hashApiKey(rawKey);
  return { rawKey, hashedKey };
}
