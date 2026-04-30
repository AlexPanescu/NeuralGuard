const RiskSnapshot = require("../../models/RiskSnapshot");
const { normalizeSignals, persistSignals } = require("./signalFusionService");

const RISK_EVALUATION_VERSION = "v2.0.3";
const LEGACY_DRIVER_WEIGHTS = {
  hazard: 0.35,
  exposure: 0.25,
  vulnerability: 0.20,
  immediacy: 0.20,
};

const EARTH_RADIUS_KM = 6371;
const RECOGNIZED_STATUSES = new Set(["active", "open", "monitoring", "contained", "resolved", "acknowledged", "responding"]);
const STATUS_MULTIPLIERS = {
  active: 1,
  acknowledged: 1,
  responding: 1,
  open: 0.85,
  monitoring: 0.55,
  contained: 0.25,
  resolved: 0,
};
const SEVERITY_SCORES = {
  critical: 90,
  high: 70,
  medium: 45,
  low: 20,
};
const AGGREGATION_WEIGHTS = [1, 0.35, 0.20];
const REMAINING_SIGNALS_WEIGHT = 0.10;
const REMAINING_SIGNALS_MAX_CONTRIBUTION = 15;
const NO_DIRECT_SAFETY_MAX_SCORE = 74;
const UNCONFIRMED_SOS_SINGLE_CAP = 55;
const UNCONFIRMED_SOS_CLUSTER_CAP = 65;
const UNCONFIRMED_SOS_CRITICAL_BLOCK = true;
const SOS_CLUSTER_RADIUS_KM = 1;
const SOS_CLUSTER_WINDOW_MINUTES = 60;
const SOS_DUPLICATE_WEIGHT = 0.12;
const POLICE_SIGNAL_MAX_REDUCTION = 4;
const POLICE_TOTAL_MAX_REDUCTION = 8;
const NOT_COUNTED_LIMIT = 5;
const SOURCE_HEALTH_NOTE = "sourceHealth is informational only and does not modify the v2 risk score.";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
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

