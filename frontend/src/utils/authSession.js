const ACCESS_TOKEN_KEY = "accessToken";
const CURRENT_USER_KEY = "currentUser";
const LEGACY_USER_ID_KEY = "userId";
const JWT_PAYLOAD_INDEX = 1;

function safeParseUser(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAccessToken() {
  try {
    return String(localStorage.getItem(ACCESS_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function decodeBase64Url(value) {
  try {
    const normalized = String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return "";
  }
}

export function isTokenExpired(token, skewSeconds = 30) {
  if (!token) return true;
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return false;
    const payloadRaw = decodeBase64Url(parts[JWT_PAYLOAD_INDEX]);
    if (!payloadRaw) return false;
    const payload = JSON.parse(payloadRaw);
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp <= 0) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return exp <= nowSec + Math.max(0, Number(skewSeconds) || 0);
  } catch {
    return false;
  }
}

export function getCurrentUser() {
  try {
    return safeParseUser(localStorage.getItem(CURRENT_USER_KEY));
  } catch {
    return null;
  }
}

export function saveAuthSession({ accessToken, user }) {
  if (!accessToken || !user) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, String(accessToken));
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  const userId = user?.id || user?._id;
  if (userId) {
    localStorage.setItem(LEGACY_USER_ID_KEY, String(userId));
  }
  window.dispatchEvent(new Event("loginSuccess"));
}

export function clearAuthSession({ reason = "manual_logout", dispatchLogout = true } = {}) {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
  localStorage.removeItem(LEGACY_USER_ID_KEY);
  window.dispatchEvent(new CustomEvent("authSessionCleared", { detail: { reason } }));
  if (dispatchLogout) {
    window.dispatchEvent(new Event("logoutSuccess"));
  }
}

export function isAuthenticated() {
  return Boolean(getAccessToken());
}
