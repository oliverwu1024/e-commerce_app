'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import type { ProfileResponse, SelfProfile } from '@/types/users';

export default function AccountSettingsPage() {
  const router = useRouter();
  const storeUser = useAuthStore((s) => s.user);
  const fetchStoreUser = useAuthStore((s) => s.fetchUser);

  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<ProfileResponse>('/api/users/profile')
      .then((res) => {
        if (!cancelled) setProfile(res.user);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <SettingsSkeleton />;
  if (loadError) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4 text-sm text-[var(--neon-danger)]">
        {loadError}
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="space-y-8">
      <AccountIdentityForm
        profile={profile}
        onSaved={(updated) => {
          setProfile(updated);
          fetchStoreUser();
        }}
      />
      <div className="border-t border-[var(--border-subtle)]" />
      <ProfileForm
        profile={profile}
        onSaved={(updated) => {
          setProfile(updated);
          fetchStoreUser();
        }}
      />
      <div className="border-t border-[var(--border-subtle)]" />
      <PasswordForm
        onChanged={async () => {
          // Token was invalidated server-side; clear client state and bounce
          // the user to the login page.
          try {
            await useAuthStore.getState().logout();
          } finally {
            router.push('/login');
          }
        }}
      />
      <div className="border-t border-[var(--border-subtle)]" />
      <DangerZone
        onDeleted={async () => {
          // Server has soft-deleted the row, bumped tokenVersion and
          // cleared the cookie. Clear local auth state and send home.
          try {
            await useAuthStore.getState().logout();
          } finally {
            router.push('/');
          }
        }}
      />
      <p className="text-xs text-[var(--text-dim)]">
        Signed in as {storeUser?.username ?? profile.username}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account identity — username (direct edit) + email (two-phase reverify).
// ---------------------------------------------------------------------------

function AccountIdentityForm({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (p: SelfProfile) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Account</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Login identity. Changing your email requires verifying the new
          address before the switch takes effect.
        </p>
      </div>
      <AvatarField profile={profile} onSaved={onSaved} />
      <UsernameField profile={profile} onSaved={onSaved} />
      <EmailField profile={profile} onSaved={onSaved} />
    </div>
  );
}

function AvatarField({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (p: SelfProfile) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar must be under 2 MB.');
      return;
    }

    setUploading(true);
    try {
      // Two-step: presign → PUT to S3 → tell server the final URL.
      const { uploadUrl, fileUrl } = await api<{
        uploadUrl: string;
        fileUrl: string;
      }>('/api/uploads/presigned-url', {
        method: 'POST',
        body: JSON.stringify({
          fileType: file.type,
          fileSize: file.size,
          purpose: 'avatar',
        }),
      });

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed.');

      const res = await api<{ user: SelfProfile }>('/api/users/avatar', {
        method: 'PUT',
        body: JSON.stringify({ avatarUrl: fileUrl }),
      });
      onSaved(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!profile.avatarUrl) return;
    setRemoving(true);
    setError('');
    try {
      const res = await api<{ user: SelfProfile }>('/api/users/avatar', {
        method: 'DELETE',
      });
      onSaved(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove avatar');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)]">
        Profile picture
      </label>
      <div className="mt-2 flex items-center gap-4">
        <Avatar src={profile.avatarUrl} username={profile.username} size="xl" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || removing}
            className="btn-cyber-outline"
          >
            {uploading ? 'Uploading...' : profile.avatarUrl ? 'Change' : 'Upload'}
          </button>
          {profile.avatarUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading || removing}
              className="rounded-lg border border-[var(--border-hi)] bg-[var(--bg-panel)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--tint-danger)] hover:text-[var(--neon-danger)] hover:border-[var(--neon-danger)]/40 disabled:opacity-50"
            >
              {removing ? 'Removing...' : 'Remove'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--neon-danger)]">{error}</p>}
      <p className="mt-2 text-xs text-[var(--text-dim)]">
        JPG, PNG, or WebP. Up to 2 MB.
      </p>
    </div>
  );
}

function UsernameField({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (p: SelfProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api<{ user: SelfProfile }>('/api/users/username', {
        method: 'PUT',
        body: JSON.stringify({ username: username.trim() }),
      });
      onSaved(res.user);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update username');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)]">Username</label>
      {!editing ? (
        <div className="mt-1 flex items-center gap-3">
          <input
            type="text"
            value={profile.username}
            disabled
            className="block w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-3 py-2 text-sm text-[var(--text-muted)]"
          />
          <button
            type="button"
            onClick={() => {
              setUsername(profile.username);
              setError('');
              setEditing(true);
            }}
            className="btn-cyber-outline"
          >
            Change
          </button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="mt-1 space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={30}
              required
              autoFocus
              className="input-cyber block w-full max-w-md px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="btn-cyber-primary"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError('');
              }}
              disabled={saving}
              className="btn-cyber-ghost"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-[var(--neon-danger)]">{error}</p>}
          <p className="text-xs text-[var(--text-dim)]">
            3–30 characters. Letters, numbers, and underscores only.
          </p>
        </form>
      )}
    </div>
  );
}

function EmailField({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (p: SelfProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setDevUrl(null);
    try {
      const res = await api<{
        message: string;
        pendingEmail: string;
        verificationEmailSent: boolean;
        devVerificationUrl?: string;
      }>('/api/users/email-change', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      // Refresh profile so the UI flips to "pending" state — the email field
      // itself hasn't changed server-side yet (that happens on verify).
      const fresh = await api<{ user: SelfProfile }>('/api/users/profile');
      onSaved(fresh.user);
      setEditing(false);
      setEmail('');
      if (res.devVerificationUrl) setDevUrl(res.devVerificationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)]">Email</label>
      {!editing ? (
        <div className="mt-1 space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="email"
              value={profile.email}
              disabled
              className="block w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-3 py-2 text-sm text-[var(--text-muted)]"
            />
            <button
              type="button"
              onClick={() => {
                setEmail('');
                setError('');
                setDevUrl(null);
                setEditing(true);
              }}
              className="btn-cyber-outline"
            >
              Change
            </button>
          </div>
          {!profile.emailVerified && !profile.pendingEmail && (
            <p className="text-xs text-[var(--neon-amber)]">
              Not verified yet.{' '}
              <Link href="/verify-email" className="underline hover:brightness-110">
                Verify now
              </Link>
            </p>
          )}
          {profile.pendingEmail && (
            <div className="rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-3 text-xs text-[var(--neon-amber)]">
              Change to <span className="font-medium">{profile.pendingEmail}</span> is pending. Click the verification link we sent to the new address to complete the switch. Until then, your login email stays as above.
              {devUrl && (
                <div className="mt-2">
                  <span className="font-semibold">Dev mode link:</span>{' '}
                  <a href={devUrl} className="break-all text-[var(--neon-cyan)] underline hover:text-[var(--accent-soft)]">
                    {devUrl}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-1 space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="new@example.com"
              className="input-cyber block w-full max-w-md px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="btn-cyber-primary"
            >
              {saving ? 'Sending...' : 'Send link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError('');
              }}
              disabled={saving}
              className="btn-cyber-ghost"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-[var(--neon-danger)]">{error}</p>}
          <p className="text-xs text-[var(--text-dim)]">
            We&apos;ll send a verification link to the new address. Your current
            email stays active until you click it.
          </p>
        </form>
      )}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-32 rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-10 w-full max-w-md rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-10 w-full max-w-md rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      <div className="h-32 w-full max-w-md rounded bg-[var(--bg-panel-hi)] animate-pulse" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile form — name, bio, location, businessName (BUSINESS only)
// ---------------------------------------------------------------------------

function ProfileForm({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (p: SelfProfile) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [location, setLocation] = useState(profile.location ?? '');
  const [businessName, setBusinessName] = useState(profile.businessName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        bio,
        location,
      };
      if (profile.sellerType === 'BUSINESS') body.businessName = businessName;

      const res = await api<ProfileResponse>('/api/users/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved(res.user);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Profile</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Public-facing information that appears on your seller profile.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-[var(--neon-green)]/40 bg-[var(--tint-green)] p-3 text-sm text-[var(--neon-green)]">
          Profile saved.
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={100}
          placeholder="Sydney, NSW"
          className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="flex items-center justify-between text-sm font-medium text-[var(--text-primary)]">
          <span>Bio</span>
          <span className="text-xs font-normal text-[var(--text-dim)]">{bio.length} / 500</span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="A short introduction for buyers on your profile page."
          className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
        />
      </div>

      {profile.sellerType === 'BUSINESS' && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">Business name</label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            maxLength={200}
            className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
          />
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="btn-cyber-primary"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password change form — verifies current password, bumps tokenVersion,
// then forces a fresh login.
// ---------------------------------------------------------------------------

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api<{ message: string }>('/api/users/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Change password</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          You'll be signed out everywhere after changing your password.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="input-cyber mt-1 block w-full max-w-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="input-cyber mt-1 block w-full max-w-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="input-cyber mt-1 block w-full max-w-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={saving}
          className="btn-cyber-primary"
        >
          {saving ? 'Changing...' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Danger zone — soft-delete the account. Requires password + exact phrase.
// Kept in sync with DELETE_ACCOUNT_PHRASE on the server.
// ---------------------------------------------------------------------------

const DELETE_ACCOUNT_PHRASE = 'I confirm the deletion of account';

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const phraseMatches =
    confirmation.trim().toLowerCase() === DELETE_ACCOUNT_PHRASE.toLowerCase();
  const canSubmit = phraseMatches && password.length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await api<{ message: string }>('/api/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ currentPassword: password, confirmation }),
      });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--neon-danger)]">Delete account</h2>
          <p className="mt-1 text-sm text-[var(--neon-danger)]/80">
            Permanently remove your account. Your open orders must be resolved
            first. Your listings are taken off the marketplace. Past orders,
            reviews, and messages remain visible to the people you transacted
            with but show you as &ldquo;Deleted user&rdquo;.
          </p>
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--bg-panel)] px-3 py-2 text-sm font-medium text-[var(--neon-danger)] hover:bg-[var(--tint-danger)]"
          >
            Delete account
          </button>
        )}
      </div>

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-[var(--neon-danger)]">
              Current password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 block w-full max-w-md rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--neon-danger)] focus:outline-none focus:ring-1 focus:ring-[var(--neon-danger)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--neon-danger)]">
              Type{' '}
              <code className="rounded bg-[var(--tint-danger)] px-1 py-0.5 text-xs font-semibold text-[var(--neon-danger)]">
                {DELETE_ACCOUNT_PHRASE}
              </code>{' '}
              to confirm
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={DELETE_ACCOUNT_PHRASE}
              autoComplete="off"
              aria-invalid={confirmation.length > 0 && !phraseMatches}
              className={`mt-1 block w-full max-w-md rounded-lg border bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 ${
                confirmation.length > 0 && !phraseMatches
                  ? 'border-[var(--neon-danger)]/60 focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                  : 'border-[var(--neon-danger)]/40 focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
              }`}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-[var(--neon-danger)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Deleting...' : 'Permanently delete account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setPassword('');
                setConfirmation('');
                setError('');
              }}
              disabled={submitting}
              className="btn-cyber-ghost"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
