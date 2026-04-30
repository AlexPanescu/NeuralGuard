const CACHE_TTL_MS = 20 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6500;
const APP_NAME = "neuralguard-dashboard";

const intelligenceCache = new Map();

const WATCHLIST_BASELINES = [
  {
    country: "Ukraine",
    region: "Europe",
    lat: 50.4501,
    lon: 30.5234,
    baseRisk: 92,
    drivers: ["active conflict", "security spillover", "infrastructure pressure"],
  },
  {
    country: "Russia",
    region: "Europe",
    lat: 55.7558,
    lon: 37.6173,
    baseRisk: 84,
    drivers: ["military posture", "sanctions pressure", "regional escalation"],
  },
  {
    country: "Sudan",
    region: "Africa",
    lat: 15.5007,
    lon: 32.5599,
    baseRisk: 89,
    drivers: ["internal conflict", "displacement", "humanitarian strain"],
  },
  {
    country: "Israel",
    region: "Middle East",
    lat: 31.7683,
    lon: 35.2137,
    baseRisk: 82,
    drivers: ["regional escalation", "cross-border attacks", "political stress"],
  },
  {
    country: "Palestinian Territories",
    region: "Middle East",
    lat: 31.9522,
    lon: 35.2332,
    baseRisk: 90,
    drivers: ["civilian exposure", "humanitarian stress", "conflict intensity"],
  },
  {
    country: "Lebanon",
    region: "Middle East",
    lat: 33.8938,
    lon: 35.5018,
    baseRisk: 78,
    drivers: ["spillover risk", "economic fragility", "border tension"],
  },
  {
    country: "Syria",
    region: "Middle East",
    lat: 33.5138,
    lon: 36.2765,
    baseRisk: 85,
    drivers: ["protracted conflict", "displacement", "food insecurity"],
  },
  {
    country: "Yemen",
    region: "Middle East",
    lat: 15.3694,
    lon: 44.191,
    baseRisk: 83,
    drivers: ["humanitarian crisis", "armed actors", "food stress"],
  },
  {
    country: "Myanmar",
    region: "Asia-Pacific",
    lat: 16.8409,
    lon: 96.1735,
    baseRisk: 81,
    drivers: ["internal violence", "governance stress", "displacement"],
  },
  {
    country: "Haiti",
    region: "Americas",
    lat: 18.5944,
    lon: -72.3074,
    baseRisk: 79,
    drivers: ["governance breakdown", "armed groups", "humanitarian pressure"],
  },
  {
    country: "Iran",
    region: "Middle East",
    lat: 35.6892,
    lon: 51.389,
    baseRisk: 76,
    drivers: ["regional posture", "sanctions", "domestic pressure"],
  },
  {
    country: "Taiwan",
    region: "Asia-Pacific",
    lat: 25.033,
    lon: 121.5654,
    baseRisk: 66,
    drivers: ["strategic competition", "trade exposure", "military signaling"],
  },
];

