const { normalizeSignals } = require("./signalFusionService");

const EARTH_RADIUS_KM = 6371;

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

function toneFromScore(score) {
  if (score >= 76) return "Critical";
  if (score >= 56) return "High";
  if (score >= 36) return "Elevated";
  return "Low";
}

function directionFromDelta(value) {
  if (value >= 8) return "up";
  if (value <= -8) return "down";
  return "steady";
}

function recencyWeight(dateLike, now) {
  const date = dateLike ? new Date(dateLike) : now;
  if (Number.isNaN(date.getTime())) return 0.25;
  const hours = Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.82;
  if (hours <= 72) return 0.55;
  return 0.28;
}

function severityScore(entry) {
  if (Number.isFinite(Number(entry?.severityScore))) return clamp(Number(entry.severityScore), 0, 100);
  if (Number.isFinite(Number(entry?.dangerScore))) return clamp(Number(entry.dangerScore), 0, 100);
  switch (String(entry?.severity || "").toLowerCase()) {
    case "critical":
      return 90;
    case "high":
      return 72;
    case "medium":
      return 48;
    default:
      return 35;
  }
}

const REGIONAL_FACTORS = [
  {
    id: "factor-political-stability",
    key: "political",
    category: "Political stability",
    neutralStatus: "Low volatility",
    neutralDetail: "No major regional political instability signal detected.",
    keywords: /(government|election|protest|diplom|corruption|cabinet|parliament|minister|president|policy|coalition|coup|governance|democracy|political|politic|guvern|alegeri|protest|ministr|diploma)/i,
    detailNoun: "political stability",
    topicKeywords: [
      ["elections", /(election|alegeri)/i],
      ["government pressure", /(government|cabinet|minister|parliament|coalition|guvern|ministr)/i],
      ["public protests", /(protest|mobilization|demonstration)/i],
      ["diplomatic tension", /(diplom|policy|president)/i],
    ],
    status(score) {
      if (score >= 76) return "High volatility";
      if (score >= 56) return "Volatile";
      if (score >= 36) return "Watch";
      return "Low volatility";
    },
  },
  {
    id: "factor-economic-pressure",
    key: "economic",
    category: "Economic pressure",
    neutralStatus: "Low",
    neutralDetail: "No major regional economic pressure signal detected.",
    keywords: /(inflation|energy price|tariff|recession|debt|market|supply chain|commodity|gdp|unemployment|trade|fiscal|economic|economy|preturi|energie|inflatie|datorie)/i,
    detailNoun: "economic pressure",
    topicKeywords: [
      ["inflation", /(inflation|inflatie|prices|preturi)/i],
      ["energy prices", /(energy price|energie|gas supply|commodity)/i],
      ["trade pressure", /(tariff|trade|supply chain)/i],
      ["debt or market stress", /(debt|market|recession|fiscal|datorie)/i],
    ],
    status(score) {
      if (score >= 76) return "Severe";
      if (score >= 56) return "Elevated";
      if (score >= 36) return "Moderate";
      return "Low";
    },
  },
  {
    id: "factor-border-conflict",
    key: "conflict",
    category: "Border / conflict risk",
    neutralStatus: "No active escalation",
    neutralDetail: "Regional security coverage is present, but no active escalation signal was detected.",
    keywords: /(war|armed group|drone|missile|border|escalation|sanction|nato|military|troops|attack|strike|ceasefire|shelling|invasion|conflict|frontline|security posture|razboi|granita|atac|militar)/i,
    detailNoun: "border or conflict risk",
    topicKeywords: [
      ["border security", /(border|granita|nato|security posture)/i],
      ["armed conflict", /(war|armed group|conflict|military|troops|razboi|militar)/i],
      ["attacks or strikes", /(attack|strike|drone|missile|shelling|atac)/i],
      ["sanctions or escalation", /(sanction|escalation|ceasefire)/i],
    ],
    status(score) {
      if (score >= 76) return "Escalating";
      if (score >= 56) return "Elevated";
      if (score >= 36) return "Watch";
      return "No active escalation";
    },
  },
  {
    id: "factor-infrastructure-resilience",
    key: "infrastructure",
    category: "Infrastructure resilience",
    neutralStatus: "Stable",
    neutralDetail: "No major regional infrastructure disruption detected.",
    keywords: /\b(outage|rail|airport|port|telecom|water|utility|infrastructure|blackout|electricity|retea|curent|apa|aeroport)\b|energy grid|power grid|gas supply|transport hub/i,
    detailNoun: "infrastructure resilience",
    topicKeywords: [
      ["power or utility disruption", /(outage|utility|blackout|electricity|energy grid|power grid|curent|apa|water)/i],
      ["transport hub disruption", /(rail|airport|port|transport hub|aeroport)/i],
      ["telecom disruption", /(telecom|network)/i],
      ["energy-grid resilience", /(energy grid|power grid|gas supply)/i],
    ],
    status(score) {
      if (score >= 76) return "Disrupted";
      if (score >= 56) return "Strained";
      if (score >= 36) return "Watch";
      return "Stable";
    },
  },
];

