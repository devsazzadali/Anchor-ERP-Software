import { NextResponse } from 'next/server';

// A10: this endpoint used to return ANY account's security question
// (plus its userId) to anonymous callers who supplied an email —
// an enumeration + targeted-guessing aid, made worse by the
// plaintext security_answer storage flagged in the audit (Part D).
// No page in the app calls this endpoint: the live reset flow is
// OTP-based (request-reset → verify-reset-otp → complete-reset).
// The endpoint now answers every request with the same generic
// guidance and reveals nothing about the account. If a
// security-question reset flow is ever rebuilt, it must run
// authenticated and verify answers server-side against a HASHED
// stored answer with attempt limits.
export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    return NextResponse.json({
      question: null,
      userId: null,
      message: 'Please use the email verification code to reset your password.',
    }, { status: 200 });
  } catch (err) {
    console.error('Unexpected error in security-question route:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
