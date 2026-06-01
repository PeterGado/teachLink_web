import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const BACKUP_CODE_TTL_MS = 72 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const EXPIRATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type VerificationStatus = 'pending' | 'verified' | 'expired';

export interface EmailVerificationRecord {
  id: string;
  sessionId: string;
  email: string;
  name: string;
  status: VerificationStatus;
  tokenHash: string;
  consumedTokenHash?: string;
  backupCodeHash: string;
  tokenExpiresAt: number;
  backupCodeExpiresAt: number;
  resendAvailableAt: number;
  resendCount: number;
  restoreCount: number;
  lastSentAt: number;
  createdAt: number;
  updatedAt: number;
  verifiedAt?: number;
}

export interface VerificationSummary {
  id: string;
  sessionId: string;
  email: string;
  name: string;
  status: VerificationStatus;
  tokenExpiresAt: number;
  backupCodeExpiresAt: number;
  resendAvailableAt: number;
  resendCount: number;
  restoreCount: number;
  lastSentAt: number;
  createdAt: number;
  updatedAt: number;
  verifiedAt?: number;
}

export interface IssueVerificationInput {
  email: string;
  name: string;
}

export interface VerificationMailContext {
  verificationUrl: string;
  restoreUrl: string;
  backupCode: string;
  expiresInMinutes: number;
  backupExpiresInMinutes: number;
}

export interface VerificationIssueResult {
  status: 'pending';
  summary: VerificationSummary;
  verificationToken: string;
  backupCode: string;
  isResend: boolean;
}

export interface VerificationLookupResult {
  status: 'verified' | 'already_verified' | 'pending' | 'expired' | 'invalid' | 'cooldown';
  summary?: VerificationSummary;
  verificationToken?: string;
  backupCode?: string;
  retryAfterMs?: number;
}

interface StoredEnvelope {
  records: EmailVerificationRecord[];
}

let STORE_PATH =
  process.env.EMAIL_VERIFICATION_STORE_PATH ?? join(process.cwd(), '.data', 'email-verification.json');

let storeCache: Map<string, EmailVerificationRecord> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

function now() {
  return Date.now();
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

function generateBackupCode(): string {
  return randomBytes(6).toString('hex').toUpperCase();
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashMatches(expectedHash: string, value: string): boolean {
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(hashValue(value), 'hex');

  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function toSummary(record: EmailVerificationRecord): VerificationSummary {
  return {
    id: record.id,
    sessionId: record.sessionId,
    email: record.email,
    name: record.name,
    status: record.status,
    tokenExpiresAt: record.tokenExpiresAt,
    backupCodeExpiresAt: record.backupCodeExpiresAt,
    resendAvailableAt: record.resendAvailableAt,
    resendCount: record.resendCount,
    restoreCount: record.restoreCount,
    lastSentAt: record.lastSentAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    verifiedAt: record.verifiedAt,
  };
}

async function loadStore(): Promise<Map<string, EmailVerificationRecord>> {
  if (storeCache) return storeCache;

  const store = new Map<string, EmailVerificationRecord>();

  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (Array.isArray(parsed.records)) {
      for (const record of parsed.records) {
        if (record?.email) {
          store.set(normalizeEmail(record.email), record);
        }
      }
    }
  } catch {
    // Fresh store on first run or after a truncated file.
  }

  storeCache = store;
  return store;
}

async function persistStore(store: Map<string, EmailVerificationRecord>): Promise<void> {
  const payload: StoredEnvelope = {
    records: Array.from(store.values()),
  };

  persistQueue = persistQueue.catch(() => undefined).then(async () => {
    await mkdir(dirname(STORE_PATH), { recursive: true });
    const nextPath = `${STORE_PATH}.tmp`;
    await writeFile(nextPath, JSON.stringify(payload, null, 2), 'utf8');
    await rename(nextPath, STORE_PATH);
  });

  await persistQueue;
}

function markExpired(record: EmailVerificationRecord): EmailVerificationRecord {
  return {
    ...record,
    status: 'expired',
    updatedAt: now(),
  };
}

async function cleanupExpiredRecords(store: Map<string, EmailVerificationRecord>): Promise<void> {
  const current = now();
  let didChange = false;

  for (const [email, record] of store.entries()) {
    if (record.status === 'pending' && record.tokenExpiresAt <= current) {
      store.set(email, markExpired(record));
      didChange = true;
      continue;
    }

    if (
      record.status === 'expired' &&
      current - Math.max(record.updatedAt, record.tokenExpiresAt) > EXPIRATION_RETENTION_MS
    ) {
      store.delete(email);
      didChange = true;
    }
  }

  if (didChange) {
    await persistStore(store);
  }
}

function issueForRecord(record: EmailVerificationRecord, isResend: boolean): VerificationIssueResult {
  const verificationToken = generateVerificationToken();
  const backupCode = generateBackupCode();
  const timestamp = now();

  const nextRecord: EmailVerificationRecord = {
    ...record,
    status: 'pending',
    tokenHash: hashValue(verificationToken),
    consumedTokenHash: record.status === 'verified' ? record.consumedTokenHash : undefined,
    backupCodeHash: hashValue(normalizeBackupCode(backupCode)),
    tokenExpiresAt: timestamp + VERIFICATION_TOKEN_TTL_MS,
    backupCodeExpiresAt: timestamp + BACKUP_CODE_TTL_MS,
    resendAvailableAt: timestamp + RESEND_COOLDOWN_MS,
    resendCount: isResend ? record.resendCount + 1 : record.resendCount,
    restoreCount: record.restoreCount,
    lastSentAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    status: 'pending',
    summary: toSummary(nextRecord),
    verificationToken,
    backupCode,
    isResend,
  };
}

async function saveRecord(record: EmailVerificationRecord): Promise<VerificationSummary> {
  const store = await loadStore();
  store.set(record.email, record);
  await persistStore(store);
  return toSummary(record);
}

async function getRecord(email: string): Promise<EmailVerificationRecord | undefined> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);
  return store.get(normalizeEmail(email));
}

