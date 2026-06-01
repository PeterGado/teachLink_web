'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api';

type StatusMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';

  const [token, setToken] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [backupCode, setBackupCode] = useState('');
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const heading = useMemo(() => {
    if (searchParams.get('sessionId')) {
      return 'Resume email verification';
    }

    return 'Verify your email';
  }, [searchParams]);

  async function runRequest<T>(url: string, payload: Record<string, string>) {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await apiClient.post<{ message?: string; status?: string }>(url, payload);
      setMessage({
        type: 'success',
        text: response.message ?? 'Request completed successfully.',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-cyan-950/20">
          <div className="text-sm uppercase tracking-[0.35em] text-cyan-300">TeachLink</div>
          <h1 className="mt-3 text-3xl font-semibold">{heading}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Use the verification link from your email to confirm the address. If you lost the
            message, restore access with your backup code or request a fresh resend.
          </p>

          {message ? (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : message.type === 'error'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                    : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
              }`}
            >
              {message.text}
            </div>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await runRequest('/api/auth/email-verification/verify', { token });
            }}
            className="rounded-3xl border border-slate-800 bg-slate-900 p-6"
          >
            <h2 className="text-lg font-semibold">Verify token</h2>
            <p className="mt-2 text-sm text-slate-400">Paste the token from the verification link.</p>
            <label className="mt-4 block text-sm text-slate-300">
              Token
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none ring-0 focus:border-cyan-400"
                placeholder="verification token"
                required
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
            >
              Verify email
            </button>
          </form>

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await runRequest('/api/auth/email-verification/restore', { email, backupCode });
            }}
            className="rounded-3xl border border-slate-800 bg-slate-900 p-6"
          >
            <h2 className="text-lg font-semibold">Restore backup</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use your backup code to generate a fresh verification link.
            </p>
            <label className="mt-4 block text-sm text-slate-300">
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none ring-0 focus:border-cyan-400"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="mt-4 block text-sm text-slate-300">
              Backup code
              <input
                value={backupCode}
                onChange={(event) => setBackupCode(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none ring-0 focus:border-cyan-400"
                placeholder="backup code"
                required
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-60"
            >
              Restore verification
            </button>
          </form>

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await runRequest('/api/auth/email-verification/resend', { email });
            }}
            className="rounded-3xl border border-slate-800 bg-slate-900 p-6"
          >
            <h2 className="text-lg font-semibold">Resend email</h2>
            <p className="mt-2 text-sm text-slate-400">
              Request a new verification email if the original one was lost.
            </p>
            <label className="mt-4 block text-sm text-slate-300">
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none ring-0 focus:border-cyan-400"
                placeholder="you@example.com"
                required
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-60"
            >
              Resend email
            </button>
          </form>
        </div>

        <div className="text-sm text-slate-400">
          Need to sign in instead?{' '}
          <Link href="/login" className="text-cyan-300 underline underline-offset-4">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
