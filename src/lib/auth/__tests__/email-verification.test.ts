// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetVerificationStoreForTests,
  __setVerificationStorePathForTests,
  buildVerificationMailContext,
  createOrRestoreVerification,
  getVerificationBySessionId,
  getVerificationStatus,
  getVerificationTokenTtlMs,
  resendVerificationEmail,
  restoreVerificationEmail,
  verifyEmailToken,
} from '../email-verification';

describe('email verification service', () => {
  let storeDir: string;
  let storePath: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    storeDir = await mkdtemp(join(tmpdir(), 'teachlink-email-verification-'));
    storePath = join(storeDir, 'verification.json');
    __setVerificationStorePathForTests(storePath);
    __resetVerificationStoreForTests();
  });

  afterEach(async () => {
    vi.useRealTimers();
    __resetVerificationStoreForTests();
    await rm(storeDir, { recursive: true, force: true });
  });

  it('creates a pending verification record and persists it', async () => {
    const issue = await createOrRestoreVerification({
      email: 'student@example.com',
      name: 'Student',
    });

    expect(issue.summary.status).toBe('pending');
    expect(issue.summary.email).toBe('student@example.com');
    expect(issue.verificationToken).toHaveLength(43);
    expect(issue.backupCode).toHaveLength(12);
    expect(issue.summary.sessionId).toBeTruthy();

    const stored = await getVerificationStatus('student@example.com');
    expect(stored?.status).toBe('pending');
  });

  it('verifies a token once and rejects replay with already_verified', async () => {
    const issue = await createOrRestoreVerification({
      email: 'learner@example.com',
      name: 'Learner',
    });

    const first = await verifyEmailToken(issue.verificationToken);
    expect(first.status).toBe('verified');
    expect(first.summary?.status).toBe('verified');

    const duplicate = await verifyEmailToken(issue.verificationToken);
    expect(duplicate.status).toBe('already_verified');
    expect(duplicate.summary?.status).toBe('verified');
  });

  it('marks expired tokens and allows resend recovery', async () => {
    const issue = await createOrRestoreVerification({
      email: 'expired@example.com',
      name: 'Expired',
    });

    vi.setSystemTime(new Date(Date.now() + getVerificationTokenTtlMs() + 1000));

    const expired = await verifyEmailToken(issue.verificationToken);
    expect(expired.status).toBe('expired');

    const resend = await resendVerificationEmail('expired@example.com');
    expect(resend.status).toBe('pending');
    if ('verificationToken' in resend) {
      expect(resend.verificationToken).not.toBe(issue.verificationToken);
    }
  });

  it('restores verification from backup code and issues a fresh token', async () => {
    const issue = await createOrRestoreVerification({
      email: 'restore@example.com',
      name: 'Restore',
    });

    const restored = await restoreVerificationEmail('restore@example.com', issue.backupCode);
    expect(restored.status).toBe('pending');
    if ('verificationToken' in restored) {
      expect(restored.verificationToken).not.toBe(issue.verificationToken);
      expect(restored.backupCode).not.toBe(issue.backupCode);
    }

    const status = await getVerificationStatus('restore@example.com');
    expect(status?.restoreCount).toBe(1);
  });

  it('survives a simulated restart by reloading from disk', async () => {
    const issue = await createOrRestoreVerification({
      email: 'restart@example.com',
      name: 'Restart',
    });

    __resetVerificationStoreForTests();

    const restored = await getVerificationBySessionId(issue.summary.sessionId);
    expect(restored?.email).toBe('restart@example.com');
    expect(restored?.status).toBe('pending');
  });

  it('builds verification and restore links from the current origin', () => {
    const context = buildVerificationMailContext(
      'token-value',
      'BACKUPCODE',
      'https://teachlink.test/',
    );

    expect(context.verificationUrl).toContain('/api/auth/email-verification/verify?token=');
    expect(context.restoreUrl).toBe('https://teachlink.test/verify-email');
    expect(context.backupCode).toBe('BACKUPCODE');
  });
});