export async function createOrRestoreVerification(input: IssueVerificationInput): Promise<VerificationIssueResult> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);

  const email = normalizeEmail(input.email);
  const existing = store.get(email);
  const timestamp = now();

  if (existing?.status === 'verified') {
    return {
      status: 'pending',
      summary: toSummary(existing),
      verificationToken: '',
      backupCode: '',
      isResend: false,
    };
  }

  const baseRecord: EmailVerificationRecord = existing ?? {
    id: generateId('verify'),
    sessionId: generateId('session'),
    email,
    name: input.name,
    status: 'pending',
    tokenHash: '',
    backupCodeHash: '',
    tokenExpiresAt: timestamp,
    backupCodeExpiresAt: timestamp,
    resendAvailableAt: timestamp,
    resendCount: 0,
    restoreCount: 0,
    lastSentAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const issue = issueForRecord(baseRecord, Boolean(existing));
  const nextRecord: EmailVerificationRecord = {
    ...baseRecord,
    tokenHash: hashValue(issue.verificationToken),
    backupCodeHash: hashValue(normalizeBackupCode(issue.backupCode)),
    status: 'pending',
    tokenExpiresAt: issue.summary.tokenExpiresAt,
    backupCodeExpiresAt: issue.summary.backupCodeExpiresAt,
    resendAvailableAt: issue.summary.resendAvailableAt,
    resendCount: issue.summary.resendCount,
    restoreCount: issue.summary.restoreCount,
    lastSentAt: issue.summary.lastSentAt,
    updatedAt: timestamp,
  };

  await saveRecord(nextRecord);

  return issue;
}

export async function getVerificationStatus(email: string): Promise<VerificationSummary | undefined> {
  const record = await getRecord(email);
  return record ? toSummary(record) : undefined;
}

export async function getVerificationBySessionId(sessionId: string): Promise<VerificationSummary | undefined> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);
  const record = Array.from(store.values()).find((entry) => entry.sessionId === sessionId);
  return record ? toSummary(record) : undefined;
}

export async function verifyEmailToken(token: string): Promise<VerificationLookupResult> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);
  const current = now();
  const tokenHash = hashValue(token);

  for (const [email, record] of store.entries()) {
    if (record.status === 'verified') {
      if (record.tokenHash === tokenHash || record.consumedTokenHash === tokenHash) {
        return { status: 'already_verified', summary: toSummary(record) };
      }
      continue;
    }

    if (record.tokenHash !== tokenHash) continue;

    if (record.tokenExpiresAt <= current) {
      const expired = markExpired(record);
      store.set(email, expired);
      await persistStore(store);
      return { status: 'expired', summary: toSummary(expired) };
    }

    const verified: EmailVerificationRecord = {
      ...record,
      status: 'verified',
      consumedTokenHash: record.tokenHash,
      verifiedAt: current,
      updatedAt: current,
    };

    store.set(email, verified);
    await persistStore(store);
    return { status: 'verified', summary: toSummary(verified) };
  }

  return { status: 'invalid' };
}

