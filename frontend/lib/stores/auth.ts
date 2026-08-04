"use client";

import { create } from "zustand";
import { authApi, getAccessToken, setAccessToken } from "../api";
import { talkSocket } from "../ws";
import type { User } from "../types";

const USER_CACHE_KEY = "tc_user";
const AUTH_TIMEOUT_MS = 4_000;

function readCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_CACHE_KEY);
}

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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  hydrated: false,
  loading: false,

  setUser: (user) => {
    writeCachedUser(user);
    set({ user });
  },

  hydrate: async () => {
    const token = getAccessToken();
    if (!token) {
      writeCachedUser(null);
      set({ hydrated: true, token: null, user: null, loading: false });
      return;
    }

    // Instant paint from cache — don't block the UI on Neon round-trips
    const cached = readCachedUser();
    if (cached) {
      set({ user: cached, token, hydrated: true, loading: true });
      talkSocket.connect(token);
    } else {
      set({ loading: true, token });
    }

    try {
      const user = await authApi.me({ timeoutMs: AUTH_TIMEOUT_MS });
      writeCachedUser(user);
      set({ user, hydrated: true, loading: false, token });
      talkSocket.connect(token);
    } catch {
      // If we already have a cached user, avoid blocking the app
      // on slow backend/Neon startup during refresh attempts.
      if (cached) {
        set({ hydrated: true, loading: false });
        return;
      }
      try {
        const refreshed = await authApi.refresh({ timeoutMs: AUTH_TIMEOUT_MS });
        setAccessToken(refreshed.access_token);
        const user = await authApi.me({ timeoutMs: AUTH_TIMEOUT_MS });
        writeCachedUser(user);
        set({
          user,
          token: refreshed.access_token,
          hydrated: true,
          loading: false,
        });
        talkSocket.connect(refreshed.access_token);
      } catch {
        setAccessToken(null);
        writeCachedUser(null);
        talkSocket.disconnect();
        set({ user: null, token: null, hydrated: true, loading: false });
      }
    }
  },

  loginWithToken: async (token) => {
    setAccessToken(token);
    const user = await authApi.me();
    writeCachedUser(user);
    set({ user, token, hydrated: true });
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
    writeCachedUser(null);
    set({ user: null, token: null });
  },
}));
