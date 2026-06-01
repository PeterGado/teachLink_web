import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/ratelimit';
import { edgeLog } from '@/../infra/edge-config';
import { validateBody } from '@/lib/validation';
import { RestoreVerificationRequestSchema } from '@/types/api/auth.dto';
import {
  buildVerificationMailContext,
  restoreVerificationEmail,
} from '@/lib/auth/email-verification';
import { notificationService } from '@/services/notifications';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  edgeLog('info', '/api/auth/email-verification/restore', 'POST request received');

  const { addHeaders, rateLimitResponse } = withRateLimit(request, 'AUTH');
  if (rateLimitResponse) return rateLimitResponse;

  const result = validateBody(RestoreVerificationRequestSchema, await request.json());
  if (!result.ok) return addHeaders(result.error);

  const issue = await restoreVerificationEmail(result.data.email, result.data.backupCode);

  if (issue.status === 'invalid') {
    return addHeaders(
      NextResponse.json({ message: 'Invalid email or backup code' }, { status: 400 }),
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

  if (issue.status === 'expired') {
    return addHeaders(
      NextResponse.json(
        {
          message: 'Backup code expired. Request a new verification email.',
          status: issue.status,
          verification: issue.summary,
        },
        { status: 410 },
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
    edgeLog('warn', '/api/auth/email-verification/restore', 'verification restore email send failed', {
      email: issue.summary.email,
      error: sendResult.error,
    });
  }

  return addHeaders(
    NextResponse.json({
      message: 'Verification restored and a fresh email was sent',
      status: issue.status,
      verification: issue.summary,
    }),
  );
}
