const BASE = '/api';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'DOCTOR' | 'ASSISTANT';
  clinicId: number | null; // null = platform (Aatmam) account
  clinicName?: string | null;
}

export function getToken() {
  return localStorage.getItem('cms_token');
}
export function getUser(): AuthUser | null {
  const raw = localStorage.getItem('cms_user');
  return raw ? JSON.parse(raw) : null;
}
export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem('cms_token', token);
  localStorage.setItem('cms_user', JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem('cms_token');
  localStorage.removeItem('cms_user');
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined || options.formData ? 'POST' : 'GET'),
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (res.status === 401) {
    clearAuth();
    if (!location.pathname.startsWith('/login')) {
      location.href = '/login';
      throw new ApiError(401, 'Session expired');
    }
    // If we're on /login, let it fall through to read the actual error from the server.
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? message);
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/**
 * Uploaded files are auth-checked per clinic; <img>/<a> tags can't send an
 * Authorization header, so the JWT rides along as ?token=.
 */
export const fileUrl = (key: string) =>
  `/files/${key}?token=${encodeURIComponent(getToken() ?? '')}`;

export const fmtMoney = (n: number | null | undefined) =>
  `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
