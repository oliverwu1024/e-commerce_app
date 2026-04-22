'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
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
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="space-y-8">
      <ProfileForm
        profile={profile}
        onSaved={(updated) => {
          setProfile(updated);
          fetchStoreUser();
        }}
      />
      <div className="border-t border-zinc-200" />
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
      <p className="text-xs text-zinc-400">
        Signed in as {storeUser?.username ?? profile.username}
      </p>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-32 rounded bg-zinc-100 animate-pulse" />
      <div className="h-10 w-full max-w-md rounded bg-zinc-100 animate-pulse" />
      <div className="h-10 w-full max-w-md rounded bg-zinc-100 animate-pulse" />
      <div className="h-32 w-full max-w-md rounded bg-zinc-100 animate-pulse" />
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
        <h2 className="text-lg font-semibold text-zinc-900">Profile</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Public-facing information that appears on your seller profile.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Profile saved.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-zinc-700">Username</label>
          <input
            type="text"
            value={profile.username}
            disabled
            className="mt-1 block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500"
          />
          <p className="mt-1 text-xs text-zinc-400">Usernames can't be changed.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700">Email</label>
          <input
            type="email"
            value={profile.email}
            disabled
            className="mt-1 block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={100}
          placeholder="Sydney, NSW"
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="flex items-center justify-between text-sm font-medium text-zinc-700">
          <span>Bio</span>
          <span className="text-xs font-normal text-zinc-400">{bio.length} / 500</span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="A short introduction for buyers on your profile page."
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {profile.sellerType === 'BUSINESS' && (
        <div>
          <label className="block text-sm font-medium text-zinc-700">Business name</label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            maxLength={200}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
        <h2 className="text-lg font-semibold text-zinc-900">Change password</h2>
        <p className="mt-1 text-sm text-zinc-500">
          You'll be signed out everywhere after changing your password.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-zinc-700">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="mt-1 block w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 block w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 block w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Changing...' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
