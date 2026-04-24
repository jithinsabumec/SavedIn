/**
 * Generates a stable numeric hash from a string.
 * Used to create deterministic post IDs from post text.
 * Not cryptographic — just needs to be fast and collision-resistant enough
 * for a personal collection of LinkedIn posts.
 *
 * Algorithm: djb2 variant (XOR-shift)
 *
 * @param {string} str
 * @returns {string} hex string
 */
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    // Keep within 32-bit signed integer range
    hash = hash & hash;
  }
  // Convert to unsigned hex for a cleaner ID
  return (hash >>> 0).toString(16).padStart(8, '0');
}
