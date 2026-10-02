/**
 * Thin fetch wrapper around the EGAN Clinic API.
 *
 * The auth token is kept in localStorage and attached to every request. Errors
 * are normalised into ApiError so callers can react to status codes
 * (403 -> permission denied, 409 -> conflict, etc.).
 */

const TOKEN_KEY = 'egan.clinic.token';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

type Body = Record<string, unknown> | FormData | undefined;

interface RequestOptions {
  method?: string;
  body?: Body;
  query?: Record<string, string | number | boolean | undefined | null>;
  raw?: boolean;
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, raw } = options;
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}${buildQuery(query)}`, { method, headers, body: payload });

  if (raw) return res as unknown as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Request failed', err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: Body) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: Body) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: Body) => apiRequest<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  /** Fetch a binary response (e.g. a PDF) with the auth token attached. */
  blob: async (path: string, query?: RequestOptions['query']): Promise<Blob> => {
    const res = await apiRequest<Response>(path, { raw: true, query });
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Unable to load file');
    return res.blob();
  },
};
