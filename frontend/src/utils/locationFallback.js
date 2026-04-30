import apiClient from "../api/client";
import { parseLatLon } from "./parseLatLon";

export const MAP_LOCATION_LOCAL_KEY = "mapSavedLocation";

const makeFailure = (reason, error = null) => ({ ok: false, reason, error });
const INSECURE_CONTEXT_SAVED_WARNING =
  "Locația live necesită HTTPS sau localhost. Folosim locația salvată din Hartă.";
const INSECURE_CONTEXT_NO_LOCATION_WARNING =
  "Locația live necesită HTTPS sau localhost, iar nicio locație salvată nu este disponibilă.";

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const makeLabel = (location, fallback = "Locatie salvata") => {
  const name = String(location?.name || location?.label || "").trim();
  const raw = String(location?.raw || "").trim();
  if (name && raw) return `${name} - ${raw}`;
  if (name) return name;
  if (raw) return raw;
  return fallback;
};

export function parseDmsLocation(value) {
  return parseLatLon(value);
}

export function normalizeSOSLocation(input, {
  source = "saved_map",
  resolvedFrom = "mapSavedLocation",
  label = "",
} = {}) {
  const lat = toFiniteNumber(input?.lat ?? input?.coordinates?.lat);
  const lng = toFiniteNumber(input?.lng ?? input?.lon ?? input?.coordinates?.lng ?? input?.coordinates?.lon);
  if (lat == null || lng == null) return null;
  return {
    lat,
    lng,
    lon: lng,
    accuracy: toFiniteNumber(input?.accuracy),
    source,
    label: String(label || input?.label || "").trim() || undefined,
    resolvedFrom,
    timestamp: input?.timestamp || new Date().toISOString(),
  };
}

export function normalizeSavedMapLocation(value, options = {}) {
  const location = typeof value === "string" ? { raw: value } : value;
  if (!location || typeof location !== "object") return null;

  const direct = normalizeSOSLocation(location, {
    source: options.source || "saved_map",
    resolvedFrom: options.resolvedFrom || "mapSavedLocation",
    label: options.label || makeLabel(location),
  });
  if (direct) return direct;

  const rawCoords = parseLatLon(location.raw || location.label || location.name || "");
  if (!rawCoords) return null;
  return normalizeSOSLocation(rawCoords, {
    source: options.source || "manual_map",
    resolvedFrom: options.resolvedFrom || "mapSavedLocation",
    label: options.label || makeLabel(location),
  });
}

export function getBrowserLocation({ timeoutMs = 3000 } = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(makeFailure("gps_unavailable"));
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const normalized = normalizeSOSLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }, {
          source: "gps",
          resolvedFrom: "browser_gps",
          label: "GPS live",
        });
        resolve({ ok: true, location: normalized });
      },
      (error) => {
        if (error?.code === 1) {
          resolve(makeFailure("gps_denied", error));
          return;
        }
        if (error?.code === 3) {
          resolve(makeFailure("gps_timeout", error));
          return;
        }
        resolve(makeFailure("gps_unavailable", error));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export async function getSavedAccountLocation() {
  try {
    const response = await apiClient.get("/api/me/location");
    const location = normalizeSavedMapLocation(response.data?.location, {
      source: "saved_account",
      resolvedFrom: "account_location",
    });
    if (location) return { ok: true, location };
  } catch (error) {
    return makeFailure("api_failed", error);
  }

  try {
    const rawUser = localStorage.getItem("currentUser");
    const user = rawUser ? JSON.parse(rawUser) : null;
    const location = normalizeSavedMapLocation(user?.location, {
      source: "saved_account",
      resolvedFrom: "account_location",
    });
    if (location) return { ok: true, location };
  } catch {
    // Fall through to local map storage.
  }

  return makeFailure("api_failed");
}

export function getLocalMapSavedLocation() {
  try {
    const raw = localStorage.getItem(MAP_LOCATION_LOCAL_KEY);
    if (!raw) return makeFailure("no_saved_location");
    const parsed = JSON.parse(raw);
    const location = normalizeSavedMapLocation(parsed, {
      source: "saved_map",
      resolvedFrom: "mapSavedLocation",
    });
    return location ? { ok: true, location } : makeFailure("no_saved_location");
  } catch (error) {
    return makeFailure("no_saved_location", error);
  }
}

export async function getBestSOSLocation({ timeoutMs = 3000 } = {}) {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    const account = await getSavedAccountLocation();
    if (account.ok) {
      return {
        ...account,
        reason: "insecure_context",
        fallbackReason: "insecure_context",
        warning: INSECURE_CONTEXT_SAVED_WARNING,
      };
    }

    const local = getLocalMapSavedLocation();
    if (local.ok) {
      return {
        ...local,
        reason: "insecure_context",
        fallbackReason: "insecure_context",
        warning: INSECURE_CONTEXT_SAVED_WARNING,
      };
    }

    return {
      ok: false,
      reason: "insecure_context",
      warning: INSECURE_CONTEXT_NO_LOCATION_WARNING,
    };
  }

  const gps = await getBrowserLocation({ timeoutMs });
  if (gps.ok) return { ...gps, warning: "" };

  const account = await getSavedAccountLocation();
  if (account.ok) {
    return { ...account, fallbackReason: gps.reason, warning: warningForFallback(gps.reason, account.location) };
  }

  const local = getLocalMapSavedLocation();
  if (local.ok) {
    return { ...local, fallbackReason: gps.reason, warning: warningForFallback(gps.reason, local.location) };
  }

  return {
    ok: false,
    reason: gps.reason || account.reason || local.reason || "no_saved_location",
    warning: "SOS location unavailable. Alert will be sent without location.",
  };
}

function warningForFallback(reason) {
  if (reason === "insecure_context") {
    return INSECURE_CONTEXT_SAVED_WARNING;
  }
  if (reason === "gps_denied") {
    return "Accesul la locație este blocat. Folosim ultima locație salvată din Hartă.";
  }
  if (reason === "gps_timeout") {
    return "GPS location timed out. Using your last saved Map location.";
  }
  if (reason === "gps_unavailable") {
    return "SOS foloseste ultima locatie salvata din Harta.";
  }
  return "";
}
