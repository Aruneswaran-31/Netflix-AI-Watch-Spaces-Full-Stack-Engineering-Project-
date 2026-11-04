const TOKEN_KEY = 'watchspaces.tokens.v1';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let tokens = readTokens();
let onUnauthorized = null;
let refreshInFlight = null;

export function getTokens() {
  return tokens;
}

export function setTokens(next) {
  tokens = next || null;
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearTokens() {
  setTokens(null);
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.message || `Request failed (${response.status})`,
      response.status,
      error?.code,
      error?.details
    );
  }
  return payload;
}

async function refreshTokens() {
  if (!tokens?.refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = request('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tokens.refreshToken },
      auth: false,
    })
      .then((next) => {
        setTokens({ ...tokens, ...next });
        return true;
      })
      .catch(() => {
        clearTokens();
        return false;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Same-origin API call with one transparent refresh on a 401. */
export async function api(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    const canRetry = error instanceof ApiError && error.status === 401 && options.auth !== false;
    if (!canRetry || !(await refreshTokens())) {
      if (error.status === 401) onUnauthorized?.();
      throw error;
    }
    return request(path, options);
  }
}

export const apiBase = '/api/v1';