const IRRELEVANT_REGIONAL_CONTENT = /(sports coverage|sports|league|team|match|fixture|athletic|entertainment|celebrity|movie|music|lifestyle|fashion|recipe|travel deal|advertisement|sponsored)/i;

function cleanEvidenceText(entry) {
  return `${entry?.category || ""} ${entry?.tags || ""} ${entry?.title || ""} ${entry?.summary || ""} ${entry?.content || ""}`;
}

function evidenceKey(entry) {
  const url = String(entry?.articleUrl || entry?.url || "").trim().toLowerCase();
  if (url) return `url:${url}`;
  const title = String(entry?.title || "").trim().toLowerCase();
  if (title) return `title:${title}`;
  const source = String(entry?.source || "").trim().toLowerCase();
  return source ? `source:${source}` : "";
}

function compactList(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function topicsForFactor(factor, text) {
  const topics = (factor.topicKeywords || [])
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  return [...new Set(topics)].slice(0, 3);
}

function classifyRegionalEvidence(entry, now) {
  const text = cleanEvidenceText(entry);
  if (!text.trim() || IRRELEVANT_REGIONAL_CONTENT.test(text)) return null;

  const matched = REGIONAL_FACTORS
    .filter((factor) => factor.keywords.test(text))
    .map((factor) => factor.key);
  if (!matched.length) return null;

  const primaryFactor = REGIONAL_FACTORS.find((factor) => factor.key === matched[0]);
  const severity = severityScore(entry);
  const recency = recencyWeight(entry?.publishedAt || entry?.updatedAt || entry?.createdAt, now);
  const score = clamp(Math.round(severity * recency), 0, 100);
  const source = String(entry?.source || "").trim() || "regional feed";
  const region = String(entry?.region || entry?.country || "").trim();
  const topics = primaryFactor ? topicsForFactor(primaryFactor, text) : [];

  return {
    id: String(entry?._id || entry?.id || entry?.articleUrl || entry?.url || source),
    evidenceKey: evidenceKey(entry),
    factorKey: matched[0],
    score,
    severity,
    source,
    region,
    topics,
    publishedAt: entry?.publishedAt || entry?.updatedAt || entry?.createdAt || null,
  };
}

function summarizeContributors(factor, contributors) {
  if (!contributors.length) return factor.neutralDetail;
  const topics = [...new Set(contributors.flatMap((item) => item.topics || []))].slice(0, 3);
  const topicText = compactList(topics);
  if (factor.key === "political") {
    if (contributors.some((item) => item.score >= 70)) {
      return topicText
        ? `Regional political coverage points to ${topicText}; volatility may rise.`
        : "Regional political coverage points to possible volatility.";
    }
    return topicText
      ? `Some regional political coverage mentions ${topicText}, but no major instability signal is active.`
      : "Regional political coverage is present, but no major instability signal is active.";
  }
  if (factor.key === "economic") {
    if (contributors.some((item) => item.score >= 70)) {
      return topicText
        ? `Regional economy coverage highlights ${topicText}; pressure is elevated.`
        : "Regional economy coverage suggests elevated pressure.";
    }
    return topicText
      ? `Some regional economy items mention ${topicText}, but current pressure remains low.`
      : "Regional economy coverage is present, but current pressure remains low.";
  }
  if (factor.key === "conflict") {
    if (contributors.some((item) => item.score >= 70)) {
      return topicText
        ? `Regional security coverage highlights ${topicText}; escalation risk is elevated.`
        : "Regional security coverage suggests elevated escalation risk.";
    }
    return "Regional security coverage is present, but no active escalation signal was detected.";
  }
  if (factor.key === "infrastructure") {
    if (contributors.some((item) => item.score >= 70)) {
      return topicText
        ? `Regional infrastructure coverage reports ${topicText}; resilience is under pressure.`
        : "Regional infrastructure coverage suggests resilience is under pressure.";
    }
    return topicText
      ? `Some regional infrastructure coverage mentions ${topicText}, but no major disruption is active.`
      : "No major regional infrastructure disruption detected.";
  }
  return factor.neutralDetail;
}

function dedupeClassifiedEvidence(rows) {
  const seen = new Set();
  return rows.filter((item) => {
    const key = item.evidenceKey || `id:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contributorSummary(factor, item) {
  const topics = compactList((item.topics || []).slice(0, 2));
  const region = item.region ? ` in ${item.region}` : "";
  if (topics) return `${topics}${region}`;
  if (factor.key === "political") return `political developments${region}`;
  if (factor.key === "economic") return `economic pressure${region}`;
  if (factor.key === "conflict") return `regional security pressure${region}`;
  if (factor.key === "infrastructure") return `infrastructure pressure${region}`;
  return `regional context${region}`;
}

function buildRegionalContextFactors(news = [], now = new Date()) {
  const classified = news
    .map((entry) => classifyRegionalEvidence(entry, now))
    .filter(Boolean);
  const deduped = dedupeClassifiedEvidence(classified);

  const factorRows = REGIONAL_FACTORS.map((factor) => {
    const contributors = deduped
      .filter((entry) => entry.factorKey === factor.key)
      .sort((a, b) => b.score - a.score);
    const score = contributors.length
      ? clamp(Math.round(contributors.reduce((total, item) => total + item.score, 0) / contributors.length), 0, 100)
      : 0;
    return {
      id: factor.id,
      category: factor.category,
      score,
      status: contributors.length ? factor.status(score) : factor.neutralStatus,
      detail: summarizeContributors(factor, contributors),
      scope: "regional_context",
      contributors: contributors.slice(0, 2).map((item) => ({
        signalId: item.id,
        summary: contributorSummary(factor, item),
        score: item.score,
        source: item.source,
      })),
      ignoredCount: Math.max(0, news.length - deduped.length),
    };
  });

  return factorRows.concat(buildSystemStressFactor(deduped, news.length, factorRows));
}

function buildSystemStressFactor(classified, totalNewsCount, factorRows = []) {
  const highCount = classified.filter((item) => item.score >= 70).length;
  const elevatedRows = factorRows.filter((item) => item.score >= 56);
  const strongestScore = factorRows.reduce((max, item) => Math.max(max, item.score), 0);
  const rawScore = classified.length
    ? Math.round((highCount * 12) + (elevatedRows.length * 18) + Math.min(22, classified.length * 3))
    : 0;
  const severeMultiCategoryEscalation = elevatedRows.length >= 4 && highCount >= 3;
  const clearMultiCategoryEscalation = elevatedRows.length >= 3 && highCount >= 2;
  const cap = severeMultiCategoryEscalation
    ? 100
    : clearMultiCategoryEscalation
      ? 88
      : elevatedRows.length >= 2
        ? 74
        : strongestScore >= 70
          ? Math.min(60, strongestScore)
          : 35;
  const score = classified.length ? clamp(Math.min(rawScore, cap), 0, 100) : 0;
  let status = "Low";
  if (score >= 76) status = "High";
  else if (score >= 56) status = "Elevated";
  else if (score >= 36) status = "Moderate";

  let detail = "Overall regional pressure is low because no category is elevated.";
  if (severeMultiCategoryEscalation) {
    detail = "Overall regional pressure is high because four context areas show strong simultaneous pressure.";
  } else if (clearMultiCategoryEscalation) {
    detail = `Overall regional pressure is elevated because ${elevatedRows.length} context areas show pressure.`;
  } else if (elevatedRows.length >= 2) {
    detail = `Overall regional pressure is elevated because ${elevatedRows.length} context areas show pressure.`;
  } else if (elevatedRows.length === 1) {
    detail = `${elevatedRows[0].category} is the only elevated regional context area, so overall pressure is capped.`;
  } else if (!classified.length) {
    detail = "Overall regional pressure is low because no clean regional evidence is active.";
  }

  return {
    id: "factor-system-stress",
    category: "System stress",
    score,
    status,
    detail,
    scope: "regional_context",
    contributors: elevatedRows
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => ({
        signalId: `system:${item.id}`,
        summary: item.category,
        score: item.score,
        source: "",
      })),
    ignoredCount: Math.max(0, totalNewsCount - classified.length),
  };
}

function toNearby({
  incidents = [],
  userLocation = null,
}) {
  const coords = userLocation?.coordinates?.lat != null && userLocation?.coordinates?.lon != null
    ? {
        lat: Number(userLocation.coordinates.lat),
        lon: Number(userLocation.coordinates.lon),
      }
    : null;

  const rows = incidents
    .map((incident) => {
      const lat = Number(incident?.location?.lat);
      const lon = Number(incident?.location?.lon);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
      const distanceKm = hasCoords && coords ? haversineKm(coords, { lat, lon }) : null;
      return {
        id: String(incident._id || incident.id || ""),
        title: incident.title || "Incident",
        severity: String(incident.severity || "medium").replace(/^./, (char) => char.toUpperCase()),
        distanceKm,
      };
    })
    .sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

  const topIncidents = rows.slice(0, 6);
  const elevatedCount = rows.filter((item) => item.distanceKm != null && item.distanceKm <= 5).length;
  const heatZones = elevatedCount
    ? `${elevatedCount} elevated zone${elevatedCount > 1 ? "s" : ""} in a 5 km radius.`
    : "No major concentration of nearby active incidents.";

  return {
    currentLocation: userLocation?.name || userLocation?.raw || "Saved location",
    heatZones,
    incidents: topIncidents.map((item) => ({
      id: item.id,
      title: item.title,
      distance: item.distanceKm == null ? "Unknown" : `${item.distanceKm.toFixed(1)} km`,
      severity: item.severity,
    })),
  };
}

function buildCitizenStats({ factors = [], incidents = [], news = [], sourceHealth = [], signals = [] }) {
  const getFactorScore = (key) =>
    Number(factors.find((factor) => factor.key === key)?.score || 0);

  const activeIncidents = incidents.filter((item) => item.status !== "resolved");
  const urgentNews = news.filter((item) => Number(item.severityScore || 0) >= 70);
  const healthySources = sourceHealth.filter((item) => item.status === "live").length;
  const degradedSources = sourceHealth.filter((item) => item.status === "degraded").length;
  const staleSources = sourceHealth.filter((item) => item.status === "stale").length;

  const byCategory = (category) => signals.filter((signal) => signal.category === category);
  const avgStrength = (rows) => {
    if (!rows.length) return 0;
    return rows.reduce((total, row) => total + (Number(row.strength) || 0), 0) / rows.length;
  };

  const mobilitySignals = byCategory("mobility");
  const publicSafetySignals = byCategory("public_safety");
  const medicalSignals = byCategory("medical_access");
  const infrastructureSignals = byCategory("infrastructure");

  const mobilityScore = clamp(Math.round(avgStrength(mobilitySignals) || getFactorScore("mobility")), 0, 100);
  const crowdScore = clamp(
    Math.round((avgStrength(publicSafetySignals) || getFactorScore("public_safety")) * 0.8 + activeIncidents.length * 2),
    0,
    100,
  );
  const accessScore = clamp(
    100 -
      Math.round(
        (avgStrength(medicalSignals) || getFactorScore("medical_access")) * 0.7 +
        mobilityScore * 0.2 +
        (Number(infrastructureSignals.length > 0) * 6),
      ),
    0,
    100,
  );
  const networkScore = clamp(
    100 -
      Math.round(
        (avgStrength(infrastructureSignals) || getFactorScore("infrastructure")) * 0.55 +
        degradedSources * 7 +
        staleSources * 11,
      ),
    0,
    100,
  );
  const economicScore = clamp(
    Math.round(
      news.reduce((total, item) => total + (Number(item.severityScore) || 0), 0) / Math.max(1, news.length),
    ),
    0,
    100,
  );

  return [
    {
      id: "stat-crowd",
      label: "Crowd density",
      value: crowdScore >= 68 ? "Rising" : crowdScore >= 40 ? "Watch" : "Low",
      context: `${publicSafetySignals.length} public safety signals and ${activeIncidents.length} active incidents.`,
      direction: directionFromDelta(crowdScore - 45),
      score: crowdScore,
    },
    {
      id: "stat-mobility",
      label: "Mobility flow",
      value: mobilityScore >= 70 ? "Disrupted" : mobilityScore >= 42 ? "Guarded" : "Stable",
      context: `${mobilitySignals.length} mobility disruption signals (traffic, blockages, route incidents).`,
      direction: directionFromDelta(mobilityScore - 40),
      score: mobilityScore,
    },
    {
      id: "stat-network",
      label: "Network resilience",
      value: networkScore >= 70 ? "Stable" : networkScore >= 45 ? "Watch" : "Fragile",
      context: `${healthySources}/${Math.max(1, sourceHealth.length)} healthy sources; degraded ${degradedSources}, stale ${staleSources}.`,
      direction: directionFromDelta(networkScore - 60),
      score: networkScore,
    },
    {
      id: "stat-access",
      label: "Medical access",
      value: accessScore >= 70 ? "Available" : accessScore >= 45 ? "Limited" : "Critical",
      context: `${medicalSignals.length} medical signals plus route/infrastructure availability estimate.`,
      direction: directionFromDelta(accessScore - 60),
      score: accessScore,
    },
    {
      id: "stat-economy",
      label: "Economic pulse",
      value: economicScore >= 70 ? "Stress" : economicScore >= 45 ? "Watch" : "Calm",
      context: `${urgentNews.length} high-severity regional/local news signals in the current window.`,
      direction: directionFromDelta(economicScore - 50),
      score: economicScore,
    },
  ];
}

function buildRecommendedActions({ riskStatus, factors }) {
  const actions = [];
  const mobility = factors.find((factor) => factor.key === "mobility");
  const safety = factors.find((factor) => factor.key === "public_safety");
  const weather = factors.find((factor) => factor.key === "weather");

  if ((Number(riskStatus?.score) || 0) >= 70) {
    actions.push({
      id: "action-avoid-high-density",
      priority: "high",
      title: "Avoid high-density zones for the next 2-4 hours",
      detail: "Delay non-essential travel and keep a low-friction route open to home or a safe point.",
    });
  }

  if ((Number(mobility?.score) || 0) >= 55) {
    actions.push({
      id: "action-mobility",
      priority: "medium",
      title: "Plan two alternate routes now",
      detail: "Mobility disruption is elevated; use routes with fewer known incidents and avoid bottlenecks.",
    });
  }

  if ((Number(safety?.score) || 0) >= 60) {
    actions.push({
      id: "action-safety",
      priority: "critical",
      title: "Keep emergency contacts and 112 ready",
      detail: "Public safety pressure is high. Stay reachable and share live location with trusted contacts.",
    });
  }

  if ((Number(weather?.score) || 0) >= 55) {
    actions.push({
      id: "action-weather",
      priority: "medium",
      title: "Prepare weather-safe fallback",
      detail: "Carry essentials and avoid exposed routes where weather-related disruption could escalate.",
    });
  }

  if (!actions.length) {
    actions.push({
      id: "action-default",
      priority: "low",
      title: "Maintain preparedness baseline",
      detail: "No immediate high-pressure signal detected. Keep devices charged and monitor updates.",
    });
  }

  return actions.slice(0, 4);
}

async function buildSituationalAwareness({
  incidents = [],
  news = [],
  userLocation = null,
  riskPayload = null,
}) {
  const signalContext = normalizeSignals({
    incidents,
    news,
    userLocation,
  });

  const riskStatus = riskPayload?.riskStatus || {
    score: 0,
    level: "Low",
    trend: "Stable",
    summary: "No active risk payload.",
  };

  const liveRiskFactors = buildRegionalContextFactors(news);

  const nearby = toNearby({
    incidents,
    userLocation,
  });

  const citizenStats = buildCitizenStats({
    factors: signalContext.factors,
    incidents,
    news,
    sourceHealth: signalContext.sourceHealth,
    signals: signalContext.signals,
  });

  const recommendedActions = buildRecommendedActions({
    riskStatus,
    factors: signalContext.factors,
  });

  return {
    liveRiskFactors,
    nearby,
    citizenStats,
    recommendedActions,
    meta: {
      generatedAt: new Date().toISOString(),
      sourceHealth: signalContext.sourceHealth,
      locationHash: signalContext.locationHash,
      riskScore: Number(riskStatus?.score) || 0,
      riskTone: toneFromScore(Number(riskStatus?.score) || 0),
    },
  };
}

module.exports = {
  buildSituationalAwareness,
  buildRegionalContextFactors,
};
