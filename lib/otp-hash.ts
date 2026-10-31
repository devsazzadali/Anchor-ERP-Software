// OTP codes at rest (audit Part D): registration_otps,
// user_2fa_otps and password_reset_requests used to store the
// 6-digit code in PLAINTEXT — anyone who could read those tables
// (see A2's permissive-policy history) held live codes. Codes are
// now stored as HMAC-SHA256 hex digests keyed by a server-only
// secret; verification hashes the supplied code and compares in
// constant time.
//
// the HMAC key is the app's own secret (OTP_HASH_SECRET,
// falling back to SESSION_SECRET) — there is no service-role key in
// the app. Digests carried over from the old system were keyed by
// the old secret and will not verify here; that is by design
// (in-flight OTPs expire at the switch — they live at
// most ~10 minutes anyway).
//
// Transition: a stored value that is not a 64-char hex digest is
// treated as a legacy plaintext code and compared directly. OTPs
// live at most ~10 minutes, so the legacy path disappears on its
// own shortly after cutover; remove it in a later cleanup.

const encoder = new TextEncoder();

function otpKey(): string {
  const secret = process.env.OTP_HASH_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error('OTP_HASH_SECRET / SESSION_SECRET is not configured');
  return secret;
}

export async function hashOtpCode(code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(otpKey()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`otp:${code.trim()}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function verifyOtpCode(stored: string, supplied: string): Promise<boolean> {
  if (!stored || !supplied) return false;
  if (!HEX64.test(stored)) {
    // Legacy plaintext row (pre-cutover code, expires within minutes).
    return stored === supplied.trim();
  }
  const candidate = await hashOtpCode(supplied);
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}
