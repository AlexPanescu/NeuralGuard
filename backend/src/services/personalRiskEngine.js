const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const EARTH_RADIUS_KM = 6371;

const toRadians = (value) => (value * Math.PI) / 180;

function haversineKm(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function recencyMultiplier(dateLike, now) {
  const at = new Date(dateLike || now);
  if (Number.isNaN(at.getTime())) return 0.25;
  const diffHours = Math.max(0, (now.getTime() - at.getTime()) / (1000 * 60 * 60));
  if (diffHours <= 2) return 1;
  if (diffHours <= 6) return 0.82;
  if (diffHours <= 24) return 0.6;
  if (diffHours <= 72) return 0.35;
  return 0.12;
}

function incidentStatusMultiplier(status) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return 1;
    case "open":
      return 0.88;
    case "monitoring":
      return 0.6;
    case "contained":
      return 0.35;
    case "resolved":
      return 0;
    default:
      return 0.55;
  }
}

function distanceInfluence(distanceKm, radiusKm) {
  const safeRadius = Math.max(0.1, Number(radiusKm) || 0);
  if (distanceKm <= safeRadius) return 1;
  if (distanceKm <= safeRadius * 2) {
    return clamp(1 - (distanceKm - safeRadius) / safeRadius, 0, 1) * 0.65;
  }
  return 0;
}

function severityFromIncident(incident) {
  if (Number.isFinite(Number(incident?.dangerScore))) {
    return clamp(Number(incident.dangerScore), 0, 100);
  }
  switch (String(incident?.severity || "").toLowerCase()) {
    case "critical":
      return 90;
    case "high":
      return 72;
    case "medium":
      return 48;
    default:
      return 28;
  }
}

function extractIncidentGeo(incident) {
  const latCandidates = [
    incident?.location?.lat,
    incident?.coordinates?.lat,
    incident?.lat,
  ];
  const lonCandidates = [
    incident?.location?.lon,
    incident?.coordinates?.lon,
    incident?.lon,
  ];
  const lat = latCandidates.map(Number).find(Number.isFinite);
  const lon = lonCandidates.map(Number).find(Number.isFinite);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const radiusCandidates = [
    incident?.location?.radiusKm,
    incident?.location?.radius,
    incident?.radiusKm,
    incident?.radius,
  ];
  const radius = radiusCandidates.map(Number).find(Number.isFinite);
  return {
    center: { lat, lon },
    radiusKm: Math.max(0.1, Number.isFinite(radius) ? radius : 0.5),
  };
}

function normalizeIncidentSignal(incident, userCoords, now) {
  const geo = extractIncidentGeo(incident);
  if (!geo) return null;
  const distanceKm = haversineKm(userCoords, geo.center);
  const radiusKm = geo.radiusKm;
  const severityScore = severityFromIncident(incident);
  const influence = distanceInfluence(distanceKm, radiusKm);
  if (influence <= 0) return null;
  return {
    type: "incident",
    title: incident.title || "Incident",
    distanceKm,
    radiusKm,
    influence,
    severityScore,
    recency: recencyMultiplier(incident.riskUpdatedAt || incident.updatedAt || incident.createdAt, now),
    activity: incidentStatusMultiplier(incident.status),
    raw: incident,
  };
}

function normalizeNewsSignal(newsItem, userCoords, now) {
  const severityScore = clamp(Number(newsItem?.severityScore) || 0, 0, 100);
  const recency = recencyMultiplier(newsItem?.publishedAt || newsItem?.updatedAt || newsItem?.createdAt, now);
  return {
    type: "news",
    title: newsItem?.title || "News",
    distanceKm: null,
    radiusKm: 0,
    influence: 0.22,
    severityScore,
    recency,
    activity: newsItem?.status === "active" ? 1 : 0.4,
    raw: newsItem,
  };
}

function scoreBand(score) {
  if (score >= 76) return "Critical";
  if (score >= 51) return "High";
  if (score >= 26) return "Medium";
  return "Low";
}

function directionForScore(score) {
  if (score >= 70) return "up";
  if (score <= 30) return "down";
  return "steady";
}

function buildExplanation(label, topSignals, score) {
  const names = topSignals.slice(0, 2).map((item) => item.title).filter(Boolean);
  if (!names.length) {
    return `${label} remains limited because no strong nearby signals are active right now.`;
  }
  const joined = names.join(" and ");
  if (label === "Hazard") {
    return `${joined} are the strongest nearby risk sources shaping the current local hazard picture.`;
  }
  if (label === "Exposure") {
    return `Your saved location overlaps with the impact area influenced by ${joined}.`;
  }
  if (label === "Vulnerability") {
    return `Distance to ${joined} increases the chance that a disruption would affect your immediate safety.`;
  }
  if (label === "Immediacy") {
    return `${joined} are recent enough that waiting could reduce your ability to react in time.`;
  }
  return `${joined} are contributing to a ${score}/100 score.`;
}

