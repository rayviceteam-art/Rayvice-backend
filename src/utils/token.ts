import crypto from 'crypto';

/**
 * Generates a cryptographically secure, URL-safe opaque token and its
 * SHA-256 hash. The raw token is sent to the user (email link / response
 * body); only the hash is ever persisted, so a database leak cannot be
 * used to impersonate a user (defense in depth, GLOBAL-RULES §9).
 */
export function generateOpaqueToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashOpaqueToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