const FALLBACK_NEWS = [
  {
    id: "fallback-ukraine",
    title: "European security posture remains elevated amid continued conflict pressure",
    summary: "Fallback operational brief used when live feeds are unavailable. Replace with live GDELT / ReliefWeb records when network data is reachable.",
    url: "https://drmkc.jrc.ec.europa.eu/initiatives-services/global-conflict-risk-index",
    source: "Fallback Intelligence Brief",
    publishedAt: "2026-04-08T08:00:00.000Z",
    category: "conflict",
    region: "Europe",
    severityScore: 86,
    imageUrl: "",
    country: "Ukraine",
  },
  {
    id: "fallback-oecd",
    title: "Energy shocks and trade uncertainty continue to shape global macro risk",
    summary: "Fallback macro brief maintaining dashboard continuity when official economic feeds are temporarily unavailable.",
    url: "https://www.oecd.org/en/about/newsroom.html",
    source: "Fallback Macro Brief",
    publishedAt: "2026-04-08T07:20:00.000Z",
    category: "economy",
    region: "Global",
    severityScore: 72,
    imageUrl: "",
    country: "",
  },
  {
    id: "fallback-middle-east",
    title: "Humanitarian corridors and ceasefire diplomacy remain central across the Middle East",
    summary: "Fallback geopolitical brief used to keep NeuralGuard populated with contextual signals.",
    url: "https://apidoc.reliefweb.int/",
    source: "Fallback Humanitarian Brief",
    publishedAt: "2026-04-08T06:40:00.000Z",
    category: "humanitarian",
    region: "Middle East",
    severityScore: 81,
    imageUrl: "",
    country: "Palestinian Territories",
  },
];

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(value, maxLength = 180) {
  const clean = stripHtml(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}…`;
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function hoursSince(value) {
  const now = Date.now();
  const date = parseDate(value).getTime();
  return Math.max(0, (now - date) / (1000 * 60 * 60));
}

function scoreBand(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 55) return "elevated";
  return "guarded";
}

function classifyCategory(text) {
  const raw = String(text || "").toLowerCase();
  if (/(war|conflict|missile|strike|military|troops|drone|ceasefire|shelling|armed|attack|battle|frontline|sanctions)/.test(raw)) {
    return "conflict";
  }
  if (/(inflation|trade|tariff|debt|fiscal|econom|gdp|market|growth|energy price|commodity|recession|supply chain|unemployment)/.test(raw)) {
    return "economy";
  }
  if (/(election|government|parliament|protest|policy|diplom|minister|president|coup|governance|corruption)/.test(raw)) {
    return "politics";
  }
  if (/(humanitarian|refugee|displaced|aid|food|famine|cholera|health|civilian)/.test(raw)) {
    return "humanitarian";
  }
  return "politics";
}

function deriveRegion(text) {
  const raw = String(text || "").toLowerCase();
  if (/(ukraine|russia|europe|romania|poland|moldova|balkan|eu |european)/.test(raw)) return "Europe";
  if (/(israel|gaza|palestin|iran|iraq|syria|yemen|lebanon|middle east|saudi|jordan)/.test(raw)) return "Middle East";
  if (/(sudan|ethiopia|sahel|africa|congo|niger|somalia)/.test(raw)) return "Africa";
  if (/(china|taiwan|myanmar|thailand|asia|south china sea|korea|japan|philippines|indonesia)/.test(raw)) return "Asia-Pacific";
  if (/(haiti|venezuela|latin america|americas|united states|canada|mexico|brazil)/.test(raw)) return "Americas";
  return "Global";
}

function computeSeverityScore(item) {
  const category = item.category || classifyCategory(`${item.title} ${item.summary}`);
  const base = {
    conflict: 76,
    humanitarian: 72,
    economy: 61,
    politics: 57,
  }[category] || 55;
  const freshBoost = clamp(16 - hoursSince(item.publishedAt), 0, 16);
  const urgencyBoost = /(urgent|breaking|attack|strike|ceasefire|inflation|debt|sanctions|displaced|warning)/i.test(
    `${item.title} ${item.summary}`,
  )
    ? 7
    : 0;
  const regionalBoost = item.region && item.region !== "Global" ? 4 : 0;
  return clamp(Math.round(base + freshBoost + urgencyBoost + regionalBoost), 35, 99);
}

function dedupeNews(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.json();
}

async function fetchText(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.text();
}

function extractHtmlAnchors(html, baseUrl) {
  const items = [];
  const regex = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const href = match[2];
    const label = stripHtml(match[3]);
    if (!href || !label || label.length < 24 || label.length > 180) continue;
    try {
      items.push({
        title: label,
        url: new URL(href, baseUrl).toString(),
      });
    } catch {
      // ignore malformed urls
    }
  }
  return items;
}

async function fetchReliefWebNews(limit) {
  const payload = {
    limit: Math.min(limit, 8),
    profile: "list",
    sort: ["date.created:desc"],
    query: {
      value: "war OR conflict OR humanitarian OR refugees OR sanctions OR ceasefire OR displacement OR unrest",
    },
    fields: {
      include: [
        "title",
        "body",
        "url",
        "date.created",
        "source.name",
        "country.name",
        "primary_country.name",
      ],
    },
  };

  const data = await fetchJson(
    `https://api.reliefweb.int/v2/reports?appname=${APP_NAME}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  return (Array.isArray(data?.data) ? data.data : [])
    .map((entry) => {
      const fields = entry?.fields || {};
      const countries = Array.isArray(fields.country?.map)
        ? fields.country.map((row) => row?.name).filter(Boolean)
        : Array.isArray(fields.country)
          ? fields.country.map((row) => row?.name || row).filter(Boolean)
          : [];
      const primaryCountry = fields.primary_country?.name || countries[0] || "";
      const title = String(fields.title || "").trim();
      const summary = summarize(fields.body || "", 210);
      const region = deriveRegion(`${title} ${primaryCountry} ${countries.join(" ")}`);
      const category = classifyCategory(`${title} ${summary}`);
      const item = {
        id: `reliefweb-${entry.id || slugify(title)}`,
        title,
        summary,
        url: fields.url || `https://reliefweb.int/report/${entry.id}`,
        source: `ReliefWeb${fields.source?.[0]?.name ? ` / ${fields.source[0].name}` : ""}`,
        publishedAt: fields.date?.created || new Date().toISOString(),
        category,
        region,
        imageUrl: "",
        country: primaryCountry,
      };
      return { ...item, severityScore: computeSeverityScore(item) };
    })
    .filter((item) => item.title && item.url);
}