export async function resendVerificationEmail(email: string): Promise<VerificationIssueResult | VerificationLookupResult> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);

  const record = store.get(normalizeEmail(email));
  if (!record) return { status: 'invalid' };
  if (record.status === 'verified') return { status: 'already_verified', summary: toSummary(record) };

  const current = now();
  if (record.resendAvailableAt > current) {
    return {
      status: 'cooldown',
      summary: toSummary(record),
      retryAfterMs: record.resendAvailableAt - current,
    };
  }

  const issue = issueForRecord(record, true);
  const nextRecord: EmailVerificationRecord = {
    ...record,
    status: 'pending',
    tokenHash: hashValue(issue.verificationToken),
    backupCodeHash: hashValue(normalizeBackupCode(issue.backupCode)),
    tokenExpiresAt: issue.summary.tokenExpiresAt,
    backupCodeExpiresAt: issue.summary.backupCodeExpiresAt,
    resendAvailableAt: issue.summary.resendAvailableAt,
    resendCount: issue.summary.resendCount,
    restoreCount: issue.summary.restoreCount,
    lastSentAt: issue.summary.lastSentAt,
    updatedAt: issue.summary.updatedAt,
  };

  store.set(record.email, nextRecord);
  await persistStore(store);

  return issue;
}

export async function restoreVerificationEmail(
  email: string,
  backupCode: string,
): Promise<VerificationIssueResult | VerificationLookupResult> {
  const store = await loadStore();
  await cleanupExpiredRecords(store);

  const record = store.get(normalizeEmail(email));
  if (!record) return { status: 'invalid' };
  if (record.status === 'verified') return { status: 'already_verified', summary: toSummary(record) };

  const current = now();
  if (record.backupCodeExpiresAt <= current) {
    const expired = markExpired(record);
    store.set(record.email, expired);
    await persistStore(store);
    return { status: 'expired', summary: toSummary(expired) };
  }

  if (!hashMatches(record.backupCodeHash, normalizeBackupCode(backupCode))) {
    return { status: 'invalid' };
  }

  const issue = issueForRecord(record, true);
  const nextRecord: EmailVerificationRecord = {
    ...record,
    status: 'pending',
    tokenHash: hashValue(issue.verificationToken),
    backupCodeHash: hashValue(normalizeBackupCode(issue.backupCode)),
    tokenExpiresAt: issue.summary.tokenExpiresAt,
    backupCodeExpiresAt: issue.summary.backupCodeExpiresAt,
    resendAvailableAt: issue.summary.resendAvailableAt,
    resendCount: issue.summary.resendCount,
    restoreCount: record.restoreCount + 1,
    lastSentAt: issue.summary.lastSentAt,
    updatedAt: issue.summary.updatedAt,
  };

  store.set(record.email, nextRecord);
  await persistStore(store);

  return issue;
}

export function buildVerificationMailContext(
  verificationToken: string,
  backupCode: string,
  requestOrigin: string,
): VerificationMailContext {
  const baseUrl = requestOrigin.replace(/\/+$/, '');
  const expiresInMinutes = Math.max(1, Math.ceil(VERIFICATION_TOKEN_TTL_MS / 60000));
  const backupExpiresInMinutes = Math.max(1, Math.ceil(BACKUP_CODE_TTL_MS / 60000));

  return {
    verificationUrl: `${baseUrl}/api/auth/email-verification/verify?token=${encodeURIComponent(verificationToken)}`,
    restoreUrl: `${baseUrl}/verify-email`,
    backupCode,
    expiresInMinutes,
    backupExpiresInMinutes,
  };
}

export function getVerificationCooldownMs(): number {
  return RESEND_COOLDOWN_MS;
}

export function getVerificationTokenTtlMs(): number {
  return VERIFICATION_TOKEN_TTL_MS;
}

export function getBackupCodeTtlMs(): number {
  return BACKUP_CODE_TTL_MS;
}

export function __setVerificationStorePathForTests(path: string): void {
  STORE_PATH = path;
  storeCache = null;
  persistQueue = Promise.resolve();
}

export function __resetVerificationStoreForTests(): void {
  storeCache = null;
  persistQueue = Promise.resolve();
}
