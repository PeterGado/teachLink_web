// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  __resetVerificationStoreForTests,
  __setVerificationStorePathForTests,
  createOrRestoreVerification,
  getVerificationStatus,
} from '@/lib/auth/email-verification';
import { POST as signupPOST } from '../signup/route';
import { POST as loginPOST } from '../login/route';
import { GET as verifyGET } from '../email-verification/verify/route';
import { POST as resendPOST } from '../email-verification/resend/route';
import { POST as restorePOST } from '../email-verification/restore/route';

async function jsonResponse<T = any>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('auth email verification routes', () => {
  let storeDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    storeDir = await mkdtemp(join(tmpdir(), 'teachlink-email-route-'));
    __setVerificationStorePathForTests(join(storeDir, 'verification.json'));
    __resetVerificationStoreForTests();
  });

  afterEach(async () => {
    vi.useRealTimers();
    __resetVerificationStoreForTests();
    await rm(storeDir, { recursive: true, force: true });
  });

  it('signs up a user and requires verification before login', async () => {
    const signupResponse = await signupPOST(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({
          name: 'Route User',
          email: 'route-user@example.com',
          password: 'password123',
          confirmPassword: 'password123',
        }),
      }) as any,
    );

    expect(signupResponse.status).toBe(201);
    const signupBody = await jsonResponse(signupResponse);
    expect(signupBody.verification.required).toBe(true);
    expect(signupBody.verification.sessionId).toBeTruthy();

    const loginResponse = await loginPOST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'route-user@example.com',
          password: 'password123',
        }),
      }) as any,
    );

    expect(loginResponse.status).toBe(403);
    const loginBody = await jsonResponse(loginResponse);
    expect(loginBody.message).toContain('Email verification required');
  });

  it('verifies via token and accepts subsequent login requests', async () => {
    const issue = await createOrRestoreVerification({
      email: 'verified-route@example.com',
      name: 'Verified Route',
    });

    const verifyResponse = await verifyGET(
      new Request(`http://localhost/api/auth/email-verification/verify?token=${encodeURIComponent(issue.verificationToken)}`) as any,
    );

    expect(verifyResponse.status).toBe(200);
    const verifyBody = await jsonResponse(verifyResponse);
    expect(verifyBody.status).toBe('verified');

    const loginResponse = await loginPOST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'verified-route@example.com',
          password: 'password123',
        }),
      }) as any,
    );

    expect(loginResponse.status).toBe(200);
  });

  it('resends and restores verification emails without exposing raw tokens in API output', async () => {
    const issue = await createOrRestoreVerification({
      email: 'restore-route@example.com',
      name: 'Restore Route',
    });

    const resendResponse = await resendPOST(
      new Request('http://localhost/api/auth/email-verification/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'restore-route@example.com' }),
      }) as any,
    );

    expect(resendResponse.status).toBe(200);
    const resendBody = await jsonResponse(resendResponse);
    expect(resendBody.verification.status).toBe('pending');
    expect(JSON.stringify(resendBody)).not.toContain(issue.verificationToken);

    const restoreResponse = await restorePOST(
      new Request('http://localhost/api/auth/email-verification/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'restore-route@example.com',
          backupCode: issue.backupCode,
        }),
      }) as any,
    );

    expect(restoreResponse.status).toBe(200);
    const restoreBody = await jsonResponse(restoreResponse);
    expect(restoreBody.verification.restoreCount).toBe(1);
    expect(JSON.stringify(restoreBody)).not.toContain(issue.backupCode);

    const stored = await getVerificationStatus('restore-route@example.com');
    expect(stored?.restoreCount).toBe(1);
  });
});
