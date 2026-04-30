const SignalCache = require("../../models/SignalCache");

const EARTH_RADIUS_KM = 6371;

const SOURCE_PRIORITY = {
  authority: 100,
  official: 90,
  verified_feed: 80,
  internal_ingestion: 70,
  dashboard: 60,
  proxy: 30,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function locationHashFromCoords(lat, lon, precision = 2) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return "";
  return `${safeLat.toFixed(precision)}:${safeLon.toFixed(precision)}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recencyWeight(dateLike, now) {
  const date = new Date(dateLike || now);
  if (Number.isNaN(date.getTime())) return 0.25;
  const hours = Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (hours <= 2) return 1;
  if (hours <= 6) return 0.85;
  if (hours <= 24) return 0.64;
  if (hours <= 72) return 0.38;
  return 0.15;
}

function severityScore(entry) {
  if (Number.isFinite(Number(entry?.dangerScore))) {
    return clamp(Number(entry.dangerScore), 0, 100);
  }
  if (Number.isFinite(Number(entry?.severityScore))) {
    return clamp(Number(entry.severityScore), 0, 100);
  }
  switch (String(entry?.severity || "").toLowerCase()) {
    case "critical":
      return 90;
    case "high":
      return 72;
    case "medium":
      return 48;
    default:
      return 26;
  }
}

function extractCoords(entry) {
  const lat = Number(
    entry?.location?.lat ?? entry?.coordinates?.lat ?? entry?.lat ?? null,
  );
  const lon = Number(
    entry?.location?.lon ?? entry?.coordinates?.lon ?? entry?.lon ?? null,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function detectCategory(entry) {
  const haystack = `${entry?.type || ""} ${entry?.title || ""} ${entry?.summary || ""}`.toLowerCase();
  if (/(traffic|jam|congestion|blocked|road|accident|tram|closure|drum|blocat|circulatie)/.test(haystack)) {
    return "mobility";
  }
  if (/(weather|flood|storm|fog|snow|rain|wind|meteo|furtuna|inundat)/.test(haystack)) {
    return "weather";
  }
  if (/(medical|ambulance|hospital|injury|sos|health|smurd|urgenta)/.test(haystack)) {
    return "medical_access";
  }
  if (/(power|network|outage|infrastructure|utility|electric|water|internet|telecom)/.test(haystack)) {
    return "infrastructure";
  }
  if (/(police|protest|violence|security|fire|incident|safety|ordine publica)/.test(haystack)) {
    return "public_safety";
  }
  if (/(alert|authority|official|warning|avertizare)/.test(haystack)) {
    return "official_alerting";
  }
  return "public_safety";
}

function createFactorStatus(score) {
  if (score >= 76) return "Critical";
  if (score >= 56) return "High";
  if (score >= 36) return "Elevated";
  return "Low";
}

function createDirection(score) {
  if (score >= 68) return "up";
  if (score <= 30) return "down";
  return "steady";
}

function classifySignalHealth(signal, now = new Date()) {
  const observedAt = new Date(signal?.observedAt || now);
  const freshUntil = new Date(signal?.freshUntil || now);
  const confidence = clamp(Number(signal?.confidence) || 0, 0, 100);
  const freshnessMinutes = Math.max(0, Math.round((now.getTime() - observedAt.getTime()) / (1000 * 60)));
  const expired = freshUntil.getTime() < now.getTime();

  if (freshnessMinutes > 90 || expired) {
    return {
      status: "stale",
      healthy: false,
      freshnessMinutes,
      confidence,
    };
  }

  if (freshnessMinutes > 15 || confidence < 45) {
    return {
      status: "degraded",
      healthy: false,
      freshnessMinutes,
      confidence,
    };
  }

  return {
    status: "live",
    healthy: true,
    freshnessMinutes,
    confidence,
  };
}

function scoreCategorySignals(signals) {
  if (!signals.length) return 0;
  return clamp(
    Math.round(
      signals.reduce((total, signal) => total + signal.strength, 0) / Math.max(1, signals.length * 0.8),
    ),
    0,
    100,
  );
}

function toSourceHealth(signals, now) {
  const grouped = new Map();
  for (const signal of signals) {
    const key = signal.source;
    const signalHealth = classifySignalHealth(signal, now);
    const bucket = grouped.get(key) || {
      count: 0,
      confidence: 0,
      live: 0,
      degraded: 0,
      stale: 0,
      freshnessMinutes: Number.MAX_SAFE_INTEGER,
    };
    bucket.count += 1;
    bucket.confidence += signalHealth.confidence;
    bucket.freshnessMinutes = Math.min(bucket.freshnessMinutes, signalHealth.freshnessMinutes);
    if (signalHealth.status === "live") bucket.live += 1;
    if (signalHealth.status === "degraded") bucket.degraded += 1;
    if (signalHealth.status === "stale") bucket.stale += 1;
    grouped.set(key, bucket);
  }
  return [...grouped.entries()].map(([source, bucket]) => {
    const confidence = clamp(Math.round(bucket.confidence / Math.max(1, bucket.count)), 0, 100);
    const freshnessMinutes = Number.isFinite(bucket.freshnessMinutes) ? bucket.freshnessMinutes : 9999;
    const status = bucket.live > 0 ? "live" : bucket.degraded > 0 ? "degraded" : "stale";
    const healthy = status === "live";
    return {
      source,
      healthy,
      freshnessMinutes,
      confidence,
      status,
    };
  });
}

function shouldReplaceSignal(previous, next) {
  if (!previous) return true;
  if (Number(next?.sourcePriority) > Number(previous?.sourcePriority)) return true;
  if (Number(next?.sourcePriority) < Number(previous?.sourcePriority)) return false;
  if (Number(next?.confidence) > Number(previous?.confidence)) return true;
  if (Number(next?.confidence) < Number(previous?.confidence)) return false;
  return new Date(next?.observedAt || 0).getTime() > new Date(previous?.observedAt || 0).getTime();
}

function normalizeSignals({ incidents = [], news = [], userLocation = null }) {
  const now = new Date();
  const userCoords = userLocation?.coordinates?.lat != null && userLocation?.coordinates?.lon != null
    ? {
        lat: Number(userLocation.coordinates.lat),
        lon: Number(userLocation.coordinates.lon),
      }
    : null;

  const signalRows = [];

  incidents.forEach((incident) => {
    const coords = extractCoords(incident);
    const baseSeverity = severityScore(incident);
    const recency = recencyWeight(incident.riskUpdatedAt || incident.updatedAt || incident.createdAt, now);
    const distanceKm = userCoords && coords ? haversineKm(userCoords, coords) : null;
    const distanceWeight = distanceKm == null ? 0.55 : clamp(1 - distanceKm / 20, 0.08, 1);
    const category = detectCategory(incident);
    const confidence = clamp(
      Math.round((Number(incident.geoConfidence) || 52) * (Number(incident.relevanceScore) ? 1 : 0.82)),
      25,
      99,
    );
    const observedAt = new Date(incident.riskUpdatedAt || incident.updatedAt || incident.createdAt || now);
    const strength = clamp(Math.round(baseSeverity * recency * distanceWeight), 0, 100);
    signalRows.push({
      source: "internal_ingestion",
      sourcePriority: SOURCE_PRIORITY.internal_ingestion,
      isProxy: false,
      id: String(incident._id || incident.id || ""),
      title: incident.title || "Incident",
      category,
      strength,
      confidence,
      observedAt,
      freshUntil: new Date(observedAt.getTime() + 90 * 60 * 1000),
      geo: coords
        ? {
            ...coords,
            radiusKm: Number(incident?.location?.radiusKm) || 0.5,
            locationHash: locationHashFromCoords(coords.lat, coords.lon),
          }
        : null,
      detail: incident.summary || "",
      payload: incident,
      distanceKm,
    });
  });

  news.forEach((entry) => {
    const baseSeverity = severityScore(entry);
    const recency = recencyWeight(entry.publishedAt || entry.updatedAt || entry.createdAt, now);
    const category = detectCategory(entry);
    const observedAt = new Date(entry.publishedAt || entry.updatedAt || entry.createdAt || now);
    const confidence = clamp(Math.round(42 + recency * 34), 28, 92);
    signalRows.push({
      source: "verified_feed",
      sourcePriority: SOURCE_PRIORITY.verified_feed,
      isProxy: false,
      id: String(entry._id || entry.id || ""),
      title: entry.title || "News signal",
      category,
      strength: clamp(Math.round(baseSeverity * recency * 0.54), 0, 100),
      confidence,
      observedAt,
      freshUntil: new Date(observedAt.getTime() + 4 * 60 * 60 * 1000),
      geo: null,
      detail: entry.summary || "",
      payload: entry,
      distanceKm: null,
    });
  });

  // Always include proxy signals so the UI remains stable if live feeds degrade.
  const proxySignals = [
    {
      source: "proxy",
      sourcePriority: SOURCE_PRIORITY.proxy,
      isProxy: true,
      id: "proxy-mobility",
      title: "Mobility baseline",
      category: "mobility",
      strength: 34,
      confidence: 40,
      observedAt: now,
      freshUntil: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      geo: null,
      detail: "Proxy mobility baseline used while live feeds converge.",
      payload: {},
      distanceKm: null,
    },
    {
      source: "proxy",
      sourcePriority: SOURCE_PRIORITY.proxy,
      isProxy: true,
      id: "proxy-network",
      title: "Network resilience baseline",
      category: "infrastructure",
      strength: 27,
      confidence: 38,
      observedAt: now,
      freshUntil: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      geo: null,
      detail: "Proxy network baseline used when direct telemetry is unavailable.",
      payload: {},
      distanceKm: null,
    },
  ];

  const groupedByDedupe = new Map();
  [...signalRows, ...proxySignals].forEach((signal) => {
    const dedupeKey = `${signal.category}:${signal.id || slugify(signal.title) || "signal"}`;
    const previous = groupedByDedupe.get(dedupeKey);
    if (shouldReplaceSignal(previous, signal)) {
      groupedByDedupe.set(dedupeKey, {
        ...signal,
        dedupeKey,
        overrideOf: previous?.source || "",
      });
    }
  });

  const mergedSignals = [...groupedByDedupe.values()];

  const categoryMap = new Map();
  for (const signal of mergedSignals) {
    const bucket = categoryMap.get(signal.category) || [];
    bucket.push(signal);
    categoryMap.set(signal.category, bucket);
  }

  const factors = [
    ["mobility", "Mobility disruption"],
    ["public_safety", "Public safety"],
    ["weather", "Weather pressure"],
    ["infrastructure", "Infrastructure strain"],
    ["medical_access", "Medical access"],
    ["official_alerting", "Official alerting"],
  ].map(([key, label]) => {
    const signals = categoryMap.get(key) || [];
    const score = scoreCategorySignals(signals);
    const status = createFactorStatus(score);
    const strongest = [...signals].sort((a, b) => b.strength - a.strength)[0];
    return {
      id: `factor-${key}`,
      key,
      category: label,
      score,
      status,
      detail: strongest?.detail || "No strong live signal in this category.",
      direction: createDirection(score),
      contributors: signals
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 3)
        .map((signal) => ({
          signalId: signal.dedupeKey,
          title: signal.title,
          score: signal.strength,
          source: signal.source,
          confidence: signal.confidence,
        })),
    };
  });

  const sourceHealth = toSourceHealth(mergedSignals, now);

  return {
    now: now.toISOString(),
    locationHash:
      userCoords ? locationHashFromCoords(userCoords.lat, userCoords.lon) : "",
    factors,
    signals: mergedSignals,
    sourceHealth,
  };
}

async function persistSignals(signals, locationHash) {
  const now = new Date();
  const operations = signals.map((signal) => {
    const health = classifySignalHealth(signal, now);
    const status = health.status === "stale" ? "stale" : "active";
    return {
      updateOne: {
        filter: { dedupeKey: signal.dedupeKey },
        update: {
          $set: {
            category: signal.category,
            label: signal.title,
            detail: signal.detail,
            score: signal.strength,
            severity: createFactorStatus(signal.strength).toLowerCase(),
            status,
            confidence: signal.confidence,
            source: signal.source,
            sourcePriority: signal.sourcePriority,
            isProxy: Boolean(signal.isProxy),
            overrideOf: signal.overrideOf || "",
            geo: signal.geo
              ? {
                  lat: signal.geo.lat,
                  lon: signal.geo.lon,
                  radiusKm: Number(signal.geo.radiusKm) || 0,
                  locationHash: signal.geo.locationHash || locationHash || "",
                }
              : {
                  lat: null,
                  lon: null,
                  radiusKm: 0,
                  locationHash: locationHash || "",
                },
            freshness: {
              observedAt: signal.observedAt,
              freshUntil: signal.freshUntil,
              lastSeenAt: new Date(),
            },
            payload: signal.payload || {},
          },
          $setOnInsert: {
            dedupeKey: signal.dedupeKey,
          },
        },
        upsert: true,
      },
    };
  });

  if (!operations.length) return;
  await SignalCache.bulkWrite(operations, { ordered: false });
}

module.exports = {
  SOURCE_PRIORITY,
  locationHashFromCoords,
  classifySignalHealth,
  shouldReplaceSignal,
  normalizeSignals,
  persistSignals,
};
