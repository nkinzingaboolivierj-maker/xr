// Thin client for the XR API. The backend is authoritative for prices, tax,
// discounts, stock, payment status, COGS and totals: this module only
// transports requests and normalises failures so every screen can show a
// loading / empty / error / unauthorised / forbidden / offline state.

const TOKEN_KEY = 'xr.session';

// The web UI is hosted on Vercel while the API runs on Railway.
// config.js sets XR_API_BASE. Local/same-origin development leaves it empty.
const API_BASE = typeof globalThis.XR_API_BASE === 'string'
  ? globalThis.XR_API_BASE.replace(/\\/+$/, '')
  : '';
function apiUrl(path) {
  return API_BASE ? new URL(path, `${API_BASE}/`).toString() : path;
}

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', detail = '', requestId = null, extra = null }) {
    super(detail || code);
    this.status = status; this.code = code; this.detail = detail; this.requestId = requestId; this.extra = extra;
  }
  get isNetwork() { return this.code === 'NETWORK'; }
  get isUnauthorized() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
}

export const auth = {
  // sessionStorage: cleared when the tab closes, never sent anywhere automatically.
  get token() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable: session lasts for this page view only */ memoryToken = v; } },
  onUnauthorized: () => {},
};
let memoryToken = null;
function currentToken() { return auth.token || memoryToken; }

function toQuery(query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function request(method, path, { body, query, signal, auth: needsAuth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = currentToken();
  if (needsAuth && token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(apiUrl(path) + toQuery(query), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError({ code: 'NETWORK', detail: 'Cannot reach the server. Check your connection and try again.' });
  }
  if (res.status === 204) return { data: null, json: null, res };
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let p = {};
    try { p = ct.includes('json') ? await res.json() : {}; } catch { /* non-JSON error body */ }
    const err = new ApiError({ status: res.status, code: p.code || `HTTP_${res.status}`, detail: p.detail || p.title || `Request failed (${res.status})`, requestId: p.requestId || res.headers.get('x-request-id'), extra: p });
    // A rejected session ends the session locally; a "password change required" 403 is not a login failure.
    if (res.status === 401 && needsAuth && token) auth.onUnauthorized(err);
    throw err;
  }
  const json = ct.includes('json') ? await res.json() : null;
  return { data: json ? json.data : null, json, res };
}

// Convenience wrappers: return `data` (or the whole envelope for paged/summary endpoints).
export const get = async (path, query, opts) => (await request('GET', path, { query, ...opts })).data;
export const getEnvelope = async (path, query, opts) => (await request('GET', path, { query, ...opts })).json;
export const post = async (path, body, opts) => (await request('POST', path, { body: body || {}, ...opts })).data;
export const patch = async (path, body, opts) => (await request('PATCH', path, { body: body || {}, ...opts })).data;

// Fetches a binary document (PDF) with the bearer token and returns an object URL.
export async function fetchBlobUrl(path) {
  let res;
  try { res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${currentToken()}` } }); }
  catch { throw new ApiError({ code: 'NETWORK', detail: 'Cannot reach the server.' }); }
  if (!res.ok) throw new ApiError({ status: res.status, code: `HTTP_${res.status}`, detail: 'Could not load the document.' });
  return URL.createObjectURL(await res.blob());
}

export function errorMessage(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.isNetwork) return err.detail;
  if (err.status === 403 && err.code === 'PERMISSION_DENIED') return 'You do not have permission to do this.';
  if (err.status === 403 && err.code === 'CROSS_BUSINESS_ACCESS') return 'That record does not belong to your business.';
  if (err.status === 429) return err.detail || 'Too many attempts. Please wait and try again.';
  if (err.status >= 500) return `The server had a problem${err.requestId ? ` (ref ${err.requestId})` : ''}. Please try again.`;
  return err.detail || 'The request was rejected.';
}

export function newOperationId(prefix = 'op') {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return `${prefix}-${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
