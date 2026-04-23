'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import type {
  IdVerificationStatus,
  ProfileResponse,
  SelfProfile,
} from '@/types/users';

type Status = 'todo' | 'pending' | 'done' | 'rejected';

export default function VerificationPage() {
  const fetchStoreUser = useAuthStore((s) => s.fetchUser);
  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [canSell, setCanSell] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await api<ProfileResponse>('/api/users/profile');
      setProfile(res.user);
      setMissing(res.missing);
      setCanSell(res.canSell);
      fetchStoreUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [fetchStoreUser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <VerificationSkeleton />;
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4 text-sm text-[var(--neon-danger)]">
        {error}
      </div>
    );
  }
  if (!profile) return null;

  const emailStatus: Status = profile.emailVerified ? 'done' : 'todo';
  const phoneStatus: Status = profile.phoneVerified ? 'done' : 'todo';
  const idStatus: Status = idStepStatus(profile.idVerification);
  const abnStatus: Status = profile.abnVerified ? 'done' : 'todo';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Seller verification</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Complete each step below to start posting listings.{' '}
          {profile.sellerType === 'PERSONAL' ? (
            <>Personal sellers need email, phone and a verified government ID.</>
          ) : (
            <>Business sellers need email, phone and a verified ABN.</>
          )}
        </p>
      </div>

      <div
        className={`rounded-lg border p-4 text-sm ${
          canSell
            ? 'border-[var(--neon-green)]/40 bg-[var(--tint-green)] text-[var(--neon-green)]'
            : 'border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] text-[var(--neon-amber)]'
        }`}
      >
        {canSell ? (
          <>
            <span className="font-medium">You're verified to sell.</span>{' '}
            <Link href="/listings/new" className="underline">
              Post a listing.
            </Link>
          </>
        ) : (
          <>
            <span className="font-medium">Not ready yet.</span>{' '}
            {missing.length} step{missing.length === 1 ? '' : 's'} remaining.
          </>
        )}
      </div>

      <EmailStep status={emailStatus} />
      <PhoneStep profile={profile} status={phoneStatus} onChange={refresh} />
      {profile.sellerType === 'PERSONAL' ? (
        <IdStep profile={profile} status={idStatus} onChange={refresh} />
      ) : (
        <AbnStep profile={profile} status={abnStatus} onChange={refresh} />
      )}
    </div>
  );
}

function VerificationSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-5 w-48 rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-20 rounded-lg bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-20 rounded-lg bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-20 rounded-lg bg-[var(--bg-panel-hi)] animate-pulse" />
    </div>
  );
}

