import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Loaded here so every module that reads env vars gets them, regardless of import order.
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

/**
 * Reads a required environment variable.
 * Throws at startup instead of silently falling back to a hardcoded default.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Reads an optional environment variable, returning undefined when unset. */
export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
