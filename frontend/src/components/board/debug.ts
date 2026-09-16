/**
 * Debug logging is disabled in production builds.
 *
 * Kept as a no-op compatibility shim for board components that still import
 * debugLog while diagnostic logging is removed from the application bundle.
 */
export function debugLog(_scope: string, _message: string): void {
  // Intentionally empty.
}
