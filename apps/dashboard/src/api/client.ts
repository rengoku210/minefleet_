let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('accessToken', token);
    else localStorage.removeItem('accessToken');
  }
}

export function getAccessToken(): string | null {
  if (!accessToken && typeof localStorage !== 'undefined') {
    accessToken = localStorage.getItem('accessToken');
  }
  return accessToken;
}

const getBaseUrl = (): string => {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string> };
    const envUrl = meta?.env?.VITE_CONTROLLER_URL;
    return envUrl ? envUrl.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
};

async function refreshToken(): Promise<boolean> {
  try {
    const url = `${getBaseUrl()}/api/auth/refresh`;
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    setAccessToken(data.data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const fullUrl = path.startsWith('http') ? path : `${getBaseUrl()}${path}`;
  let res = await fetch(fullUrl, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && token) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`;
      res = await fetch(path, { ...options, headers, credentials: 'include' });
    }
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || 'API error');
  return data.data;
}
