import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/ratelimit';
import { edgeLog } from '@/../infra/edge-config';
import { validateBody } from '@/lib/validation';
import { VerifyEmailRequestSchema } from '@/types/api/auth.dto';
import { verifyEmailToken } from '@/lib/auth/email-verification';

export const runtime = 'nodejs';

async function handleToken(token: string, addHeaders: <U>(response: Response | NextResponse<U>) => NextResponse<U>) {
  const result = await verifyEmailToken(token);

  if (result.status === 'verified') {
    return addHeaders(
      NextResponse.json({
        message: 'Email verified successfully',
        status: result.status,
        verification: result.summary,
      }),
    );
  }

  if (result.status === 'already_verified') {
    return addHeaders(
      NextResponse.json({
        message: 'Email is already verified',
        status: result.status,
        verification: result.summary,
      }),
    );
  }

  if (result.status === 'expired') {
    return addHeaders(
      NextResponse.json(
        {
          message: 'Verification link expired. Use the backup code to restore access.',
          status: result.status,
          verification: result.summary,
        },
        { status: 410 },
      ),
    );
  }

  if (result.status === 'cooldown') {
    return addHeaders(
      NextResponse.json(
        {
          message: 'Please wait before requesting another verification email.',
          status: result.status,
          retryAfterMs: result.retryAfterMs,
        },
        { status: 429 },
      ),
    );
  }

  return addHeaders(
    NextResponse.json(
      {
        message: 'Invalid verification token',
        status: result.status,
      },
      { status: 400 },
    ),
  );
}

export async function GET(request: NextRequest) {
  edgeLog('info', '/api/auth/email-verification/verify', 'GET request received');
  const { addHeaders, rateLimitResponse } = withRateLimit(request, 'AUTH');
  if (rateLimitResponse) return rateLimitResponse;

  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return addHeaders(NextResponse.json({ message: 'Verification token is required' }, { status: 400 }));
  }

  return handleToken(token, addHeaders);
}

export async function POST(request: NextRequest) {
  edgeLog('info', '/api/auth/email-verification/verify', 'POST request received');

  const { addHeaders, rateLimitResponse } = withRateLimit(request, 'AUTH');
  if (rateLimitResponse) return rateLimitResponse;

  const result = validateBody(VerifyEmailRequestSchema, await request.json());
  if (!result.ok) return addHeaders(result.error);

  return handleToken(result.data.token, addHeaders);
}
