import { create } from 'zustand';
import { api } from '@/lib/api';
import type { UnreadCount } from '@/types/notifications';

// Polled from the Navbar so bell + envelope badges stay roughly fresh
// without wiring up websockets for Day-20-polish. 60s is a reasonable
// balance between snappiness and noise; we also refetch on window focus
// for the case where the user comes back to the tab after a while.
const POLL_INTERVAL_MS = 60_000;

type InboxState = {
  counts: UnreadCount;
  loaded: boolean;
  pollingStarted: boolean;
  fetchCounts: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

function attachFocusListener(fn: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('focus', fn);
  return () => window.removeEventListener('focus', fn);
}

let detachFocus: (() => void) | null = null;

export const useInboxStore = create<InboxState>((set, get) => ({
  counts: { notifications: 0, messages: 0, orderMessages: 0, inquiryMessages: 0 },
  loaded: false,
  pollingStarted: false,

  fetchCounts: async () => {
    try {
      const res = await api<UnreadCount>('/api/inbox/unread-count');
      set({ counts: res, loaded: true });
    } catch {
      // 401 etc — don't clobber current counts; AuthProvider will reset
      // via the 401 listener if needed.
    }
  },

  startPolling: () => {
    if (get().pollingStarted) return;
    set({ pollingStarted: true });
    // Fire an immediate fetch, then set up interval + focus refresh.
    get().fetchCounts();
    pollTimer = setInterval(() => {
      get().fetchCounts();
    }, POLL_INTERVAL_MS);
    detachFocus = attachFocusListener(() => get().fetchCounts());
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (detachFocus) {
      detachFocus();
      detachFocus = null;
    }
    set({ pollingStarted: false });
  },

  reset: () => {
    set({ counts: { notifications: 0, messages: 0 }, loaded: false });
  },
}));
