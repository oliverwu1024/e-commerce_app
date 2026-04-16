import { create } from 'zustand';
import { api } from '@/lib/api';

type SavedState = {
  ids: Set<string>;
  loaded: boolean;
  fetchSavedIds: () => Promise<void>;
  toggle: (listingId: string) => Promise<void>;
  isSaved: (listingId: string) => boolean;
};

export const useSavedStore = create<SavedState>((set, get) => ({
  ids: new Set(),
  loaded: false,

  fetchSavedIds: async () => {
    try {
      const data = await api<{ ids: string[] }>('/api/saved/ids');
      set({ ids: new Set(data.ids), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  toggle: async (listingId: string) => {
    const { ids } = get();
    const wasSaved = ids.has(listingId);

    // Optimistic update
    const next = new Set(ids);
    if (wasSaved) {
      next.delete(listingId);
    } else {
      next.add(listingId);
    }
    set({ ids: next });

    try {
      if (wasSaved) {
        await api(`/api/saved/${listingId}`, { method: 'DELETE' });
      } else {
        await api(`/api/saved/${listingId}`, { method: 'POST' });
      }
    } catch {
      // Revert on failure
      set({ ids });
    }
  },

  isSaved: (listingId: string) => get().ids.has(listingId),
}));
