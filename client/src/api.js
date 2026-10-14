const TOKEN_KEY = 'pgpSession';
const LEGACY_KEYS = ['fbAutopilotPassword', 'fbAutopilotSession'];

let session = readStored();
let onUnauthorized = () => {};

function readStored() {
  try {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    const raw = localStorage.getItem(TOKEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.token || new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(value) {
  session = value ? { token: value.token, expiresAt: value.expiresAt } : null;
  try {
    if (session) localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode or blocked storage: the session still works until the tab closes.
  }
}

export const hasSession = () => Boolean(session);

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/login') {
    setSession(null);
    onUnauthorized();
    throw new Error(data.error || 'Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