function toDriver(id, label, score, topSignals) {
  return {
    id,
    label,
    score,
    direction: directionForScore(score),
    explanation: buildExplanation(label, topSignals, score),
  };
}

// Legacy scorer retained for compatibility; the active personal-risk endpoint uses
// riskSnapshotService.computePersonalRiskV2 instead.
function computeWeightedRisk({ incidents = [], news = [], userLocation }) {
  const now = new Date();
  const coords = userLocation?.coordinates?.lat != null && userLocation?.coordinates?.lon != null
    ? { lat: Number(userLocation.coordinates.lat), lon: Number(userLocation.coordinates.lon) }
    : null;

  if (!coords) {
    return {
      locationReady: false,
      riskStatus: {
        level: "Location required",
        score: 0,
        trend: "Unknown",
        summary: "Save your location to calculate nearby hazard, exposure, vulnerability, and immediacy.",
        lastUpdated: now.toISOString(),
        locationLabel: "",
        confidence: "Waiting for location",
      },
      riskDrivers: [],
      scoringMeta: {
        incidentsUsed: 0,
        newsUsed: 0,
        lastComputedAt: now.toISOString(),
      },
    };
  }

  const incidentSignals = incidents
    .map((item) => normalizeIncidentSignal(item, coords, now))
    .filter(Boolean);
  const newsSignals = news
    .map((item) => normalizeNewsSignal(item, coords, now))
    .filter(Boolean);
  const signals = [...incidentSignals, ...newsSignals];

  const hazardSignals = signals
    .map((signal) => signal.severityScore * signal.influence * signal.recency * signal.activity)
    .sort((a, b) => b - a);
  const hazard = clamp(
    Math.round(hazardSignals.reduce((total, value) => total + value, 0)),
    0,
    100,
  );

  const exposure = clamp(
    Math.round(signals.reduce((total, signal) => total + signal.influence * (signal.severityScore / 100) * 45, 0)),
    0,
    100,
  );

  const vulnerability = clamp(
    Math.round(
      signals.reduce((total, signal) => {
        const depth = signal.distanceKm == null
          ? 0.08
          : clamp((Math.max(signal.radiusKm, 0.1) - signal.distanceKm) / Math.max(signal.radiusKm, 0.1), 0, 1);
        return total + depth * (signal.severityScore / 100) * 38;
      }, 8),
    ),
    0,
    100,
  );

  const immediacy = clamp(
    Math.round(
      signals.reduce((total, signal) => total + signal.recency * signal.activity * (signal.severityScore / 100) * 32, 0),
    ),
    0,
    100,
  );

  const overall = clamp(
    Math.round(hazard * 0.4 + exposure * 0.25 + vulnerability * 0.15 + immediacy * 0.2),
    0,
    100,
  );

  const topSignals = [...signals]
    .sort(
      (a, b) =>
        b.severityScore * b.influence * b.recency * b.activity -
        a.severityScore * a.influence * a.recency * a.activity,
    )
    .slice(0, 3);

  const riskDrivers = [
    toDriver("hazard", "Hazard", hazard, topSignals),
    toDriver("exposure", "Exposure", exposure, topSignals),
    toDriver("vulnerability", "Vulnerability", vulnerability, topSignals),
    toDriver("immediacy", "Immediacy", immediacy, topSignals),
  ];

  return {
    locationReady: true,
    riskStatus: {
      level: scoreBand(overall),
      score: overall,
      trend: immediacy >= 65 || hazard >= 70 ? "Increasing" : overall <= 25 ? "Decreasing" : "Stable",
      summary: topSignals.length
        ? `${topSignals.map((item) => item.title).slice(0, 2).join(" and ")} are the main signals behind your current local risk.`
        : "No strong nearby risk signals are active around your saved location.",
      lastUpdated: now.toISOString(),
      locationLabel: userLocation?.name || userLocation?.raw || "Saved location",
      confidence: signals.length >= 3 ? "Multiple sources" : signals.length ? "Limited sources" : "Low activity",
    },
    riskDrivers,
    scoringMeta: {
      incidentsUsed: incidentSignals.length,
      newsUsed: newsSignals.length,
      lastComputedAt: now.toISOString(),
    },
  };
}

module.exports = {
  computeWeightedRisk,
};