async function fetchGdeltNews(limit) {
  const params = new URLSearchParams({
    query:
      "(war OR conflict OR sanctions OR inflation OR recession OR protest OR coup OR ceasefire OR debt OR tariffs) sourcelang:eng",
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(limit, 12)),
    sort: "DateDesc",
    timespan: "3days",
  });

  const data = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`);
  return (Array.isArray(data?.articles) ? data.articles : [])
    .map((article, index) => {
      const title = String(article?.title || "").trim();
      const region = deriveRegion(`${title} ${article?.sourcecountry || ""}`);
      const summary = summarize(
        article?.seendate
          ? `Live media coverage detected by GDELT from ${article.domain || "global outlets"} on ${article.seendate}.`
          : `Live media coverage detected by GDELT from ${article.domain || "global outlets"}.`,
        180,
      );
      const category = classifyCategory(`${title} ${summary}`);
      const item = {
        id: `gdelt-${slugify(article?.url || title || index)}`,
        title,
        summary,
        url: article?.url || "",
        source: article?.domain ? `GDELT / ${article.domain}` : "GDELT",
        publishedAt: article?.seendate || new Date().toISOString(),
        category,
        region,
        imageUrl: article?.socialimage || article?.image || "",
        country: article?.sourcecountry || "",
      };
      return { ...item, severityScore: computeSeverityScore(item) };
    })
    .filter((item) => item.title && item.url);
}

async function fetchOecdOfficialNews() {
  const html = await fetchText("https://www.oecd.org/en/about/newsroom.html");
  const candidates = extractHtmlAnchors(html, "https://www.oecd.org")
    .filter((item) => /(growth|inflation|debt|fiscal|econom|trade|resilien|competition|energy|integrity)/i.test(item.title))
    .slice(0, 4);

  return candidates.map((item, index) => {
    const category = classifyCategory(item.title);
    const result = {
      id: `oecd-${slugify(item.url || item.title || index)}`,
      title: item.title,
      summary: "Official OECD newsroom signal incorporated into the macro pulse layer.",
      url: item.url,
      source: "OECD",
      publishedAt: new Date().toISOString(),
      category,
      region: deriveRegion(item.title),
      imageUrl: "",
      country: "",
    };
    return { ...result, severityScore: computeSeverityScore(result) };
  });
}

async function fetchImfOfficialNews() {
  const html = await fetchText("https://www.imf.org/en");
  const candidates = extractHtmlAnchors(html, "https://www.imf.org")
    .filter((item) => /(trade|financial|econom|fiscal|debt|inflation|consultation|growth|market|policy)/i.test(item.title))
    .slice(0, 4);

  return candidates.map((item, index) => {
    const category = classifyCategory(item.title);
    const result = {
      id: `imf-${slugify(item.url || item.title || index)}`,
      title: item.title,
      summary: "Official IMF release mapped into the macro pulse layer.",
      url: item.url,
      source: "IMF",
      publishedAt: new Date().toISOString(),
      category,
      region: deriveRegion(item.title),
      imageUrl: "",
      country: "",
    };
    return { ...result, severityScore: computeSeverityScore(result) };
  });
}

function buildWatchlist(news, regionFilter) {
  const items = WATCHLIST_BASELINES.map((baseline) => {
    const mentions = news.filter((item) => {
      const haystack = `${item.title} ${item.summary} ${item.country || ""}`.toLowerCase();
      return haystack.includes(baseline.country.toLowerCase()) || item.region === baseline.region;
    });
    const mentionBoost = clamp(
      mentions.reduce((total, item) => total + Math.max(0, item.severityScore - 55), 0) / 18,
      0,
      10,
    );
    const score = clamp(Math.round(baseline.baseRisk + mentionBoost), 40, 99);
    return {
      country: baseline.country,
      region: baseline.region,
      lat: baseline.lat,
      lon: baseline.lon,
      riskScore: score,
      riskBand: scoreBand(score),
      trend: mentions.length >= 3 ? "rising" : mentions.length >= 1 ? "watch" : "stable",
      drivers: baseline.drivers,
      storyCount: mentions.length,
    };
  });

  const filtered = regionFilter && regionFilter !== "all"
    ? items.filter((item) => slugify(item.region) === regionFilter)
    : items;

  return filtered.sort((a, b) => b.riskScore - a.riskScore).slice(0, 8);
}

function buildHotspots(watchlist, news) {
  return watchlist.slice(0, 6).map((item) => {
    const related = news.filter((entry) => {
      const haystack = `${entry.title} ${entry.summary} ${entry.country || ""}`.toLowerCase();
      return haystack.includes(item.country.toLowerCase()) || entry.region === item.region;
    });
    const categories = [...new Set(related.map((entry) => entry.category))].slice(0, 3);
    return {
      id: `hotspot-${slugify(item.country)}`,
      label: item.country,
      lat: item.lat,
      lon: item.lon,
      intensity: clamp(Math.round(item.riskScore / 10), 4, 10),
      categories: categories.length ? categories : ["conflict"],
      storyCount: related.length,
    };
  });
}

function buildMacroSignals(news, incidentOverlay) {
  const groups = {
    conflict: news.filter((item) => item.category === "conflict"),
    economy: news.filter((item) => item.category === "economy"),
    politics: news.filter((item) => item.category === "politics"),
    humanitarian: news.filter((item) => item.category === "humanitarian"),
  };

  const average = (items) => {
    if (!items.length) return 0;
    return Math.round(items.reduce((total, item) => total + item.severityScore, 0) / items.length);
  };

  return [
    {
      id: "macro-conflict",
      label: "Conflict pressure",
      valueText: `${average(groups.conflict) || 58}/100`,
      direction: average(groups.conflict) >= 80 ? "up" : "flat",
      context: `${groups.conflict.length} live conflict items in current window`,
    },
    {
      id: "macro-economy",
      label: "Macro stress",
      valueText: `${average(groups.economy) || 54}/100`,
      direction: average(groups.economy) >= 70 ? "up" : "flat",
      context: `${groups.economy.length} economy and trade signals from official/public feeds`,
    },
    {
      id: "macro-politics",
      label: "Policy volatility",
      valueText: `${average(groups.politics) || 52}/100`,
      direction: average(groups.politics) >= 68 ? "up" : "flat",
      context: `${groups.politics.length} governance and diplomacy items`,
    },
    {
      id: "macro-local",
      label: "Local ops load",
      valueText: `${incidentOverlay.active}/${incidentOverlay.total}`,
      direction: incidentOverlay.critical > 0 ? "up" : "down",
      context: `${incidentOverlay.critical} critical incidents linked to the local workspace`,
    },
  ];
}

function buildHeadlineBrief(news, watchlist, incidentOverlay) {
  const lead = news[0] || FALLBACK_NEWS[0];
  return {
    title: lead.title,
    summary: `Live intelligence fusion across ${watchlist.length} watchlist states, ${news.length} normalized stories and ${incidentOverlay.active} active local incidents.`,
    urgentCount: news.filter((item) => item.severityScore >= 80).length,
    lastUpdated: new Date().toISOString(),
  };
}

function buildGlobalRiskSnapshot(news, watchlist, hotspots) {
  const hottestRegion = hotspots[0]?.categories?.length
    ? hotspots[0].label
    : watchlist[0]?.country || "Global";
  return {
    averageRisk: Math.round(
      watchlist.reduce((total, item) => total + item.riskScore, 0) / Math.max(watchlist.length, 1),
    ),
    highestRiskCountry: watchlist[0]?.country || "Ukraine",
    hotspotLabel: hottestRegion,
    liveStoryCount: news.length,
    categoryMix: {
      conflict: news.filter((item) => item.category === "conflict").length,
      economy: news.filter((item) => item.category === "economy").length,
      politics: news.filter((item) => item.category === "politics").length,
      humanitarian: news.filter((item) => item.category === "humanitarian").length,
    },
  };
}

function buildIncidentOverlay(incidents, buildIncidentNotifications) {
  const all = Array.isArray(incidents) ? incidents : [];
  const active = all.filter((incident) => incident.status !== "resolved");
  const critical = active.filter((incident) => incident.severity === "critical");
  const notifications = typeof buildIncidentNotifications === "function"
    ? buildIncidentNotifications(all, null)
    : [];
  return {
    total: all.length,
    active: active.length,
    critical: critical.length,
    notifications: Array.isArray(notifications) ? notifications.length : 0,
    latest: active.slice(0, 4).map((incident) => ({
      id: incident.id || incident._id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      link: `/incidents/${incident.id || incident._id}`,
      updatedAt: incident.updatedAt || incident.createdAt || new Date().toISOString(),
    })),
  };
}

function buildMeta(sourceStatuses) {
  return {
    lastUpdated: new Date().toISOString(),
    sources: sourceStatuses,
    methodologyNote:
      "Risk signals are an operational estimate inspired by public-source methodology and live feeds. They are not official GCRI country scores.",
  };
}

async function collectExternalNews(limit) {
  const sourceStatuses = [];

  const results = await Promise.allSettled([
    fetchReliefWebNews(limit),
    fetchGdeltNews(limit),
    fetchOecdOfficialNews(),
    fetchImfOfficialNews(),
  ]);

  const [reliefWebResult, gdeltResult, oecdResult, imfResult] = results;

  const collections = [];

  const sourceConfigs = [
    {
      name: "ReliefWeb",
      url: "https://api.reliefweb.int/v2/reports",
      result: reliefWebResult,
    },
    {
      name: "GDELT",
      url: "https://api.gdeltproject.org/api/v2/doc/doc",
      result: gdeltResult,
    },
    {
      name: "OECD",
      url: "https://www.oecd.org/en/about/newsroom.html",
      result: oecdResult,
    },
    {
      name: "IMF",
      url: "https://www.imf.org/en",
      result: imfResult,
    },
  ];

  sourceConfigs.forEach((source) => {
    if (source.result.status === "fulfilled") {
      collections.push(...source.result.value);
      sourceStatuses.push({
        name: source.name,
        url: source.url,
        status: "live",
        items: source.result.value.length,
      });
    } else {
      sourceStatuses.push({
        name: source.name,
        url: source.url,
        status: "fallback",
        items: 0,
      });
    }
  });

  const news = dedupeNews(collections).sort((a, b) => {
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    return parseDate(b.publishedAt) - parseDate(a.publishedAt);
  });

  return {
    news: news.length ? news : FALLBACK_NEWS,
    sourceStatuses,
  };
}

async function buildDashboardIntelligence({
  incidents = [],
  region = "",
  limit = 12,
  buildIncidentNotifications,
} = {}) {
  const regionFilter = slugify(region);
  const normalizedLimit = clamp(Number(limit) || 12, 6, 24);
  const cacheKey = `${regionFilter || "all"}:${normalizedLimit}`;
  const cached = intelligenceCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const incidentOverlay = buildIncidentOverlay(incidents, buildIncidentNotifications);
  const { news: allNews, sourceStatuses } = await collectExternalNews(normalizedLimit);
  const regionalNews = regionFilter && regionFilter !== "all"
    ? allNews.filter((item) => slugify(item.region) === regionFilter || item.region === "Global")
    : allNews;
  const slicedNews = regionalNews.slice(0, normalizedLimit);
  const watchlist = buildWatchlist(allNews, regionFilter);
  const hotspots = buildHotspots(watchlist, allNews);
  const payload = {
    headlineBrief: buildHeadlineBrief(slicedNews, watchlist, incidentOverlay),
    globalRiskSnapshot: buildGlobalRiskSnapshot(slicedNews, watchlist, hotspots),
    hotspots,
    news: slicedNews,
    macroSignals: buildMacroSignals(slicedNews, incidentOverlay),
    watchlist,
    incidentOverlay,
    meta: buildMeta(sourceStatuses),
  };

  intelligenceCache.set(cacheKey, {
    createdAt: Date.now(),
    payload,
  });

  return payload;
}

module.exports = {
  buildDashboardIntelligence,
};