function idStepStatus(s: IdVerificationStatus): Status {
  if (s === 'APPROVED') return 'done';
  if (s === 'PENDING_REVIEW') return 'pending';
  if (s === 'REJECTED') return 'rejected';
  return 'todo';
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    done: { label: 'Verified', cls: 'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40' },
    pending: { label: 'Under review', cls: 'bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40' },
    rejected: { label: 'Rejected', cls: 'bg-[var(--tint-danger)] text-[var(--neon-danger)] border border-[var(--neon-danger)]/40' },
    todo: { label: 'Required', cls: 'bg-[var(--bg-panel-hi)] text-[var(--text-muted)] border border-[var(--border-subtle)]' },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function StepCard({
  title,
  status,
  children,
}: {
  title: string;
  status: Status;
  children: React.ReactNode;
}) {
  return (
    <section className="panel clip-corner p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Email step
// ---------------------------------------------------------------------------

function EmailStep({ status }: { status: Status }) {
  return (
    <StepCard title="Email" status={status}>
      {status === 'done' ? (
        <p className="text-sm text-[var(--text-muted)]">Your email address is verified.</p>
      ) : (
        <div className="space-y-3 text-sm text-[var(--text-muted)]">
          <p>Check your inbox for the verification email we sent when you registered.</p>
          <Link
            href="/verify-email"
            className="btn-cyber-outline inline-block text-xs"
          >
            Resend verification email
          </Link>
        </div>
      )}
    </StepCard>
  );
}

// ---------------------------------------------------------------------------
// Phone step
// ---------------------------------------------------------------------------

function PhoneStep({
  profile,
  status,
  onChange,
}: {
  profile: SelfProfile;
  status: Status;
  onChange: () => void;
}) {
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  // When status='done' but the user clicks Change number, we flip editMode so
  // the form renders even though the profile says phoneVerified. After a
  // successful verify the profile refetches, status flips via the new phone
  // (server clears phoneVerified if phone changed), and we reset editMode.
  const [editMode, setEditMode] = useState(false);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setDevCode(null);
    setSending(true);
    try {
      const res = await api<{ message: string; devCode?: string }>(
        '/api/users/verify-phone',
        { method: 'POST', body: JSON.stringify({ phone }) },
      );
      setCodeSent(true);
      setInfo('Verification code sent.');
      if (res.devCode) setDevCode(res.devCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setVerifying(true);
    try {
      await api<{ message: string }>('/api/users/verify-phone/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setCode('');
      setCodeSent(false);
      setEditMode(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code');
    } finally {
      setVerifying(false);
    }
  }

  if (status === 'done' && !editMode) {
    return (
      <StepCard title="Phone" status={status}>
        <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
          <span>Verified: {profile.phone}</span>
          <button
            type="button"
            className="text-xs font-medium text-[var(--neon-cyan)] hover:underline"
            onClick={() => {
              setEditMode(true);
              setCodeSent(false);
              setCode('');
              setPhone(profile.phone ?? '');
            }}
          >
            Change number
          </button>
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard title="Phone" status={status}>
      {error && (
        <div className="mb-3 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="mb-3 rounded-lg border border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] p-3 text-sm text-[var(--neon-cyan)]">
          {info}
          {devCode && (
            <>
              {' '}
              <span className="font-mono font-bold">(dev code: {devCode})</span>
            </>
          )}
        </div>
      )}

      {!codeSent ? (
        <form onSubmit={handleSendCode} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-[var(--text-primary)]">Phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="+61 400 000 000"
              className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="btn-cyber-primary"
          >
            {sending ? 'Sending...' : 'Send code'}
          </button>
          {editMode && (
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setCodeSent(false);
                setCode('');
                setInfo('');
                setDevCode(null);
              }}
              className="btn-cyber-outline"
            >
              Cancel
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)]">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              placeholder="000000"
              className="input-cyber mt-1 block w-40 px-3 py-2 text-center text-lg tracking-[0.3em]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="btn-cyber-primary"
            >
              {verifying ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode('');
                setInfo('');
              }}
              className="btn-cyber-outline"
            >
              Change number
            </button>
          </div>
        </form>
      )}
    </StepCard>
  );
}

// ---------------------------------------------------------------------------
// ID step (PERSONAL sellers)
// ---------------------------------------------------------------------------

const ID_ACCEPT = 'image/jpeg,image/png,application/pdf';
const ID_ACCEPT_LABEL = 'JPEG, PNG or PDF, up to 5 MB';

function IdStep({
  profile,
  status,
  onChange,
}: {
  profile: SelfProfile;
  status: Status;
  onChange: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      // 1. Ask server for a presigned PUT URL on the id-documents prefix.
      const presign = await api<{ uploadUrl: string; fileUrl: string }>(
        '/api/uploads/presigned-url',
        {
          method: 'POST',
          body: JSON.stringify({
            fileType: file.type,
            fileSize: file.size,
            purpose: 'id-document',
          }),
        },
      );

      // 2. PUT the file to S3 directly.
      const uploadRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`);
      }

      // 3. Tell the server the URL to record + flip idVerification → PENDING_REVIEW.
      await api<{ message: string }>('/api/users/verify-id', {
        method: 'POST',
        body: JSON.stringify({ documentUrl: presign.fileUrl }),
      });

      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  return (
    <StepCard title="Government ID" status={status}>
      {status === 'done' && (
        <p className="text-sm text-[var(--text-muted)]">Your ID has been verified.</p>
      )}
      {status === 'pending' && (
        <p className="text-sm text-[var(--text-muted)]">
          Your document is under review. This usually takes 1–2 business days.
        </p>
      )}
      {status === 'rejected' && (
        <div className="mb-3 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          <strong className="font-medium">Rejected.</strong>{' '}
          {profile.idRejectionReason ?? 'No reason provided.'} Please upload a clearer document.
        </div>
      )}

      {(status === 'todo' || status === 'rejected') && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
              {error}
            </div>
          )}
          <p className="text-sm text-[var(--text-muted)]">
            Upload a clear photo of your driver's licence, passport or other government-issued ID.
          </p>
          <label className="block">
            <span className="sr-only">ID document</span>
            <input
              ref={inputRef}
              type="file"
              accept={ID_ACCEPT}
              onChange={(e) => {
                setError('');
                const f = e.target.files?.[0];
                if (!f) {
                  setFile(null);
                  return;
                }
                if (f.size > 5 * 1024 * 1024) {
                  setError('File must be under 5 MB');
                  setFile(null);
                  e.target.value = '';
                  return;
                }
                setFile(f);
              }}
              className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--tint-cyan)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--neon-cyan)] hover:file:brightness-110"
            />
          </label>
          <p className="text-xs text-[var(--text-dim)]">{ID_ACCEPT_LABEL}</p>
          <button
            type="submit"
            disabled={!file || uploading}
            className="btn-cyber-primary"
          >
            {uploading ? 'Uploading...' : 'Submit for review'}
          </button>
        </form>
      )}
    </StepCard>
  );
}

// ---------------------------------------------------------------------------
// ABN step (BUSINESS sellers)
// ---------------------------------------------------------------------------

function AbnStep({
  profile,
  status,
  onChange,
}: {
  profile: SelfProfile;
  status: Status;
  onChange: () => void;
}) {
  const [abn, setAbn] = useState(profile.abn ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Open the form for re-verification even when status='done'. Server-side
  // abnVerified flips when a new valid ABN is submitted; until then the old
  // value stays verified.
  const [editMode, setEditMode] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api<{ message: string }>('/api/users/verify-abn', {
        method: 'POST',
        body: JSON.stringify({ abn }),
      });
      setEditMode(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify ABN');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'done' && !editMode) {
    return (
      <StepCard title="Australian Business Number" status={status}>
        <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
          <span>Verified: {profile.abn}</span>
          <button
            type="button"
            className="text-xs font-medium text-[var(--neon-cyan)] hover:underline"
            onClick={() => {
              setEditMode(true);
              setAbn('');
            }}
          >
            Change ABN
          </button>
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard title="Australian Business Number" status={status}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">ABN</label>
          <input
            type="text"
            inputMode="numeric"
            value={abn}
            onChange={(e) => setAbn(e.target.value.replace(/\D/g, '').slice(0, 11))}
            required
            maxLength={11}
            placeholder="12345678901"
            className="input-cyber mt-1 block w-full max-w-xs px-3 py-2 text-sm font-mono tracking-wide"
          />
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            11 digits, no spaces. We validate using the ATO checksum algorithm.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || abn.length !== 11}
            className="btn-cyber-primary"
          >
            {saving ? 'Verifying...' : 'Verify ABN'}
          </button>
          {editMode && (
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setAbn(profile.abn ?? '');
                setError('');
              }}
              className="btn-cyber-outline"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </StepCard>
  );
}
