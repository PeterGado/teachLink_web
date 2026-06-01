import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/ratelimit';
import { edgeLog } from '@/../infra/edge-config';
import { validateBody } from '@/lib/validation';
import { ResendVerificationRequestSchema } from '@/types/api/auth.dto';
import {
  buildVerificationMailContext,
  resendVerificationEmail,
} from '@/lib/auth/email-verification';
import { notificationService } from '@/services/notifications';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  edgeLog('info', '/api/auth/email-verification/resend', 'POST request received');

  const { addHeaders, rateLimitResponse } = withRateLimit(request, 'AUTH');
  if (rateLimitResponse) return rateLimitResponse;

  const result = validateBody(ResendVerificationRequestSchema, await request.json());
  if (!result.ok) return addHeaders(result.error);

  const issue = await resendVerificationEmail(result.data.email);

  if (issue.status === 'invalid') {
    return addHeaders(
      NextResponse.json({ message: 'No verification request found for that email' }, { status: 404 }),
    );
  }

  if (issue.status === 'already_verified') {
    return addHeaders(
      NextResponse.json(
        {
          message: 'Email is already verified',
          status: issue.status,
          verification: issue.summary,
        },
        { status: 200 },
      ),
    );
  }

  if (issue.status === 'cooldown') {
    return addHeaders(
      NextResponse.json(
        {
          message: 'Please wait before requesting another verification email.',
          status: issue.status,
          retryAfterMs: issue.retryAfterMs,
          verification: issue.summary,
        },
        { status: 429 },
      ),
    );
  }

  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  const mailContext = buildVerificationMailContext(issue.verificationToken, issue.backupCode, origin);
  const sendResult = await notificationService.sendEmailVerificationEmail({
    email: issue.summary.email,
    name: issue.summary.name,
    verificationUrl: mailContext.verificationUrl,
    restoreUrl: mailContext.restoreUrl,
    backupCode: mailContext.backupCode,
    expiresInMinutes: mailContext.expiresInMinutes,
    backupExpiresInMinutes: mailContext.backupExpiresInMinutes,
  });

  if (!sendResult.success) {
    edgeLog('warn', '/api/auth/email-verification/resend', 'verification email send failed', {
      email: issue.summary.email,
      error: sendResult.error,
    });
  }

  return addHeaders(
    NextResponse.json({
      message: 'Verification email resent',
      status: issue.status,
      verification: issue.summary,
    }),
  );
}
