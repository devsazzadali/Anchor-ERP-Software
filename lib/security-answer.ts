// Security answers (audit Part D): profiles.security_answer was
// stored PLAINTEXT (lowercased) and compared plaintext, with no
// attempt limit — a leaked row or a patient guesser owns the
// account. Answers are now stored as a SHA-256 digest of the
// normalised answer. The digest is computed with Web Crypto so the
// same function runs in the browser (settings page, at save time)
// and on the server (reset verification).
//
// Honest limit: security answers are low-entropy, so a digest is
// NOT a password-grade hash — it removes plaintext-at-rest and
// casual exposure, and the reset route adds attempt lockout; a
// determined offline attacker with the DB could still brute-force
// weak answers. The OTP reset flow remains the primary path.

const encoder = new TextEncoder();

export function normaliseSecurityAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

export async function hashSecurityAnswer(answer: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`security-answer:${normaliseSecurityAnswer(answer)}`),
  );
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function verifySecurityAnswer(stored: string, supplied: string): Promise<boolean> {
  if (!stored || !supplied) return false;
  if (!HEX64.test(stored)) {
    // Legacy plaintext row (pre-cutover) — compared normalised, as
    // the old code did; such rows upgrade on the user's next save.
    return normaliseSecurityAnswer(stored) === normaliseSecurityAnswer(supplied);
  }
  const candidate = await hashSecurityAnswer(supplied);
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}
