/**
 * Signed 2FA verification cookie.
 *
 * The `2fa_verified` cookie previously contained the RAW user id, and
 * the proxy accepted it whenever it equalled the signed-in user's id —
 * but user ids are not secret (the security-question endpoint returns
 * them for any email), so the "second factor" reduced to knowing a
 * public UUID once a password was compromised. (Audit Part D §7.)
 *
 * The cookie now carries `userId.HMAC-SHA256(userId)` keyed by a
 * server-only secret, so it can only be minted by the verify-2fa-otp
 * route after a successful OTP check.
 *
 * the secret chain is TWO_FACTOR_COOKIE_SECRET, then the
 * app's SESSION_SECRET. (The old service-role fallback is gone —
 * no such key exists in the app.)
 */

function getSecret(): string {
  const secret = process.env.TWO_FACTOR_COOKIE_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error('No 2FA cookie secret configured');
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(userId: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId));
  return new Uint8Array(signature);
}

/** Mint the cookie value for a user who just passed the OTP check. */
export async function signTwoFactorToken(userId: string): Promise<string> {
  return `${userId}.${toBase64Url(await hmac(userId))}`;
}

/** Constant-time check that a cookie value is a valid token for userId. */
export async function verifyTwoFactorToken(userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  if (token.slice(0, dot) !== userId) return false;
  let presented: Uint8Array;
  try {
    presented = fromBase64Url(token.slice(dot + 1));
  } catch {
    return false;
  }
  const expected = await hmac(userId);
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented[i] ^ expected[i];
  return diff === 0;
}
