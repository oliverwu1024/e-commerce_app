import { create } from 'zustand';
import { api } from '@/lib/api';

export type User = {
  id: string;
  email: string;
  username: string;
  name: string;
  location: string | null;
  bio: string | null;
  avatarUrl: string | null;
  sellerType: 'PERSONAL' | 'BUSINESS';
  businessName: string | null;
  role: 'USER' | 'ADMIN';
  emailVerified: boolean;
  createdAt?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  register: (data: RegisterData) => Promise<{
    verificationEmailSent: boolean;
    devVerificationUrl?: string;
  }>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  resendVerification: () => Promise<{
    verificationEmailSent: boolean;
    devVerificationUrl?: string;
  }>;
  clearError: () => void;
};

type RegisterData = {
  email: string;
  username: string;
  password: string;
  name: string;
  location?: string;
  bio?: string;
  sellerType?: 'PERSONAL' | 'BUSINESS';
  businessName?: string;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  register: async (data) => {
    set({ error: null });
    try {
      const res = await api<{
        user: User;
        verificationEmailSent?: boolean;
        devVerificationUrl?: string;
      }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
      set({ user: res.user });
      // Default true for forwards compatibility: an older server (pre-fix)
      // simply omits the field, and the legacy behaviour was non-blocking.
      return {
        verificationEmailSent: res.verificationEmailSent ?? true,
        devVerificationUrl: res.devVerificationUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      set({ error: message });
      throw err;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      set({ user: res.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout API call failed (clearing local state anyway):', err);
    }
    set({ user: null });
  },

  fetchUser: async () => {
    try {
      const res = await api<{ user: User }>('/api/auth/me');
      set({ user: res.user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  resendVerification: async () => {
    set({ error: null });
    try {
      const res = await api<{
        message: string;
        verificationEmailSent?: boolean;
        devVerificationUrl?: string;
      }>('/api/auth/resend-verification', { method: 'POST' });
      return {
        verificationEmailSent: res.verificationEmailSent ?? true,
        devVerificationUrl: res.devVerificationUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend verification email';
      set({ error: message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