function locationHashFromUserLocation(userLocation) {
  const lat = Number(userLocation?.coordinates?.lat);
  const lon = Number(userLocation?.coordinates?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  return `${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

function extractUserCoords(userLocation) {
  const lat = Number(userLocation?.coordinates?.lat);
  const lon = Number(userLocation?.coordinates?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function extractIncidentCoords(incident) {
  const lat = Number(incident?.location?.lat ?? incident?.coordinates?.lat ?? incident?.lat);
  const lon = Number(incident?.location?.lon ?? incident?.coordinates?.lon ?? incident?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function signalIdForIncident(incident) {
  return String(incident?._id || incident?.id || incident?.sourceKey || "");
}

function severityScore(incident) {
  if (Number.isFinite(Number(incident?.dangerScore))) {
    return applyContextualSeverityCap(incident, clamp(Number(incident.dangerScore), 0, 100));
  }
  const severity = String(incident?.severity || "medium").toLowerCase();
  return applyContextualSeverityCap(incident, SEVERITY_SCORES[severity] || SEVERITY_SCORES.medium);
}

function applyContextualSeverityCap(incident, score) {
  const type = String(incident?.type || "").toLowerCase();
  const text = `${incident?.title || ""} ${incident?.summary || ""} ${incident?.normalizedText || ""}`.toLowerCase();

  if (
    type === "traffic_jam" ||
    /\b(jam|congestion|ambuteiaj)\b/.test(text) ||
    /trafic\s+aglomerat/.test(text)
  ) {
    return Math.min(score, 25);
  }

  if (
    type === "traffic" &&
    /(ingreunat|aglomerat|circulatie dirijata|se circula dirijat)/.test(text) &&
    !/(accident|victim|ranit|decedat|incendiu|explozie|blocat complet|blocata complet)/.test(text)
  ) {
    return Math.min(score, 40);
  }

  if (type === "police" || /politie in zona/.test(text)) {
    return 0;
  }

  if (type === "construction" || /(lucrari|roadworks|construction)/.test(text)) {
    return Math.min(score, 30);
  }

  if (type === "road_closed" || /(drum inchis|road closed|blocked road)/.test(text)) {
    return Math.min(score, 65);
  }

  return score;
}

function isPoliceMitigationSignal(incident) {
  const type = String(incident?.type || incident?.category || incident?.raw?.type || "").toLowerCase();
  const text = `${incident?.title || ""} ${incident?.summary || incident?.normalizedText || ""} ${incident?.raw?.summary || ""} ${incident?.raw?.normalizedText || ""}`.toLowerCase();
  return (
    type === "police" ||
    /\b(police|politie|poliție|echipaj|patrol|patrula|patrulă)\b/.test(text) ||
    /politie in zona/.test(text)
  );
}

function recencyMultiplier(dateLike, now) {
  if (!dateLike) return 0.25;
  const at = new Date(dateLike);
  if (Number.isNaN(at.getTime())) return 0.25;
  const hours = Math.max(0, (now.getTime() - at.getTime()) / (1000 * 60 * 60));
  if (hours <= 2) return 1;
  if (hours <= 6) return 0.8;
  if (hours <= 24) return 0.55;
  if (hours <= 72) return 0.25;
  return 0.1;
}

function recencyLabel(dateLike, now) {
  if (!dateLike) return "time unknown; recency reduced";
  const at = new Date(dateLike);
  if (Number.isNaN(at.getTime())) return "time unknown; recency reduced";
  const hours = Math.max(0, (now.getTime() - at.getTime()) / (1000 * 60 * 60));
  if (hours <= 2) return "fresh, under 2 hours old";
  if (hours <= 6) return "recent, under 6 hours old";
  if (hours <= 24) return "same-day signal";
  if (hours <= 72) return "older signal; recency reduced";
  return "stale signal; recency heavily reduced";
}

function radiusKmForIncident(incident) {
  const radius = Number(incident?.location?.radiusKm ?? incident?.location?.radius ?? incident?.radiusKm ?? incident?.radius);
  return Math.max(0.5, Number.isFinite(radius) ? radius : 0.5);
}

function proximityMultiplier(distanceKm, radiusKm) {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(radiusKm)) return 0;
  if (distanceKm <= radiusKm) return 1;
  return clamp(1 - (distanceKm - radiusKm) / 5, 0, 1);
}

function proximityLabel(distanceKm, radiusKm, proximity) {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(radiusKm)) return "distance unknown; proximity reduced";
  if (proximity <= 0) return "outside the scoring range";
  if (distanceKm <= radiusKm) return "inside the incident impact radius";
  return "outside the impact radius; contribution reduced by distance";
}

function aggregationBreakdownFor(sortedSignals) {
  let remainingContribution = 0;
  return sortedSignals.map((signal, index) => {
    const weight = index < AGGREGATION_WEIGHTS.length ? AGGREGATION_WEIGHTS[index] : REMAINING_SIGNALS_WEIGHT;
    const uncappedContribution = signal.signalRisk * weight;
    let weightedContribution = uncappedContribution;
    if (index >= AGGREGATION_WEIGHTS.length) {
      const allowance = Math.max(0, REMAINING_SIGNALS_MAX_CONTRIBUTION - remainingContribution);
      weightedContribution = Math.min(uncappedContribution, allowance);
      remainingContribution += weightedContribution;
    }
    return {
      signalId: signal.id,
      title: signal.title,
      source: signal.source,
      rawSignalRisk: Number(signal.signalRisk.toFixed(2)),
      aggregationWeight: weight,
      weightedContribution: Number(weightedContribution.toFixed(2)),
      capped: index >= AGGREGATION_WEIGHTS.length && weightedContribution < uncappedContribution,
    };
  });
}

function mitigationBreakdownFor(signals) {
  return signals
    .filter((signal) => signal.isMitigation && signal.mitigationValue > 0)
    .map((signal) => ({
      signalId: signal.id,
      title: signal.title,
      type: "police_presence",
      reduction: Number(signal.mitigationValue.toFixed(2)),
    }));
}

function aggregateSignals(signals) {
  const riskSignals = signals.filter((signal) => !signal.isMitigation);
  const mitigationBreakdown = mitigationBreakdownFor(signals);

  if (!riskSignals.length) {
    return {
      score: 0,
      topSignalValue: 0,
      aggregationBreakdown: [],
      mitigationBreakdown,
      mitigationTotal: 0,
      scoreBeforeMitigation: 0,
      mitigationNote: "Police presence is a small mitigation signal; it can reduce but never increase personal risk.",
    };
  }

  const sorted = [...riskSignals].sort((a, b) => b.signalRisk - a.signalRisk);
  const aggregationBreakdown = aggregationBreakdownFor(sorted);
  const total = aggregationBreakdown.reduce((sum, item) => sum + item.weightedContribution, 0);
  const directSafetySignals = riskSignals.filter(isDirectSafetySignal);
  const hasDirectSafetySignal = directSafetySignals.length > 0;
  const cappedTotal = hasDirectSafetySignal ? total : Math.min(total, NO_DIRECT_SAFETY_MAX_SCORE);
  const mitigationTotal = Math.min(
    POLICE_TOTAL_MAX_REDUCTION,
    cappedTotal,
    mitigationBreakdown.reduce((sum, item) => sum + item.reduction, 0),
  );
  const adjustedTotal = Math.max(0, cappedTotal - mitigationTotal);
  return {
    score: clamp(Math.round(adjustedTotal), 0, 100),
    topSignalValue: Number(sorted[0].signalRisk.toFixed(2)),
    aggregationBreakdown,
    aggregationCap: !hasDirectSafetySignal && total > NO_DIRECT_SAFETY_MAX_SCORE
      ? {
          reason: "no_direct_safety_signal",
          maxScore: NO_DIRECT_SAFETY_MAX_SCORE,
          uncappedScore: Number(total.toFixed(2)),
        }
      : null,
    hasDirectSafetySignal,
    directSafetySignals: directSafetySignals.slice(0, 3).map((signal) => ({
      title: signal.title,
      type: signal.category,
      signalRisk: Number(signal.signalRisk.toFixed(2)),
    })),
    mitigationBreakdown,
    mitigationTotal: Number(mitigationTotal.toFixed(2)),
    scoreBeforeMitigation: Number(cappedTotal.toFixed(2)),
    mitigationNote: "Police presence is a small mitigation signal; it can reduce but never increase personal risk.",
  };
}

function withScoreOverride(scoreResult, nextScore, override = {}) {
  const score = clamp(Math.round(nextScore), 0, 100);
  return {
    ...scoreResult,
    ...override,
    score,
    scoreBeforeMitigation: Number((override.scoreBeforeMitigation ?? scoreResult.scoreBeforeMitigation ?? nextScore).toFixed(2)),
  };
}

function isDirectSafetySignal(signal) {
  const type = String(signal?.category || signal?.raw?.type || "").toLowerCase();
  const text = `${signal?.title || ""} ${signal?.raw?.summary || ""} ${signal?.raw?.normalizedText || ""}`.toLowerCase();
  if (["fire", "medical", "security"].includes(type)) return true;
  return /\b(fire|incendiu|explozie|medical|ambulanta|smurd|victima|victime|ranit|raniti|decedat|decedati|mort|morti|security|agresiune|violenta|arma|arme|cutit|impuscat|cod rosu|evacuare)\b/.test(text);
}

function isSosSignal(signal) {
  return String(signal?.source || signal?.raw?.source || "").toLowerCase() === "sos";
}

function isClusterableSosSignal(signal) {
  return isSosSignal(signal) && ["active", "open"].includes(String(signal?.status || "").toLowerCase());
}

function isDirectSevereCategory(signal) {
  const type = String(signal?.category || signal?.raw?.type || "").toLowerCase();
  return ["fire", "medical", "security"].includes(type);
}

function hasOperatorConfirmation(signal) {
  const raw = signal?.raw || {};
  if (raw.operatorConfirmed === true || raw?.ingestionMeta?.operatorConfirmed === true) return true;
  const status = String(raw.status || signal?.status || "").toLowerCase();
  if (["acknowledged", "responding"].includes(status)) return true;
  const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  return timeline.some((entry) => {
    const kind = String(entry?.kind || "").toLowerCase();
    const message = String(entry?.message || "").toLowerCase();
    return (
      /(acknowledged|responding|confirmed|confirmation)/.test(kind) ||
      /(confirmat|confirmata|confirmare|acknowledged|responding|confirmed|operator)/.test(message)
    );
  });
}

function hasSevereDirectOverride(signal) {
  return isDirectSevereCategory(signal) && Number(signal?.raw?.dangerScore ?? signal?.severity) >= 85;
}

function isUnconfirmedSosSignal(signal) {
  return isSosSignal(signal) && !hasOperatorConfirmation(signal) && !hasSevereDirectOverride(signal);
}

function normalizeIncidentForV2(incident, userCoords, now) {
  const status = String(incident?.status || "").toLowerCase();
  if (!RECOGNIZED_STATUSES.has(status)) return null;

  const coords = extractIncidentCoords(incident);
  if (!coords) return null;

  const radiusKm = radiusKmForIncident(incident);
  const distanceKm = haversineKm(userCoords, coords);
  const proximity = proximityMultiplier(distanceKm, radiusKm);
  const severity = severityScore(incident);
  const recency = recencyMultiplier(incident?.riskUpdatedAt || incident?.updatedAt || incident?.createdAt, now);
  const observedAt = incident?.riskUpdatedAt || incident?.updatedAt || incident?.createdAt || null;
  const statusMultiplier = STATUS_MULTIPLIERS[status];
  const isMitigation = isPoliceMitigationSignal(incident);
  const mitigationValue = isMitigation
    ? clamp(POLICE_SIGNAL_MAX_REDUCTION * proximity * recency * statusMultiplier, 0, POLICE_SIGNAL_MAX_REDUCTION)
    : 0;
  const signalRisk = isMitigation ? 0 : clamp(severity * proximity * recency * statusMultiplier, 0, 100);

  return {
    id: signalIdForIncident(incident),
    title: incident?.title || "Incident",
    source: incident?.source || "incident",
    category: String(incident?.type || "incident"),
    severity,
    proximity,
    recency,
    status,
    statusMultiplier,
    observedAt,
    recencyLabel: recencyLabel(observedAt, now),
    distanceKm,
    radiusKm,
    signalRisk,
    isMitigation,
    mitigationValue,
    raw: incident,
  };
}

function normalizeDedupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function dedupCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : "";
}

function dedupKeyForSignal(signal) {
  const raw = signal?.raw || {};
  const coords = extractIncidentCoords(raw) || {};
  return [
    normalizeDedupText(signal?.source || raw.source),
    normalizeDedupText(signal?.category || raw.type),
    normalizeDedupText(signal?.title || raw.title),
    normalizeDedupText(raw.summary || raw.normalizedText),
    normalizeDedupText(signal?.status || raw.status),
    dedupCoordinate(coords.lat),
    dedupCoordinate(coords.lon),
  ].join("|");
}

function deduplicateSignals(signals) {
  const byKey = new Map();

  for (const signal of signals) {
    const key = dedupKeyForSignal(signal);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, signal);
      continue;
    }

    const currentRisk = Number(signal.signalRisk) || 0;
    const existingRisk = Number(existing.signalRisk) || 0;
    const currentMitigation = Number(signal.mitigationValue) || 0;
    const existingMitigation = Number(existing.mitigationValue) || 0;
    const currentAt = new Date(signal.observedAt || 0).getTime() || 0;
    const existingAt = new Date(existing.observedAt || 0).getTime() || 0;

    if (
      currentRisk > existingRisk ||
      currentMitigation > existingMitigation ||
      (currentRisk === existingRisk && currentMitigation === existingMitigation && currentAt > existingAt)
    ) {
      byKey.set(key, signal);
    }
  }

  return [...byKey.values()];
}

function deduplicateSignalsWithMeta(signals) {
  const deduplicated = deduplicateSignals(signals);
  return {
    signals: deduplicated,
    duplicateCount: Math.max(0, signals.length - deduplicated.length),
  };
}

function observedTimeMs(signal) {
  const at = new Date(signal?.observedAt || signal?.raw?.riskUpdatedAt || signal?.raw?.updatedAt || signal?.raw?.createdAt || 0);
  return Number.isNaN(at.getTime()) ? 0 : at.getTime();
}

function minutesBetweenSignals(a, b) {
  const left = observedTimeMs(a);
  const right = observedTimeMs(b);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / (1000 * 60);
}

function canClusterSosSignals(a, b) {
  if (!isClusterableSosSignal(a) || !isClusterableSosSignal(b)) return false;
  if (String(a.category || "").toLowerCase() !== String(b.category || "").toLowerCase()) return false;
  if (!Number.isFinite(a.distanceKm) || !Number.isFinite(b.distanceKm)) return false;
  const aCoords = extractIncidentCoords(a.raw);
  const bCoords = extractIncidentCoords(b.raw);
  if (!aCoords || !bCoords) return false;
  return (
    haversineKm(aCoords, bCoords) <= SOS_CLUSTER_RADIUS_KM &&
    minutesBetweenSignals(a, b) <= SOS_CLUSTER_WINDOW_MINUTES
  );
}

function buildSosClusters(signals) {
  const clusters = [];
  const sosSignals = signals.filter(isClusterableSosSignal);

  for (const signal of sosSignals) {
    const cluster = clusters.find((candidate) =>
      candidate.signals.some((existing) => canClusterSosSignals(signal, existing)),
    );
    if (cluster) {
      cluster.signals.push(signal);
    } else {
      clusters.push({ signals: [signal] });
    }
  }

  return clusters;
}

function calibrateSosSignals(signals, duplicateCount = 0) {
  const clusters = buildSosClusters(signals);
  const byId = new Map(signals.map((signal) => [signal.id, { ...signal }]));
  let unconfirmedSosCount = 0;
  let operatorConfirmed = false;
  let capApplied = false;
  let capReason = "";

  for (const cluster of clusters) {
    const sorted = [...cluster.signals].sort((a, b) => {
      if (b.signalRisk !== a.signalRisk) return b.signalRisk - a.signalRisk;
      return observedTimeMs(b) - observedTimeMs(a);
    });
    const primary = sorted[0];

    for (const signal of sorted) {
      if (hasOperatorConfirmation(signal)) operatorConfirmed = true;
      if (isUnconfirmedSosSignal(signal)) unconfirmedSosCount += 1;
      const next = byId.get(signal.id);
      if (!next) continue;
      next.sosClusterSize = sorted.length;
      next.sosOperatorConfirmed = hasOperatorConfirmation(signal);
      next.sosUnconfirmed = isUnconfirmedSosSignal(signal);
      next.sosPrimary = signal.id === primary.id;

      if (next.sosUnconfirmed) {
        if (next.sosPrimary) {
          if (next.signalRisk > UNCONFIRMED_SOS_SINGLE_CAP) {
            capApplied = true;
            capReason = sorted.length > 1 ? "unconfirmed_sos_cluster" : "unconfirmed_sos_single";
          }
          next.signalRisk = Math.min(next.signalRisk, UNCONFIRMED_SOS_SINGLE_CAP);
        } else {
          capApplied = true;
          capReason = "unconfirmed_sos_cluster";
          next.signalRisk = Math.min(next.signalRisk * SOS_DUPLICATE_WEIGHT, UNCONFIRMED_SOS_SINGLE_CAP * SOS_DUPLICATE_WEIGHT);
          next.sosDuplicateWeight = SOS_DUPLICATE_WEIGHT;
        }
      }
    }
  }

  return {
    signals: [...byId.values()],
    sosCalibration: {
      unconfirmedSosCount,
      clusterCount: clusters.length,
      duplicateCount,
      capApplied,
      capReason,
      operatorConfirmed,
    },
  };
}

function countIndependentSevereNonSosSignals(signals) {
  return signals.filter((signal) =>
    !isSosSignal(signal) &&
    isDirectSafetySignal(signal) &&
    Number(signal.signalRisk) >= 70,
  ).length;
}

function applySosCalibrationCap(scoreResult, signals, sosCalibration) {
  if (!sosCalibration.unconfirmedSosCount || !UNCONFIRMED_SOS_CRITICAL_BLOCK) {
    return { scoreResult, sosCalibration };
  }

  const nonUnconfirmedSignals = signals.filter((signal) => !isUnconfirmedSosSignal(signal));
  const nonUnconfirmedScore = aggregateSignals(nonUnconfirmedSignals).score;
  const independentSevereNonSosCount = countIndependentSevereNonSosSignals(nonUnconfirmedSignals);
  if (
    sosCalibration.operatorConfirmed ||
    independentSevereNonSosCount >= 2 ||
    nonUnconfirmedScore > UNCONFIRMED_SOS_CLUSTER_CAP
  ) {
    return { scoreResult, sosCalibration };
  }

  const hasClusteredSos = sosCalibration.clusterCount > 0 && sosCalibration.unconfirmedSosCount > 1;
  const cap = hasClusteredSos ? UNCONFIRMED_SOS_CLUSTER_CAP : UNCONFIRMED_SOS_SINGLE_CAP;
  const cappedScore = Math.max(nonUnconfirmedScore, Math.min(scoreResult.score, cap));
  if (cappedScore >= scoreResult.score) {
    return { scoreResult, sosCalibration };
  }

  const capReason = hasClusteredSos ? "unconfirmed_sos_cluster" : "unconfirmed_sos_single";
  return {
    scoreResult: withScoreOverride(scoreResult, cappedScore, {
      sosCap: {
        reason: capReason,
        maxScore: cap,
        uncappedScore: scoreResult.score,
        nonUnconfirmedScore,
      },
    }),
    sosCalibration: {
      ...sosCalibration,
      capApplied: true,
      capReason: capReason || sosCalibration.capReason,
    },
  };
}

function notCountedItem(reason, item, detail) {
  return {
    id: `${reason}:${signalIdForIncident(item) || item?.title || item?.articleUrl || "item"}`,
    reason,
    title: item?.title || "Signal",
    detail,
    source: item?.source || "",
  };
}

function collectNotCounted({ incidents = [], news = [], now = new Date() }) {
  const buckets = {
    resolved: [],
    missing_coordinates: [],
    unrecognized_status: [],
    non_local_news: [],
    reduced_stale_or_unknown_time: [],
  };

  for (const incident of incidents) {
    const status = String(incident?.status || "").toLowerCase();
    const coords = extractIncidentCoords(incident);
    const observedAt = incident?.riskUpdatedAt || incident?.updatedAt || incident?.createdAt || null;
    if (!RECOGNIZED_STATUSES.has(status)) {
      buckets.unrecognized_status.push(notCountedItem(
        "unrecognized_status",
        incident,
        "Status is not recognized for personal risk scoring.",
      ));
      continue;
    }
    if (!coords) {
      buckets.missing_coordinates.push(notCountedItem(
        "missing_coordinates",
        incident,
        "No usable coordinates were available, so this incident was not scored.",
      ));
      continue;
    }
    if (status === "resolved") {
      buckets.resolved.push(notCountedItem(
        "resolved",
        incident,
        "Resolved incidents are tracked for context but add 0 to the score.",
      ));
    }
    if (!observedAt || recencyMultiplier(observedAt, now) <= 0.25) {
      buckets.reduced_stale_or_unknown_time.push(notCountedItem(
        "reduced_stale_or_unknown_time",
        incident,
        `${recencyLabel(observedAt, now)}; the signal may still be scored, but its recency factor is reduced.`,
      ));
    }
  }

  for (const entry of news) {
    buckets.non_local_news.push(notCountedItem(
      "non_local_news",
      entry,
      "News is shown as context only because it is not linked to your saved-location scoring area.",
    ));
  }

  return Object.fromEntries(
    Object.entries(buckets)
      .map(([reason, items]) => [reason, items.slice(0, NOT_COUNTED_LIMIT)])
      .filter(([, items]) => items.length > 0),
  );
}

function driverExplanation(label, topSignals, fallback) {
  const names = topSignals.slice(0, 2).map((item) => item.title).filter(Boolean);
  if (!names.length) return fallback;
  const joined = names.join(" and ");
  if (label === "Hazard") return `${joined} are the strongest nearby hazard signals.`;
  if (label === "Exposure") return `Your saved location is close enough to ${joined} to affect personal risk.`;
  if (label === "Vulnerability") return `${joined} add local pressure, but no profile-based vulnerability factors are used in v2.`;
  return `${joined} are recent or active enough to shape the current score.`;
}

function buildEvidenceSummary(signal, contribution = null) {
  const distance = Number.isFinite(signal?.distanceKm)
    ? `${signal.distanceKm.toFixed(signal.distanceKm < 1 ? 2 : 1)} km away`
    : "distance unknown";
  const radius = Number.isFinite(signal?.radiusKm)
    ? `${signal.radiusKm.toFixed(signal.radiusKm < 1 ? 2 : 1)} km impact radius`
    : "impact radius unknown";
  const severity = Number.isFinite(signal?.severity)
    ? `severity ${Math.round(signal.severity)}/100`
    : "severity unknown or reduced";
  const status = signal?.status ? `status ${signal.status}` : "status unknown";
  const recency = signal?.recencyLabel || "recency unknown or reduced";
  const proximity = proximityLabel(signal?.distanceKm, signal?.radiusKm, signal?.proximity);
  const contributionText = contribution && Number.isFinite(contribution.weightedContribution)
    ? `It contributes ${Math.round(contribution.weightedContribution)} points after weighting.`
    : "Its weighted contribution is unavailable.";
  return `${distance}; ${radius}; ${proximity}; ${severity}; ${status}; ${recency}. ${contributionText}`;
}

function toDriver(id, label, score, topSignals, fallback, evidence = null) {
  return {
    id,
    label,
    score: clamp(Math.round(score), 0, 100),
    direction: directionForScore(score),
    explanation: driverExplanation(label, topSignals, fallback),
    evidence,
  };
}

function confidenceLabel(signals, sourceHealth = []) {
  if (!signals.length) return "Low confidence";
  const liveSources = sourceHealth.filter((item) => item.status === "live").length;
  if (signals.length >= 3 || liveSources >= 2) return "Multiple sources";
  if (signals.length >= 1) return "Mixed sources";
  return "Low confidence";
}

function buildScoringMeta({ locationHash, scoreResult, signals, now, sosCalibration = null }) {
  const riskSignals = signals.filter((signal) => !signal.isMitigation);
  return {
    incidentsUsed: signals.length,
    newsUsed: 0,
    lastComputedAt: now.toISOString(),
    evaluationVersion: RISK_EVALUATION_VERSION,
    locationHash,
    overallRaw: scoreResult.score,
    numberOfSignalsUsed: riskSignals.length,
    numberOfMitigationSignalsUsed: scoreResult.mitigationBreakdown?.length || 0,
    topSignalValue: scoreResult.topSignalValue,
    aggregationBreakdown: scoreResult.aggregationBreakdown,
    aggregationCap: scoreResult.aggregationCap,
    sosCap: scoreResult.sosCap || null,
    sosCalibration: sosCalibration || {
      unconfirmedSosCount: 0,
      clusterCount: 0,
      duplicateCount: 0,
      capApplied: false,
      capReason: "",
      operatorConfirmed: false,
    },
    mitigationBreakdown: scoreResult.mitigationBreakdown || [],
    mitigationTotal: scoreResult.mitigationTotal || 0,
    scoreBeforeMitigation: scoreResult.scoreBeforeMitigation ?? scoreResult.score,
    mitigationNote: scoreResult.mitigationNote,
    hasDirectSafetySignal: Boolean(scoreResult.hasDirectSafetySignal),
    directSafetySignals: scoreResult.directSafetySignals || [],
    sourceHealthNote: SOURCE_HEALTH_NOTE,
    formula: {
      signalRisk: "severity * proximity * recency * status",
      aggregation: "topSignal + 0.35*secondSignal + 0.20*thirdSignal + min(15, 0.10*sum(remainingSignals))",
      mitigation: "nearby police presence can reduce the aggregated score slightly; it never increases score",
      sourceHealth: SOURCE_HEALTH_NOTE,
    },
  };
}

function buildMainReasons(signals, scoreResult) {
  const contributionByTitle = new Map(
    (scoreResult.aggregationBreakdown || []).map((item) => [item.title, item]),
  );
  const contributionById = new Map(
    (scoreResult.aggregationBreakdown || [])
      .filter((item) => item.signalId)
      .map((item) => [item.signalId, item]),
  );
  return signals
    .map((signal) => {
      const contribution = contributionById.get(signal.id) || contributionByTitle.get(signal.title);
      if (!signal.id || !contribution) return null;
      if (!Number.isFinite(Number(contribution.weightedContribution)) || Number(contribution.weightedContribution) <= 0) {
        return null;
      }
      return {
        signalId: signal.id,
        title: signal.title,
        source: signal.source,
        type: signal.category,
        scoreContribution: Number(contribution.weightedContribution) || 0,
        rawSignalRisk: Number(contribution.rawSignalRisk) || 0,
        capped: Boolean(contribution.capped),
        evidence: {
          distanceKm: Number.isFinite(signal.distanceKm) ? Number(signal.distanceKm.toFixed(3)) : null,
          radiusKm: Number.isFinite(signal.radiusKm) ? Number(signal.radiusKm.toFixed(3)) : null,
          severity: Number.isFinite(signal.severity) ? Math.round(signal.severity) : null,
          recency: signal.recencyLabel || "recency unknown or reduced",
          status: signal.status || "unknown",
          proximity: proximityLabel(signal.distanceKm, signal.radiusKm, signal.proximity),
        },
        explanation: buildEvidenceSummary(signal, contribution),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.scoreContribution - a.scoreContribution)
    .slice(0, 3);
}

function buildRiskExplanation({ signals, scoreResult, notCounted }) {
  const mainReasons = buildMainReasons(signals, scoreResult);
  const emptyMessage = "No active nearby incidents with usable location were found.";
  const hasUnconfirmedSos = signals.some(isUnconfirmedSosSignal);
  let plainSummary = emptyMessage;
  if (mainReasons.length) {
    plainSummary = hasUnconfirmedSos
      ? "A nearby SOS alert is active, but it has not been operationally confirmed yet."
      : `${mainReasons[0].title} is the strongest scored nearby signal.`;
  }
  const capExplanation = scoreResult.aggregationCap
    ? `Score capped at ${scoreResult.aggregationCap.maxScore} because no direct safety signal was found.`
    : scoreResult.sosCap
      ? "Unconfirmed SOS alerts are capped to avoid overstating risk."
    : undefined;
  const groupingExplanation = signals.some((signal) => signal.sosClusterSize > 1)
    ? "Similar nearby SOS alerts were grouped to avoid double-counting."
    : undefined;

  return {
    headline: mainReasons.length ? "Risk is based on scored nearby incidents." : emptyMessage,
    plainSummary,
    mainReasons,
    notCounted,
    ...(capExplanation ? { capExplanation } : {}),
    ...(groupingExplanation ? { groupingExplanation } : {}),
  };
}

function computePersonalRiskV2({ incidents = [], news = [], userLocation = null, sourceHealth = [], now = new Date() }) {
  const userCoords = extractUserCoords(userLocation);
  const locationHash = locationHashFromUserLocation(userLocation);
  const notCounted = collectNotCounted({ incidents, news, now });

  if (!userCoords) {
    const scoreResult = { score: 0, topSignalValue: 0, aggregationBreakdown: [] };
    const riskExplanation = buildRiskExplanation({ signals: [], scoreResult, notCounted });
    return {
      locationReady: false,
      scoreResult,
      signals: [],
      riskStatus: {
        level: "Location required",
        score: 0,
        trend: "Unknown",
        summary: "Save your location to calculate nearby personal risk.",
        lastUpdated: now.toISOString(),
        locationLabel: "",
        confidence: "Waiting for location",
      },
      riskDrivers: [],
      scoringMeta: buildScoringMeta({ locationHash: "", scoreResult, signals: [], now }),
      riskExplanation,
    };
  }

  const rawSignals = incidents
    .map((incident) => normalizeIncidentForV2(incident, userCoords, now))
    .filter(Boolean);
  const deduped = deduplicateSignalsWithMeta(rawSignals);
  const calibrated = calibrateSosSignals(deduped.signals, deduped.duplicateCount);
  const signals = calibrated.signals;
  const initialScoreResult = aggregateSignals(signals);
  const capped = applySosCalibrationCap(initialScoreResult, signals, calibrated.sosCalibration);
  const scoreResult = capped.scoreResult;
  const sosCalibration = capped.sosCalibration;
  const sortedSignals = [...signals].sort((a, b) => b.signalRisk - a.signalRisk);
  const riskSignals = sortedSignals.filter((signal) => !signal.isMitigation);
  const topSignals = riskSignals.slice(0, 3);
  const riskExplanation = buildRiskExplanation({ signals: riskSignals, scoreResult, notCounted });
  const score = scoreResult.score;
  const maxProximity = riskSignals.length ? Math.max(...riskSignals.map((item) => item.proximity)) * 100 : 0;
  const maxRecency = riskSignals.length ? Math.max(...riskSignals.map((item) => item.recency * item.statusMultiplier)) * 100 : 0;
  const localPressure = clamp(riskSignals.reduce((sum, item) => sum + item.signalRisk, 0), 0, 100);
  const summary = topSignals.length
    ? sosCalibration.unconfirmedSosCount
      ? "A nearby SOS alert is active, but it has not been operationally confirmed yet."
      : `${topSignals.map((item) => item.title).slice(0, 2).join(" and ")} are shaping your current local risk.`
    : "No active nearby risk signals were found around your saved location.";

  return {
    locationReady: true,
    scoreResult,
    signals: sortedSignals,
    riskStatus: {
      level: scoreBand(score),
      score,
      trend: maxRecency >= 70 || score >= 70 ? "Increasing" : score <= 25 ? "Decreasing" : "Stable",
      summary,
      lastUpdated: now.toISOString(),
      locationLabel: userLocation?.name || userLocation?.raw || "Saved location",
      confidence: confidenceLabel(riskSignals, sourceHealth),
    },
    riskDrivers: [
      toDriver("hazard", "Primary nearby signal", scoreResult.topSignalValue, topSignals, "No nearby hazard signal is active right now.", riskExplanation.mainReasons[0] || null),
      toDriver("exposure", "Distance / exposure", maxProximity, topSignals, "Your saved location is not inside an active incident area.", riskExplanation.mainReasons[0] || null),
      toDriver("vulnerability", "Local pressure", localPressure, topSignals, "No profile-based vulnerability factors are used in this score.", riskExplanation.mainReasons[1] || null),
      toDriver("immediacy", "Freshness", maxRecency, topSignals, "No recent active nearby incident is shaping the score.", riskExplanation.mainReasons[0] || null),
    ],
    scoringMeta: {
      ...buildScoringMeta({ locationHash, scoreResult, signals, now, sosCalibration }),
      duplicateSignalsCollapsed: deduped.duplicateCount,
    },
    riskExplanation,
  };
}

function toTopContributors(signals = []) {
  return signals.filter((signal) => !signal.isMitigation && signal.signalRisk > 0).slice(0, 5).map((signal) => ({
    key: signal.category,
    label: signal.category,
    score: clamp(Math.round(signal.signalRisk), 0, 100),
    delta: 0,
    sourceType: signal.source,
    sourceId: signal.id,
    title: signal.title,
    weight: Number(signal.proximity.toFixed(4)),
  }));
}

// Legacy export retained for older tests/imports; unused by active v2 personal-risk scoring.
function computeAdjustedScore(baseScore, sourceHealth) {
  const confidenceScores = sourceHealth.map((item) => Number(item.confidence) || 0);
  const avgConfidence = clamp(Math.round(average(confidenceScores)), 0, 100);
  const degradedCount = sourceHealth.filter((item) => item.status === "degraded").length;
  const staleCount = sourceHealth.filter((item) => item.status === "stale").length;
  return {
    score: clamp(Math.round(baseScore), 0, 100),
    scoreConfidence: avgConfidence,
    sourcePenalty: 0,
    confidenceFactor: 1,
    degradedCount,
    staleCount,
    note: SOURCE_HEALTH_NOTE,
  };
}

// Legacy export retained for older tests/imports; unused by active v2 personal-risk scoring.
function computeOverallRaw(driverScores = {}) {
  const hazard = clamp(Number(driverScores.hazard) || 0, 0, 100);
  const exposure = clamp(Number(driverScores.exposure) || 0, 0, 100);
  const vulnerability = clamp(Number(driverScores.vulnerability) || 0, 0, 100);
  const immediacy = clamp(Number(driverScores.immediacy) || 0, 0, 100);
  return clamp(
    hazard * LEGACY_DRIVER_WEIGHTS.hazard +
      exposure * LEGACY_DRIVER_WEIGHTS.exposure +
      vulnerability * LEGACY_DRIVER_WEIGHTS.vulnerability +
      immediacy * LEGACY_DRIVER_WEIGHTS.immediacy,
    0,
    100,
  );
}

async function createSnapshot({
  snapshotScope,
  userId,
  locationHash,
  locationContext,
  score,
  driverScores,
  topContributors,
  sourceHealth,
  changedBecauseOverride = null,
}) {
  const query =
    snapshotScope === "user"
      ? { snapshotScope, userId: userId || null }
      : { snapshotScope, locationHash: locationHash || "" };

  const previous = await RiskSnapshot.findOne(query).sort({ createdAt: -1 }).lean();
  const previousScore = Number(previous?.score) || 0;
  const delta = score - previousScore;
  const changedBecause = Array.isArray(changedBecauseOverride)
    ? changedBecauseOverride
    : topContributors.slice(0, 3).map((entry) => entry.title).filter(Boolean);

  const nextSnapshot = await RiskSnapshot.create({
    userId: snapshotScope === "user" ? userId || null : null,
    snapshotScope,
    locationHash: locationHash || "",
    score,
    previousScore,
    delta,
    previousSnapshotId: previous?._id || null,
    scoreConfidence: clamp(Math.round(average(sourceHealth.map((item) => item.confidence || 0))), 0, 100),
    evaluationVersion: RISK_EVALUATION_VERSION,
    driverScores,
    topContributors,
    changedBecause,
    sourceHealth,
    locationContext: locationContext || {},
  });

  return nextSnapshot;
}

function buildChangedBecause(computed) {
  const reasons = Array.isArray(computed?.riskExplanation?.mainReasons)
    ? computed.riskExplanation.mainReasons
    : [];
  const sosCalibration = computed?.scoringMeta?.sosCalibration || {};

  if (sosCalibration.unconfirmedSosCount > 0) {
    const changedBecause = ["Nearby unconfirmed SOS alert"];
    if (sosCalibration.clusterCount > 0 && sosCalibration.unconfirmedSosCount > 1) {
      changedBecause.push("Similar nearby SOS alerts grouped");
    }
    if (sosCalibration.capApplied) {
      changedBecause.push("Unconfirmed SOS cap applied");
    }
    const nonSosReasons = reasons
      .filter((item) => String(item.source || "").toLowerCase() !== "sos")
      .map((item) => item.title)
      .filter(Boolean)
      .slice(0, 1);
    return [...changedBecause, ...nonSosReasons].slice(0, 3);
  }

  return reasons
    .slice(0, 3)
    .map((item) => item.title)
    .filter(Boolean);
}

function buildRiskSummary(computed, changedBecause) {
  const sosCalibration = computed?.scoringMeta?.sosCalibration || {};
  if (sosCalibration.unconfirmedSosCount > 0) {
    if (sosCalibration.capApplied) {
      return "A nearby SOS alert is active, but it has not been operationally confirmed yet. Unconfirmed SOS alerts are capped to avoid overstating risk.";
    }
    return "A nearby SOS alert is active, but it has not been operationally confirmed yet.";
  }
  return changedBecause.length
    ? `${changedBecause.slice(0, 2).join(" and ")} are shaping your current local risk.`
    : computed.riskStatus.summary;
}

async function buildPersonalRiskPayload({
  incidents = [],
  news = [],
  userLocation = null,
  userId = null,
  persist = true,
  operationalInclusionSummary = null,
}) {
  const now = new Date();
  const signalContext = normalizeSignals({
    incidents,
    news,
    userLocation,
  });
  const locationHash = signalContext.locationHash || locationHashFromUserLocation(userLocation);
  const computed = computePersonalRiskV2({
    incidents,
    news,
    userLocation,
    sourceHealth: signalContext.sourceHealth,
    now,
  });
  const changedBecause = buildChangedBecause(computed);
  const topContributors = toTopContributors(computed.signals);
  const inclusionProfileUsed = Boolean(operationalInclusionSummary?.consentForEmergencyUse);
  const vulnerabilityContext = inclusionProfileUsed
    ? {
        summary: String(operationalInclusionSummary.summary || "").slice(0, 360),
        labels: Array.isArray(operationalInclusionSummary.labels)
          ? operationalInclusionSummary.labels.slice(0, 6)
          : [],
      }
    : null;
  const riskDrivers = computed.riskDrivers.map((driver) => {
    if (driver.id !== "vulnerability" || !vulnerabilityContext) return driver;
    return {
      ...driver,
      score: clamp(Math.max(driver.score, Math.min(100, driver.score + 12)), 0, 100),
      explanation: `${driver.explanation} Opt-in emergency profile adds operational vulnerability context.`,
      evidence: {
        type: "operational_inclusion_summary",
        summary: vulnerabilityContext.summary,
        labels: vulnerabilityContext.labels,
      },
    };
  });
  const driverScores = riskDrivers.reduce((acc, driver) => {
    acc[driver.id] = driver.score;
    return acc;
  }, {});

  if (persist && computed.locationReady) {
    await persistSignals(signalContext.signals, locationHash);
  }

  let userSnapshot = null;
  let zoneSnapshot = null;

  if (persist && computed.locationReady && locationHash) {
    const locationContext = {
      name: userLocation?.name || userLocation?.raw || "Saved location",
      locationHash,
      lat: Number(userLocation?.coordinates?.lat) || null,
      lon: Number(userLocation?.coordinates?.lon) || null,
      radiusKm: 1,
    };

    if (userId) {
      userSnapshot = await createSnapshot({
        snapshotScope: "user",
        userId,
        locationHash,
        locationContext,
        score: computed.riskStatus.score,
        driverScores,
        topContributors,
        sourceHealth: signalContext.sourceHealth,
        changedBecauseOverride: changedBecause,
      });
    }

    zoneSnapshot = await createSnapshot({
      snapshotScope: "zone",
      userId: null,
      locationHash,
      locationContext,
      score: computed.riskStatus.score,
      driverScores,
      topContributors,
      sourceHealth: signalContext.sourceHealth,
      changedBecauseOverride: changedBecause,
    });
  }

  const previousScore = Number(userSnapshot?.previousScore ?? zoneSnapshot?.previousScore ?? 0);
  const delta = computed.riskStatus.score - previousScore;

  return {
    locationReady: computed.locationReady,
    riskStatus: {
      ...computed.riskStatus,
      trend: delta >= 8 ? "Increasing" : delta <= -8 ? "Decreasing" : computed.riskStatus.trend,
      summary: buildRiskSummary(computed, changedBecause),
    },
    riskDrivers,
    previousScore,
    delta,
    changedBecause,
    topSignals: topContributors.map((item) => ({
      id: item.sourceId,
      title: item.title,
      score: item.score,
      source: item.sourceType,
      category: item.key,
    })),
    sourceHealth: signalContext.sourceHealth,
    riskExplanation: computed.riskExplanation,
    scoringMeta: {
      ...computed.scoringMeta,
      riskSnapshotId: userSnapshot?._id ? String(userSnapshot._id) : null,
      zoneSnapshotId: zoneSnapshot?._id ? String(zoneSnapshot._id) : null,
      locationHash,
      inclusionProfileUsed,
      ...(vulnerabilityContext ? { operationalInclusionSummary: vulnerabilityContext } : {}),
    },
  };
}

module.exports = {
  DRIVER_WEIGHTS: LEGACY_DRIVER_WEIGHTS,
  RISK_EVALUATION_VERSION,
  computePersonalRiskV2,
  computeOverallRaw,
  computeAdjustedScore,
  buildPersonalRiskPayload,
};
