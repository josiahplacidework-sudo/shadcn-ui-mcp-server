/**
 * Supabase auth and data access, over plain fetch.
 *
 * The official `@supabase/supabase-js` client would be the obvious choice and is deliberately
 * not used: `scripts/build.mjs` inlines relative imports between local modules and cannot
 * resolve an npm dependency, so importing it would mean adopting a real bundler and giving up
 * the single-file build the whole project is organised around. What the app actually needs from
 * that client is four auth endpoints and PostgREST, both of which are ordinary REST.
 *
 * Config is injected at build time from environment variables — see scripts/build.mjs. The
 * publishable key is public by design; it identifies the project and grants nothing on its own.
 * Every table is protected by row-level security keyed to the caller's JWT, so what a signed-in
 * user can read is decided by the database, not by this file.
 */

/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__ */

/** Replaced at build time. The `typeof` guard keeps `npm run serve` working without a build. */
export const SUPABASE_URL =
  typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '';
export const SUPABASE_ANON_KEY =
  typeof __SUPABASE_ANON_KEY__ === 'string' ? __SUPABASE_ANON_KEY__ : '';

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Where the session lives.
 *
 * localStorage rather than sessionStorage: a phone user who switches apps and comes back should
 * still be signed in. The refresh token here is why the app can never be a pure static file
 * with no origin — see the note about file:// in README.
 */
const SESSION_KEY = 'resellai.session.v1';

let session = null;
let refreshTimer = null;

/** Read the persisted session on startup. A malformed blob is discarded rather than thrown. */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  if (session) scheduleRefresh();
  return session;
}

export function getSession() {
  return session;
}

export function getUser() {
  return session?.user ?? null;
}

export function getAccessToken() {
  return session?.access_token ?? null;
}

function persist(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // A full or blocked localStorage costs persistence across reloads, not the current session.
  }
  scheduleRefresh();
}

/**
 * Refresh a minute before expiry.
 *
 * Without this a user who leaves the app open past the token lifetime gets a 401 on their next
 * action — which, on a scan, means losing the photo they just took.
 */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.expires_at) return;
  const msUntilRefresh = session.expires_at * 1000 - Date.now() - 60_000;
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => signOut());
  }, Math.max(5_000, msUntilRefresh));
}

function authHeaders() {
  return { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' };
}

/** Supabase returns its errors under several different keys depending on the endpoint. */
async function readError(response, fallback) {
  try {
    const body = await response.json();
    return body?.error_description || body?.msg || body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
}

function storeSession(body) {
  persist({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at ?? Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
    user: body.user ?? null,
  });
  return session;
}

export async function signUp(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not create that account.'));

  const body = await response.json();
  // With email confirmation switched on, signup succeeds but issues no token. Say so plainly
  // rather than dropping the user on a blank screen.
  if (!body.access_token) {
    return { confirmationRequired: true, email };
  }
  storeSession(body);
  return { confirmationRequired: false, session };
}

export async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'That email and password did not match.'));
  }
  return storeSession(await response.json());
}

export async function refreshSession() {
  if (!session?.refresh_token) throw new Error('No session to refresh');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) throw new Error('Session expired');
  return storeSession(await response.json());
}

export function signOut() {
  // Best-effort server-side revoke; the local session is cleared either way, so a network
  // failure can never leave someone looking signed in on a shared device.
  if (session?.access_token) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...authHeaders(), authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  persist(null);
}

/** A PostgREST request carrying the user's JWT, so RLS scopes it to their own rows. */
async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!session?.access_token) throw new Error('Not signed in');

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };
  if (prefer) headers.prefer = prefer;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    // One retry after a refresh: a token that expired between the schedule and the request is
    // an expected race, not an error worth showing anyone.
    await refreshSession();
    return rest(path, { method, body, prefer });
  }
  if (!response.ok) throw new Error(await readError(response, `Request failed (${response.status})`));
  if (response.status === 204) return null;
  return response.json();
}

export const db = {
  listItems: () => rest('items?select=*&order=created_at.desc'),
  insertItem: (row) => rest('items', { method: 'POST', body: row, prefer: 'return=representation' }),
  updateItem: (id, patch) =>
    rest(`items?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
      prefer: 'return=representation',
    }),
  deleteItem: (id) => rest(`items?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getProfile: () => rest('profiles?select=*&limit=1'),
  updateProfile: (patch) =>
    rest(`profiles?id=eq.${encodeURIComponent(session.user.id)}`, { method: 'PATCH', body: patch }),
  /** Today's scan count, so the UI can show the allowance without waiting for a 429. */
  scansToday: () => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return rest(`scans?select=id&created_at=gte.${start.toISOString()}`);
  },
};

/** Endpoint for the recognize edge function, which holds the Anthropic key. */
export const recognizeUrl = () => `${SUPABASE_URL}/functions/v1/recognize`;
