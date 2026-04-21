import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Cart } from '@/types/orders';

const EMPTY_CART: Cart = {
  items: [],
  subtotal: '0.00',
  itemCount: 0,
  checkoutableCount: 0,
};

type CartState = {
  cart: Cart;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetchCart: () => Promise<void>;
  add: (listingId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (listingId: string) => Promise<void>;
  reset: () => void;
  isInCart: (listingId: string) => boolean;
};

export const useCartStore = create<CartState>((set, get) => ({
  cart: EMPTY_CART,
  loaded: false,
  loading: false,
  error: null,

  // Cart GETs are cheap, so we don't dedupe concurrent fetches — dedupe
  // swallowed post-add refetches when a mount-fetch was still in flight.
  fetchCart: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api<{ cart: Cart }>('/api/cart');
      set({ cart: data.cart, loaded: true, loading: false });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : 'Failed to load cart',
      });
    }
  },

  add: async (listingId: string) => {
    try {
      await api('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ listingId }),
      });
      await get().fetchCart();
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add to cart';
      return { ok: false as const, error: message };
    }
  },

  remove: async (listingId: string) => {
    // Optimistic: drop the row immediately. On failure refetch the cart
    // (rather than replaying a stale snapshot, which doesn't compose safely
    // with a second concurrent remove) and surface the error.
    const prev = get().cart;
    const nextItems = prev.items.filter((i) => i.listing.id !== listingId);
    const nextCheckoutable = nextItems.filter((i) => i.listing.status === 'ACTIVE');
    const nextSubtotal = nextCheckoutable
      .reduce((sum, i) => sum + Number(i.listing.price), 0)
      .toFixed(2);

    set({
      error: null,
      cart: {
        items: nextItems,
        itemCount: nextItems.length,
        checkoutableCount: nextCheckoutable.length,
        subtotal: nextSubtotal,
      },
    });

    try {
      await api(`/api/cart/items/${listingId}`, { method: 'DELETE' });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to remove item',
      });
      await get().fetchCart();
    }
  },

  reset: () => set({ cart: EMPTY_CART, loaded: false, error: null }),

  isInCart: (listingId: string) =>
    get().cart.items.some((i) => i.listing.id === listingId),
}));
