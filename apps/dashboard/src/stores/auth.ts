import { create } from 'zustand';
import { api, setAccessToken, getAccessToken } from '../api/client.js';

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email: string, password: string) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(data.accessToken);
    set({ user: data.user });
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setAccessToken(null);
    set({ user: null });
  },

  checkAuth: async () => {
    const token = getAccessToken();
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const data = await api('/api/auth/me');
      set({ user: data, loading: false });
    } catch {
      setAccessToken(null);
      set({ user: null, loading: false });
    }
  },
}));
