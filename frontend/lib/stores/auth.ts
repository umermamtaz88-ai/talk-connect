"use client";

import { create } from "zustand";
import { authApi, getAccessToken, setAccessToken } from "../api";
import { talkSocket } from "../ws";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  hydrated: boolean;
  loading: boolean;
  setUser: (user: User | null) => void;
  hydrate: () => Promise<void>;
  loginWithToken: (token: string) => Promise<User>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  hydrated: false,
  loading: false,

  setUser: (user) => set({ user }),

  hydrate: async () => {
    const token = getAccessToken();
    if (!token) {
      set({ hydrated: true, token: null, user: null });
      return;
    }
    set({ loading: true, token });
    try {
      const user = await authApi.me();
      set({ user, hydrated: true, loading: false });
      talkSocket.connect(token);
    } catch {
      try {
        const refreshed = await authApi.refresh();
        setAccessToken(refreshed.access_token);
        const user = await authApi.me();
        set({
          user,
          token: refreshed.access_token,
          hydrated: true,
          loading: false,
        });
        talkSocket.connect(refreshed.access_token);
      } catch {
        setAccessToken(null);
        set({ user: null, token: null, hydrated: true, loading: false });
      }
    }
  },

  loginWithToken: async (token) => {
    setAccessToken(token);
    const user = await authApi.me();
    set({ user, token });
    talkSocket.connect(token);
    return user;
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    talkSocket.disconnect();
    setAccessToken(null);
    set({ user: null, token: null });
  },
}));
