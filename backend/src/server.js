const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const { CHAT_FILE, GUIDE_ROOT, GUIDE_INDEX } = require("./config/paths");
const { createAuthTokenService } = require("./services/authTokenService");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const INCIDENT_AUTOMATED_SOURCE_REGEX = /^(accidenteromania|waze_live_map)/i;
const INCIDENTS_VISIBLE_MAX_AGE_HOURS = Math.max(
  6,
  Number.parseInt(process.env.INCIDENTS_VISIBLE_MAX_AGE_HOURS || "72", 10) || 72,
);
let onlineUsers = new Map();
const socketChatChannel = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/guide-pdfs", express.static(GUIDE_ROOT));
app.use((req, _res, next) => {
  const authHeader = req.headers?.authorization;
  const parsedBearer = extractBearerToken(authHeader);
  const hasAuthHeader = typeof authHeader === "string" && authHeader.trim().length > 0;
  req.auth = {
    userId: null,
    source: "",
    errorType: parsedBearer.errorType,
    tokenPresent: hasAuthHeader,
    sub: "",
  };

  if (parsedBearer.token) {
    if (!JWT_SECRET) {
      req.auth.errorType = "server_auth_unavailable";
      return next();
    }
    const verified = verifyJwtToken(parsedBearer.token);
    if (verified.ok) {
      req.auth.userId = verified.payload.sub;
      req.auth.source = "jwt";
      req.auth.errorType = "";
      req.auth.sub = verified.payload.sub;
      return next();
    }
    req.auth.errorType = verified.errorType;
    console.warn("[auth] token_rejected", {
      endpoint: req.originalUrl,
      errorType: verified.errorType,
      tokenPresent: true,
    });
  }

  // Legacy fallback kept for older local clients while JWT migration remains supported.
  if (!req.auth.userId && AUTH_ALLOW_LEGACY_X_USER_ID && !hasAuthHeader) {
    const legacyId = req.headers["x-user-id"];
    if (typeof legacyId === "string") {
      const trimmed = legacyId.trim();
      if (mongoose.Types.ObjectId.isValid(trimmed)) {
        req.auth.userId = trimmed;
        req.auth.source = "legacy_x_user_id";
        req.auth.sub = trimmed;
        req.auth.errorType = "";
        console.warn("[auth] legacy_fallback_used", {
          endpoint: req.originalUrl,
          userId: trimmed,
        });
      }
    }
  }

  return next();
});

const upload = multer({ storage: multer.memoryStorage() });
const GUIDE_UPLOAD_LIMIT = 25 * 1024 * 1024;
const SUPPORTED_GUIDE_LANGUAGES = new Set(["ro", "en"]);
const LEGACY_PDF_DEFAULT_LANGUAGE = "ro";
const isDev = process.env.NODE_ENV !== "production";
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || "8h").trim() || "8h";
const JWT_CLOCK_SKEW_SECONDS = Math.max(
  0,
  Number.parseInt(process.env.JWT_CLOCK_SKEW_SECONDS || "60", 10) || 60,
);
const AUTH_ALLOW_LEGACY_X_USER_ID = String(process.env.AUTH_ALLOW_LEGACY_X_USER_ID || "false")
  .trim()
  .toLowerCase() === "true";
const JWT_SECRET = String(process.env.JWT_SECRET || "");
const authTokenService = createAuthTokenService({
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: JWT_EXPIRES_IN,
  jwtClockSkewSeconds: JWT_CLOCK_SKEW_SECONDS,
  nodeEnv: process.env.NODE_ENV || "development",
});

const toSafeSegment = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const buildStableHash = (raw) => crypto.createHash("sha1").update(String(raw || ""), "utf8").digest("hex").slice(0, 8);

const devGuideLog = (...args) => {
  if (isDev) console.log("[guides-dev]", ...args);
};

function assertAuthConfiguration() {
  return authTokenService.assertAuthConfiguration();
}

function signAccessToken(user) {
  return authTokenService.signAccessToken(user);
}

function extractBearerToken(authorizationHeader) {
  return authTokenService.extractBearerToken(authorizationHeader);
}

function verifyJwtToken(token) {
  return authTokenService.verifyJwtToken(token);
}

const buildStableGuideKey = (raw, usedKeys = new Set()) => {
  const normalized = toSafeSegment(raw) || "item";
  if (!usedKeys.has(normalized)) {
    usedKeys.add(normalized);
    return normalized;
  }
  const hash = buildStableHash(raw);
  const withHash = `${normalized}-${hash}`;
  if (!usedKeys.has(withHash)) {
    usedKeys.add(withHash);
    return withHash;
  }
  let index = 2;
  let fallback = `${withHash}-${index}`;
  while (usedKeys.has(fallback)) {
    index += 1;
    fallback = `${withHash}-${index}`;
  }
  usedKeys.add(fallback);
  return fallback;
};

const guidePdfToDiskPath = (pdfPath) => {
  if (!String(pdfPath || "").startsWith("/guide-pdfs/")) {
    return "";
  }

  return path.join(GUIDE_ROOT, pdfPath.replace("/guide-pdfs/", ""));
};

const normalizeGuideLanguage = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return SUPPORTED_GUIDE_LANGUAGES.has(normalized) ? normalized : "";
};

const ensureSafeGuideDiskPath = (diskPath) => {
  const resolvedRoot = path.resolve(GUIDE_ROOT);
  const resolvedTarget = path.resolve(String(diskPath || ""));
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return resolvedTarget;
};

const safeGuidePdfDiskPath = (pdfPath) => ensureSafeGuideDiskPath(guidePdfToDiskPath(pdfPath));

const ensureGuideIndex = async () => {
  try {
    await fs.access(GUIDE_INDEX);
  } catch {
    await fs.mkdir(GUIDE_ROOT, { recursive: true });
    await fs.writeFile(GUIDE_INDEX, JSON.stringify([], null, 2));
  }
};

const loadGuideIndex = async () => {
  await ensureGuideIndex();
  const raw = await fs.readFile(GUIDE_INDEX, "utf8");
  const cleaned = raw.replace(/^\uFEFF/, "");
  const data = JSON.parse(cleaned);
  const normalized = normalizeGuideData(Array.isArray(data) ? data : []);

  let changed = false;
  for (const category of normalized) {
    for (const situation of category.situations || []) {
      for (const subcategory of situation.subcategories || []) {
        const hasPdfByLanguage = subcategory.pdfByLanguage && typeof subcategory.pdfByLanguage === "object";
        if (hasPdfByLanguage) {
          const nextMap = {};
          for (const [language, rawPath] of Object.entries(subcategory.pdfByLanguage)) {
            const lang = normalizeGuideLanguage(language);
            if (!lang) {
              changed = true;
              continue;
            }
            const pdfPathValue = String(rawPath || "").trim();
            if (!pdfPathValue.startsWith("/guide-pdfs/")) {
              nextMap[lang] = "";
              changed = true;
              continue;
            }
            const diskPathValue = safeGuidePdfDiskPath(pdfPathValue);
            if (!diskPathValue) {
              nextMap[lang] = "";
              changed = true;
              continue;
            }
            try {
              await fs.access(diskPathValue);
              nextMap[lang] = pdfPathValue;
            } catch {
              nextMap[lang] = "";
              changed = true;
            }
          }
          subcategory.pdfByLanguage = nextMap;
          continue;
        }

        const pdfPath = String(subcategory.pdf || "").trim();
        if (!pdfPath.startsWith("/guide-pdfs/")) continue;
        const diskPath = safeGuidePdfDiskPath(pdfPath);
        if (!diskPath) {
          subcategory.pdf = "";
          changed = true;
          continue;
        }
        try {
          await fs.access(diskPath);
        } catch {
          subcategory.pdf = "";
          changed = true;
        }
      }
    }
  }

  if (changed) {
    await saveGuideIndex(normalized);
  }

  return normalized;
};

const saveGuideIndex = async (data) => {
  await fs.writeFile(GUIDE_INDEX, JSON.stringify(normalizeGuideData(data), null, 2));
};

// Import models
const User = require("../models/User");
const Product = require("../models/Product");
const Anunt = require("../models/Anunt");
const SOSAlert = require("../models/SOSAlert");
const Incident = require("../models/Incident");
const News = require("../models/News");
const Notification = require("../models/Notification");
const EmergencyCopilotSession = require("../models/EmergencyCopilotSession");
const aiChatHandler = require("../ai/ai-chat");
const { parseLatLon } = require("../utils/parseLatLon");
const { buildDashboardIntelligence } = require("./services/dashboardIntelligence");
const { buildPersonalRiskPayload } = require("./services/riskSnapshotService");
const { buildSituationalAwareness } = require("./services/situationalAwarenessEngine");
const {
  normalizeTranslationLanguage,
  translateNewsDocument,
} = require("./services/newsTranslationService");
const {
  buildApproximateLocationLabel,
  buildSosTimelineEntry,
  normalizeSosContacts,
  normalizeSosLocation,
} = require("./services/sosLifecycleService");
const {
  createCopilotSession,
  appendCopilotMessage,
  serializeCopilotSession,
  answerCommunicationMessage,
  getEmergencyCopilotRuntimeInfo,
} = require("./services/emergencyCopilotService");
const {
  ALLOWLISTS: INCLUSION_ALLOWLISTS,
  normalizeInclusionProfile,
  serializeInclusionProfile,
  buildOperationalInclusionSummary,
} = require("./services/inclusionProfileService");

function getUserIdFromRequest(req) {
  if (req?.auth?.userId && mongoose.Types.ObjectId.isValid(String(req.auth.userId))) {
    return String(req.auth.userId);
  }
  return null;
}

function buildPublicAuthErrorMessage(req) {
  const type = String(req?.auth?.errorType || "");
  if (type === "expired_token") return "Sesiunea a expirat. Autentifica-te din nou.";
  if (type === "malformed_token" || type === "invalid_signature" || type === "invalid_claims" || type === "invalid_token") {
    return "Token invalid. Autentifica-te din nou.";
  }
  return "Autentificare necesara.";
}

function respondUnauthorized(req, res) {
  const errorType = String(req?.auth?.errorType || "missing_token");
  res.set("x-auth-required", "1");
  res.status(401).json({
    error: buildPublicAuthErrorMessage(req),
    authError: errorType,
  });
}

function isOperatorUser(userDoc) {
  const role = String(userDoc?.role || userDoc?.user_role || "")
    .trim()
    .toLowerCase();
  return role === "employee";
}

function buildIncidentsVisibilityQuery({ status = "", includeStale = false } = {}) {
  const query = status ? { status } : {};

  if (!includeStale) {
    const cutoff = new Date(Date.now() - INCIDENTS_VISIBLE_MAX_AGE_HOURS * 60 * 60 * 1000);
    query.$or = [
      { source: { $exists: false } },
      { source: { $not: INCIDENT_AUTOMATED_SOURCE_REGEX } },
      {
        source: { $regex: INCIDENT_AUTOMATED_SOURCE_REGEX },
        riskUpdatedAt: { $gte: cutoff },
      },
    ];
  }

  return query;
}

async function requireOperator(req, res) {
  const requestUser = await getRequestUser(req);
  if (!requestUser) {
    respondUnauthorized(req, res);
    return null;
  }
  if (!isOperatorUser(requestUser)) {
    res.status(403).json({ error: "Acces permis doar operatorilor." });
    return null;
  }
  return requestUser;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function severityToDangerScore(severity) {
  switch (String(severity || "").toLowerCase()) {
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

const DEFAULT_GUIDE_META = {
  updatedAt: null,
  owner: "",
  tags: [],
  audience: [],
  incidentTypes: [],
  offlineEligible: false,
};

const INCIDENT_TASK_TEMPLATES = {
  earthquake: [
    { title: "Verifica siguranta structurala", priority: "critical" },
    { title: "Confirma starea persoanelor vulnerabile", priority: "high" },
    { title: "Trimite instructiuni de evacuare", priority: "high" },
  ],
  fire: [
    { title: "Izoleaza zona afectata", priority: "critical" },
    { title: "Coordoneaza punctele medicale", priority: "high" },
    { title: "Actualizeaza statusul resurselor", priority: "medium" },
  ],
  flood: [
    { title: "Verifica rutele de evacuare", priority: "critical" },
    { title: "Directioneaza populatia spre adaposturi", priority: "high" },
    { title: "Monitorizeaza nivelul apei", priority: "medium" },
  ],
  medical: [
    { title: "Confirma locatia exacta", priority: "critical" },
    { title: "Alerteaza echipele medicale", priority: "high" },
    { title: "Pastreaza canalul deschis cu solicitantul", priority: "medium" },
  ],
};

function normalizeGuideSubcategory(subcategory) {
  const row = subcategory && typeof subcategory === "object" ? subcategory : {};
  const rawPdfByLanguage = row.pdfByLanguage && typeof row.pdfByLanguage === "object"
    ? row.pdfByLanguage
    : null;
  const normalizedPdfByLanguage = rawPdfByLanguage
    ? Object.entries(rawPdfByLanguage).reduce((acc, [language, pdfPath]) => {
        const lang = normalizeGuideLanguage(language);
        if (!lang) return acc;
        acc[lang] = String(pdfPath || "").trim();
        return acc;
      }, {})
    : null;
  return {
    subcategoryId: String(row.subcategoryId || "").trim(),
    title: String(row.title || "").trim(),
    pdf: String(row.pdf || ""),
    ...(normalizedPdfByLanguage ? { pdfByLanguage: normalizedPdfByLanguage } : {}),
    updatedAt: row.updatedAt || null,
    owner: String(row.owner || ""),
    tags: Array.isArray(row.tags) ? row.tags.map((item) => String(item)).filter(Boolean) : [],
    audience: Array.isArray(row.audience)
      ? row.audience.map((item) => String(item)).filter(Boolean)
      : [],
    incidentTypes: Array.isArray(row.incidentTypes)
      ? row.incidentTypes.map((item) => String(item)).filter(Boolean)
      : [],
    offlineEligible: Boolean(row.offlineEligible),
  };
}

function normalizeGuideData(data) {
  const usedCategoryKeys = new Set();
  return (Array.isArray(data) ? data : []).map((category) => {
    const categoryName = String(category?.category || "").trim();
    const categoryKey = String(category?.categoryKey || "").trim() || buildStableGuideKey(categoryName, usedCategoryKeys);
    const usedSituationKeys = new Set();
    const situations = Array.isArray(category?.situations)
      ? category.situations.map((situation) => {
          const situationName = String(situation?.name || "").trim();
          const situationKey = String(situation?.situationKey || "").trim() || buildStableGuideKey(`${categoryKey}:${situationName}`, usedSituationKeys);
          const usedSubcategoryIds = new Set();
          const subcategories = Array.isArray(situation?.subcategories)
            ? situation.subcategories
                .map(normalizeGuideSubcategory)
                .filter((item) => item.title)
                .map((item) => ({
                  ...item,
                  subcategoryId: item.subcategoryId || buildStableGuideKey(`${categoryKey}:${situationKey}:${item.title}`, usedSubcategoryIds),
                }))
            : [];
          return {
            name: situationName,
            situationKey,
            subcategories,
          };
        })
      : [];

    return {
      category: categoryName,
      categoryKey,
      description: String(category?.description || ""),
      situations,
    };
  });
}

function findGuideRowsByKeys(data, { categoryKey, situationKey, subcategoryId }) {
  const categoryRow = data.find((row) => row.categoryKey === categoryKey);
  if (!categoryRow) return {};
  const situationRow = (categoryRow.situations || []).find((row) => row.situationKey === situationKey);
  if (!situationRow) return { categoryRow };
  const subRow = subcategoryId
    ? (situationRow.subcategories || []).find((row) => row.subcategoryId === subcategoryId)
    : null;
  return { categoryRow, situationRow, subRow };
}

function findGuideRowsByLabels(data, { category, situation, subcategoryTitle }) {
  const categoryMatches = data.filter((row) => row.category === category);
  if (categoryMatches.length !== 1) return { ambiguous: categoryMatches.length > 1 };
  const categoryRow = categoryMatches[0];
  const situationMatches = (categoryRow.situations || []).filter((row) => row.name === situation);
  if (situationMatches.length !== 1) return { categoryRow, ambiguous: situationMatches.length > 1 };
  const situationRow = situationMatches[0];
  if (!subcategoryTitle) return { categoryRow, situationRow };
  const subMatches = (situationRow.subcategories || []).filter((row) => row.title === subcategoryTitle);
  if (subMatches.length !== 1) return { categoryRow, situationRow, ambiguous: subMatches.length > 1 };
  return { categoryRow, situationRow, subRow: subMatches[0] };
}

function resolveGuideIdentity({ data, body, endpointName, requireSubcategory = false }) {
  const categoryKey = String(body?.categoryKey || "").trim();
  const situationKey = String(body?.situationKey || "").trim();
  const subcategoryId = String(body?.subcategoryId || "").trim();
  const hasAnyStableIds = Boolean(categoryKey || situationKey || subcategoryId);
  const hasAllStableIdsForSub = Boolean(categoryKey && situationKey && (!requireSubcategory || subcategoryId));

  if (hasAnyStableIds) {
    if (!hasAllStableIdsForSub) {
      if (isDev) devGuideLog(endpointName, "reject_partial_keys", { categoryKey, situationKey, subcategoryId });
      return { error: "Cheile stabile sunt incomplete.", status: 400 };
    }
    const byKeys = findGuideRowsByKeys(data, { categoryKey, situationKey, subcategoryId });
    if (!byKeys.categoryRow || !byKeys.situationRow || (requireSubcategory && !byKeys.subRow)) {
      if (isDev) devGuideLog(endpointName, "reject_inconsistent_keys", { categoryKey, situationKey, subcategoryId });
      return { error: "Cheile stabile nu corespund structurii ghidului.", status: 409 };
    }
    return { ...byKeys, categoryKey, situationKey, subcategoryId, legacyFallbackUsed: false };
  }

  const category = String(body?.category || "").trim();
  const situation = String(body?.situation || "").trim();
  const subcategoryTitle = String(body?.subcategoryTitle || "").trim();
  if (!category || !situation || (requireSubcategory && !subcategoryTitle)) {
    return { error: "Categoria, situatia si subcategoria sunt obligatorii.", status: 400 };
  }
  const byLabels = findGuideRowsByLabels(data, { category, situation, subcategoryTitle });
  if (byLabels.ambiguous) {
    if (isDev) devGuideLog(endpointName, "reject_ambiguous_legacy_lookup", { category, situation, subcategoryTitle });
    return { error: "Identificare ambigua pe label legacy.", status: 409 };
  }
  if (!byLabels.categoryRow || !byLabels.situationRow || (requireSubcategory && !byLabels.subRow)) {
    return { error: "Categoria/situatia/subcategoria nu exista.", status: 404 };
  }
  if (isDev) {
    devGuideLog(endpointName, "legacy_fallback_used", {
      missing: ["categoryKey", "situationKey", requireSubcategory ? "subcategoryId" : ""].filter(Boolean),
      resolved: {
        categoryKey: byLabels.categoryRow.categoryKey,
        situationKey: byLabels.situationRow.situationKey,
        subcategoryId: byLabels.subRow?.subcategoryId || "",
      },
    });
  }
  return {
    ...byLabels,
    categoryKey: byLabels.categoryRow.categoryKey,
    situationKey: byLabels.situationRow.situationKey,
    subcategoryId: byLabels.subRow?.subcategoryId || "",
    legacyFallbackUsed: true,
  };
}

function buildIncidentChannelId(incidentId) {
  return `incident:${incidentId}`;
}

function normalizeIncidentActor(input = {}) {
  const userId = input.userId && mongoose.Types.ObjectId.isValid(String(input.userId))
    ? String(input.userId)
    : null;
  return {
    userId,
    name: String(input.name || "").trim(),
    role: String(input.role || "customer").trim() || "customer",
    status: String(input.status || "").trim(),
  };
}

function serializeIncident(incidentDoc) {
  const incident = incidentDoc?.toObject ? incidentDoc.toObject() : incidentDoc;
  if (!incident) return null;
  return {
    ...incident,
    id: String(incident._id),
    _id: String(incident._id),
    channelId: buildIncidentChannelId(String(incident._id)),
    assignedUsers: Array.isArray(incident.assignedUsers)
      ? incident.assignedUsers.map((entry) => normalizeIncidentActor(entry))
      : [],
    tasks: Array.isArray(incident.tasks)
      ? incident.tasks.map((task) => ({
          ...task,
          id: String(task._id),
          _id: String(task._id),
        }))
      : [],
    resources: Array.isArray(incident.resources)
      ? incident.resources.map((resource) => ({
          ...resource,
          id: String(resource._id),
          _id: String(resource._id),
        }))
      : [],
    guides: Array.isArray(incident.guides)
      ? incident.guides.map((guide) => ({
          ...guide,
          id: String(guide._id),
          _id: String(guide._id),
        }))
      : [],
    dangerScore: Number.isFinite(Number(incident.dangerScore)) ? Number(incident.dangerScore) : 50,
    riskUpdatedAt: incident.riskUpdatedAt || incident.updatedAt || incident.createdAt,
    location: incident.location
      ? {
          ...incident.location,
          radiusKm: Number.isFinite(Number(incident.location?.radiusKm))
            ? Number(incident.location.radiusKm)
            : 0,
        }
      : {},
  };
}

function serializeNews(newsDoc, options = {}) {
  const { includeContent = false, translation = null } = options;
  const news = newsDoc?.toObject ? newsDoc.toObject() : newsDoc;
  if (!news) return null;
  const summary = String(news.summary || "").trim();
  const content = String(news.content || "").trim();
  const translatedSummary = String(translation?.summary || "").trim();
  const translatedContent = String(translation?.content || "").trim();
  return {
    id: String(news._id),
    _id: String(news._id),
    title: String(translation?.title || news.title || "").trim(),
    summary: translatedSummary || summary || (content ? content.slice(0, 280) : ""),
    source: String(news.source || "").trim(),
    articleUrl: String(news.articleUrl || "").trim(),
    imageUrl: String(news.imageUrl || "").trim(),
    tags: Array.isArray(news.tags) ? news.tags.filter(Boolean).map((item) => String(item)) : [],
    publishedAt: news.publishedAt || news.updatedAt || news.createdAt || null,
    severityScore: Number.isFinite(Number(news.severityScore)) ? Number(news.severityScore) : 0,
    ...(translation?.translationLanguage
      ? {
          translationLanguage: translation.translationLanguage,
          translationStatus: translation.translationStatus || "translated",
        }
      : {}),
    ...(includeContent ? { content: translatedContent || content } : {}),
  };
}

async function getRequestUser(req) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return null;
  try {
    return await User.findById(userId).lean();
  } catch {
    return null;
  }
}

function toActorFromUser(userDoc) {
  if (!userDoc) {
    return { userId: null, name: "Anonymous", role: "customer", status: "" };
  }
  return {
    userId: String(userDoc._id),
    name: userDoc.username || userDoc.email || "Operator",
    role: userDoc.role || userDoc.user_role || "customer",
    status: userDoc.presenceStatus || "",
  };
}

function emitNotification(payload) {
  const normalized = {
    id: payload.id || `notif-${Date.now()}`,
    createdAt: payload.createdAt || new Date().toISOString(),
    type: payload.type || "info",
    source: payload.source || "system",
    status: payload.status || "active",
    audience: payload.audience || "all",
    isPinned: Boolean(payload.isPinned),
    ...payload,
  };

  Notification.create({
    title: normalized.title || "Notification",
    message: normalized.message || "Notification noua",
    type: normalized.type,
    link: normalized.link || "",
    source: normalized.source,
    audience: normalized.audience,
    status: normalized.status,
    isPinned: normalized.isPinned,
    priority: normalized.priority || "medium",
    relatedAlertId: mongoose.Types.ObjectId.isValid(String(normalized.relatedAlertId || ""))
      ? normalized.relatedAlertId
      : null,
    relatedIncidentId: mongoose.Types.ObjectId.isValid(String(normalized.relatedIncidentId || ""))
      ? normalized.relatedIncidentId
      : null,
    requiresAction: Boolean(normalized.requiresAction),
    resolvedAt: normalized.resolvedAt ? new Date(normalized.resolvedAt) : null,
    createdAt: normalized.createdAt ? new Date(normalized.createdAt) : undefined,
    updatedAt: normalized.createdAt ? new Date(normalized.createdAt) : undefined,
  })
    .then((notification) => {
      io.emit("notification:new", serializeNotification(notification) || normalized);
    })
    .catch((err) => {
      console.error("Notification persistence error:", err);
      io.emit("notification:new", normalized);
    });
}

function serializeNotification(notificationDoc) {
  if (!notificationDoc) return null;
  const docId = notificationDoc._id || notificationDoc.id;
  return {
    id: docId ? String(docId) : `notif-${Date.now()}`,
    title: String(notificationDoc.title || "").trim(),
    message: String(notificationDoc.message || "").trim(),
    type: String(notificationDoc.type || "info").trim() || "info",
    link: String(notificationDoc.link || "").trim(),
    source: String(notificationDoc.source || "manual").trim() || "manual",
    audience: String(notificationDoc.audience || "all").trim() || "all",
    status: String(notificationDoc.status || "active").trim() || "active",
    isPinned: Boolean(notificationDoc.isPinned),
    priority: String(notificationDoc.priority || "medium").trim() || "medium",
    relatedAlertId: notificationDoc.relatedAlertId ? String(notificationDoc.relatedAlertId) : null,
    relatedIncidentId: notificationDoc.relatedIncidentId ? String(notificationDoc.relatedIncidentId) : null,
    requiresAction: Boolean(notificationDoc.requiresAction),
    resolvedAt: notificationDoc.resolvedAt || null,
    createdAt: notificationDoc.createdAt || null,
    updatedAt: notificationDoc.updatedAt || null,
  };
}

function serializeSosAlert(alertDoc) {
  const alert = alertDoc?.toObject ? alertDoc.toObject() : alertDoc;
  if (!alert) return null;
  return {
    ...alert,
    id: alert._id ? String(alert._id) : String(alert.id || ""),
    _id: alert._id ? String(alert._id) : String(alert.id || ""),
    incidentId: alert.incidentId ? String(alert.incidentId) : null,
    userId: alert.userId ? String(alert.userId) : null,
  };
}

function buildSosNotificationPayload(alertDoc, incidentDoc, { resolved = false } = {}) {
  const alert = alertDoc?.toObject ? alertDoc.toObject() : alertDoc;
  const incident = incidentDoc?.toObject ? incidentDoc.toObject() : incidentDoc;
  const locationLabel = buildApproximateLocationLabel(alert?.lastKnownLocation || alert?.initialLocation || alert?.location);
  const alertId = alert?._id || alert?.id;
  const incidentId = incident?._id || incident?.id || alert?.incidentId;
  return {
    type: "sos",
    title: resolved ? "SOS alert resolved" : "SOS alert active",
    message: resolved
      ? `SOS rezolvat pentru ${locationLabel}.`
      : `SOS critic activ in ${locationLabel}.`,
    link: incidentId ? `/incidents/${incidentId}` : "/sos",
    source: "sos",
    audience: "all",
    status: resolved ? "archived" : "active",
    priority: "critical",
    relatedAlertId: alertId,
    relatedIncidentId: incidentId,
    requiresAction: !resolved,
    resolvedAt: resolved ? new Date() : null,
    isPinned: !resolved,
  };
}

async function upsertSosNotification(alertDoc, incidentDoc, options = {}) {
  const payload = buildSosNotificationPayload(alertDoc, incidentDoc, options);
  const alertId = payload.relatedAlertId;
  let notification = null;
  if (mongoose.Types.ObjectId.isValid(String(alertId || ""))) {
    notification = await Notification.findOneAndUpdate(
      { type: "sos", relatedAlertId: alertId },
      {
        $set: {
          title: payload.title,
          message: payload.message,
          link: payload.link,
          source: payload.source,
          audience: payload.audience,
          status: payload.status,
          priority: payload.priority,
          relatedAlertId: payload.relatedAlertId,
          relatedIncidentId: mongoose.Types.ObjectId.isValid(String(payload.relatedIncidentId || ""))
            ? payload.relatedIncidentId
            : null,
          requiresAction: payload.requiresAction,
          resolvedAt: payload.resolvedAt,
          isPinned: payload.isPinned,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } else {
    notification = await Notification.create(payload).then((doc) => doc.toObject());
  }
  const serialized = serializeNotification(notification);
  if (serialized) io.emit("notification:new", serialized);
  return serialized;
}

function emitSosAlertUpdated(alertDoc, extra = {}) {
  const alert = serializeSosAlert(alertDoc);
  if (!alert) return;
  io.emit("sos-alert-updated", { alertId: alert.id, alert, ...extra });
}

function emitIncidentUpdate(kind, incidentDoc) {
  const incident = serializeIncident(incidentDoc);
  if (!incident) return;
  io.emit("incident:update", { kind, incident });
}

async function resolveSosIncident(incidentDoc, {
  message = "Incident inchis automat dupa expirarea alertei SOS.",
  actorName = "System",
  actorRole = "system",
} = {}) {
  if (!incidentDoc || String(incidentDoc.status || "").toLowerCase() === "resolved") {
    return incidentDoc;
  }

  const incident =
    typeof incidentDoc.save === "function"
      ? incidentDoc
      : await Incident.findById(incidentDoc._id || incidentDoc.id);
  if (!incident || String(incident.status || "").toLowerCase() === "resolved") {
    return incident;
  }

  incident.status = "resolved";
  incident.riskUpdatedAt = new Date();
  incident.timeline.push({
    kind: "resolved",
    message: String(message || "").trim().slice(0, 500) || "Incident inchis automat dupa expirarea alertei SOS.",
    actorName: String(actorName || "").trim() || "System",
    actorRole: String(actorRole || "").trim() || "system",
    at: new Date(),
  });
  await incident.save();
  emitIncidentUpdate("updated", incident);
  return incident;
}

async function reconcileExpiredSosAlerts() {
  const now = new Date();
  const expiredAlerts = await SOSAlert.find({
    status: "active",
    expiresAt: { $ne: null, $lte: now },
  }).select("_id incidentId expiresAt status").lean();

  if (!expiredAlerts.length) return 0;

  const alertIds = expiredAlerts.map((alert) => alert._id);
  await SOSAlert.updateMany(
    { _id: { $in: alertIds } },
    {
      $set: {
        status: "expired",
        resolvedAt: now,
        resolutionNotes: "Alerta SOS a expirat automat.",
      },
      $unset: {
        expiresAt: 1,
      },
    },
  );

  const incidentIds = expiredAlerts
    .map((alert) => alert.incidentId)
    .filter((value) => mongoose.Types.ObjectId.isValid(String(value || "")));

  if (incidentIds.length) {
    const incidents = await Incident.find({
      _id: { $in: incidentIds },
      source: "sos",
      status: { $ne: "resolved" },
    });
    for (const incident of incidents) {
      await resolveSosIncident(incident, {
        message: "Incident inchis automat dupa expirarea alertei SOS.",
        actorName: "System",
        actorRole: "system",
      });
    }
  }

  return expiredAlerts.length;
}

async function persistSosLocationUpdate(alertId, locationInput, actor = null, source = "client") {
  if (!mongoose.Types.ObjectId.isValid(String(alertId || ""))) {
    return null;
  }
  const normalizedLocation = normalizeSosLocation(locationInput, source);
  if (!normalizedLocation) {
    return null;
  }
  const alert = await SOSAlert.findById(alertId);
  if (!alert) return null;
  alert.lastKnownLocation = normalizedLocation;
  alert.location = {
    lat: normalizedLocation.lat,
    lon: normalizedLocation.lng,
    accuracy: normalizedLocation.accuracy,
  };
  alert.locationHistory.push(normalizedLocation);
  alert.timeline.push(buildSosTimelineEntry(
    "location_updated",
    "Locatia SOS a fost actualizata.",
    actor,
    normalizedLocation.timestamp,
  ));
  await alert.save();
  return alert;
}

function buildIncidentNotifications(incidents, userId) {
  const safeUserId = userId ? String(userId) : "";
  return incidents.flatMap((incident) => {
    const items = [];
    if (incident.severity === "critical" && incident.status !== "resolved") {
      items.push({
        id: `critical-${incident._id}`,
        type: "critical_incident",
        title: incident.title,
        message: "Incident critic activ",
        link: `/incidents/${incident._id}`,
        createdAt: incident.updatedAt,
      });
    }

    const assignedToUser = Array.isArray(incident.assignedUsers)
      && incident.assignedUsers.some((entry) => String(entry.userId || "") === safeUserId);
    if (assignedToUser) {
      items.push({
        id: `assigned-${incident._id}`,
        type: "assignment",
        title: incident.title,
        message: "Ai o alocare activa pe incident",
        link: `/incidents/${incident._id}`,
        createdAt: incident.updatedAt,
      });
    }

    (incident.guides || []).slice(-2).forEach((guide) => {
      items.push({
        id: `guide-${incident._id}-${guide._id}`,
        type: "guide",
        title: guide.title || guide.subcategoryTitle,
        message: `Ghid atasat la ${incident.title}`,
        link: `/guide`,
        createdAt: guide.attachedAt || incident.updatedAt,
      });
    });

    return items;
  })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
}

function normalizeCoordinatesInput(input) {
  const lat = Number(input?.lat);
  const lon = Number(input?.lon ?? input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    accuracy: Number.isFinite(Number(input?.accuracy)) ? Number(input.accuracy) : null,
    timestamp: input?.timestamp || new Date().toISOString(),
  };
}

async function loadDashboardContext({ userId = null, newsLimit = 30, overrideLocation = null } = {}) {
  await reconcileExpiredSosAlerts();
  const normalizedUserId = userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? String(userId)
    : null;

  const user = normalizedUserId
    ? await User.findById(normalizedUserId).select("location inclusionProfile").lean().catch(() => null)
    : null;

  const location = overrideLocation || user?.location || null;
  const operationalInclusionSummary = buildOperationalInclusionSummary(user?.inclusionProfile);

  const incidents = await Incident.find({
    ...buildIncidentsVisibilityQuery({ includeStale: false }),
    status: { $in: ["open", "monitoring", "active", "contained"] },
  })
    .sort({ riskUpdatedAt: -1, updatedAt: -1 })
    .limit(200)
    .lean()
    .catch(() => []);

  const news = await News.find({ status: "active" })
    .sort({ publishedAt: -1, updatedAt: -1 })
    .limit(clampNumber(newsLimit, 1, 200, 30))
    .lean()
    .catch(() => []);

  return {
    user: user || null,
    userLocation: location || null,
    operationalInclusionSummary,
    incidents,
    news,
  };
}

function buildOverrideLocation(coords, fallbackName = "Ad-hoc location") {
  if (!coords) return null;
  return {
    name: String(fallbackName || "").trim() || "Ad-hoc location",
    raw: `${coords.lat}, ${coords.lon}`,
    coordinates: {
      lat: coords.lat,
      lon: coords.lon,
    },
  };
}

async function buildRiskAndSituationContext({ userId = null, newsLimit = 20, overrideLocation = null } = {}) {
  const dashboardContext = await loadDashboardContext({
    userId,
    newsLimit,
    overrideLocation,
  });
  const riskPayload = await buildPersonalRiskPayload({
    incidents: dashboardContext.incidents,
    news: dashboardContext.news,
    userLocation: dashboardContext.userLocation,
    userId,
    operationalInclusionSummary: dashboardContext.operationalInclusionSummary,
  });
  const situationPayload = await buildSituationalAwareness({
    incidents: dashboardContext.incidents,
    news: dashboardContext.news,
    userLocation: dashboardContext.userLocation,
    riskPayload,
  });
  return {
    dashboardContext,
    riskPayload,
    situationPayload,
  };
}

async function createCopilotSessionFromIds({
  userId = null,
  incidentId = null,
  sosAlertId = null,
  location = null,
  language = "ro",
}) {
  const incident = incidentId && mongoose.Types.ObjectId.isValid(String(incidentId))
    ? await Incident.findById(incidentId).lean()
    : null;
  const sosAlert = sosAlertId && mongoose.Types.ObjectId.isValid(String(sosAlertId))
    ? await SOSAlert.findById(sosAlertId).lean()
    : null;

  const normalizedLocation = normalizeCoordinatesInput(location || sosAlert?.location || {});
  const overrideLocation = buildOverrideLocation(normalizedLocation, "Emergency location");
  const { riskPayload, situationPayload } = await buildRiskAndSituationContext({
    userId,
    newsLimit: 20,
    overrideLocation,
  });
  const guideIndex = await loadGuideIndex();
  return createCopilotSession({
    userId,
    incident,
    sosAlert,
    riskPayload,
    situationPayload,
    guideIndex,
    language: String(language || "ro").trim() || "ro",
    userLocation: normalizedLocation,
    operationalInclusionSummary: sosAlert?.operationalInclusionSummary || incident?.operationalInclusionSummary || null,
  });
}

async function appendCopilotMessageFromRequest({
  sessionId,
  userId = null,
  message,
  location = null,
  language = "",
}) {
  const session = await EmergencyCopilotSession.findById(sessionId).lean();
  if (!session) {
    const notFoundError = new Error("Sesiunea copilot nu a fost gasita.");
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  const resolvedUserId = userId || (session.userId ? String(session.userId) : null);
  const incident = session.incidentId ? await Incident.findById(session.incidentId).lean() : null;
  const sosAlert = session.sosAlertId ? await SOSAlert.findById(session.sosAlertId).lean() : null;
  const normalizedLocation = normalizeCoordinatesInput(location || sosAlert?.location || {});
  const overrideLocation = buildOverrideLocation(normalizedLocation, "Emergency location");
  const { riskPayload, situationPayload } = await buildRiskAndSituationContext({
    userId: resolvedUserId,
    newsLimit: 20,
    overrideLocation,
  });
  const guideIndex = await loadGuideIndex();
  return appendCopilotMessage({
    sessionId,
    userMessage: message,
    incident,
    riskPayload,
    situationPayload,
    guideIndex,
    userLocation: normalizedLocation,
    operationalInclusionSummary: session.operationalInclusionSummary || sosAlert?.operationalInclusionSummary || incident?.operationalInclusionSummary || null,
    language: String(language || "").trim(),
  });
}

async function loadSerializedCopilotSessionById(sessionId) {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    const invalidError = new Error("ID sesiune invalid.");
    invalidError.statusCode = 400;
    throw invalidError;
  }
  const session = await EmergencyCopilotSession.findById(sessionId).lean();
  if (!session) {
    const notFoundError = new Error("Sesiunea copilot nu a fost gasita.");
    notFoundError.statusCode = 404;
    throw notFoundError;
  }
  return serializeCopilotSession(session);
}

// [All original functions copied - normalizePresenceStatus, normalizeItemCode, etc.]
// [toSafeUser, authMiddleware, ensureProductCodes, etc. - exact from original]

function formatMongoStartupError(err) {
  const message = String(err?.message || err || "");

  if (message.includes("querySrv ECONNREFUSED")) {
    return `${message}. DNS/SRV lookup for the MongoDB Atlas cluster was refused. Check your network, DNS, VPN/firewall, or try a non-SRV Mongo URI.`;
  }

  if (message.includes("querySrv ENOTFOUND")) {
    return `${message}. The MongoDB Atlas hostname could not be resolved. Check the cluster hostname and DNS access.`;
  }

  return message;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function connectToMongo() {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  if (!mongoUri) {
    throw new Error("MONGO_URI is missing from the backend environment.");
  }

  await withTimeout(
    mongoose.connect(mongoUri, {
      dbName: process.env.MONGO_DB || undefined,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000,
      family: 4,
    }),
    12000,
    "MongoDB startup timed out after 12 seconds. Check DNS/network access to the configured cluster.",
  );

  console.log("Connected to MongoDB!");
}

async function loadMessages() {
  try {
    const data = await fs.readFile(CHAT_FILE, "utf8");
    const arr = JSON.parse(data);
    if (!Array.isArray(arr)) return [];
    return arr.map((m) => ({
      ...m,
      channelId: m.channelId || "global",
      replyTo: m.replyTo || null,
      mentions: Array.isArray(m.mentions) ? m.mentions : [],
    }));
  } catch {
    return [];
  }
}

function extractMentions(text) {
  if (!text || typeof text !== "string") return [];
  const found = text.match(/@([\w._-]{2,40})/g);
  if (!found) return [];
  return [...new Set(found.map((x) => x.slice(1).toLowerCase()))];
}

function normalizeAvatar(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed.slice(0, 6_000_000);
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 2000);
  return "";
}

function isAllowedChannelId(channelId) {
  if (!channelId || typeof channelId !== "string") return false;
  if (channelId === "global") return true;
  if (channelId.startsWith("dm:") && channelId.length > 4 && channelId.length < 200) return true;
  if (channelId.startsWith("incident:") && channelId.length > 10 && channelId.length < 200) return true;
  return false;
}

function toPublicUser(userDoc) {
  const u = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  const id = String(u._id);
  let profilePicture = null;
  const binary = u.profilePicture?.data;
  const contentType = u.profilePicture?.contentType;
  if (binary && contentType) {
    let asBuffer = null;
    if (Buffer.isBuffer(binary)) {
      asBuffer = binary;
    } else if (binary?.buffer && (binary instanceof Uint8Array || ArrayBuffer.isView(binary))) {
      asBuffer = Buffer.from(binary.buffer, binary.byteOffset || 0, binary.byteLength);
    } else if (binary?.buffer && Buffer.isBuffer(binary.buffer)) {
      asBuffer = binary.buffer;
    } else if (typeof binary?.toString === "function") {
      try {
        const maybe = binary.toString("base64");
        if (typeof maybe === "string" && maybe.length > 16) {
          profilePicture = `data:${contentType};base64,${maybe}`;
        }
      } catch {
        // ignore conversion errors
      }
    }
    if (!profilePicture && asBuffer) {
      profilePicture = `data:${contentType};base64,${asBuffer.toString("base64")}`;
    }
  }
  return {
    id,
    _id: id,
    username: u.username,
    email: u.email,
    theme: u.theme || "light",
    role: u.role || "customer",
    presenceStatus: u.presenceStatus || "available",
    ...(u.createdAt ? { createdAt: u.createdAt } : {}),
    ...(u.inclusionProfile ? { inclusionProfile: serializeInclusionProfile(u.inclusionProfile) } : {}),
    ...(profilePicture ? { profilePicture } : {}),
  };
}

async function uniqueUsernameFromEmail(email) {
  const raw = (String(email).split("@")[0] || "user").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24);
  let base = raw.length >= 3 ? raw : `user_${raw}`.slice(0, 24);
  if (base.length < 3) base = "user";
  let candidate = base;
  let n = 0;
  while (await User.findOne({ username: candidate })) {
    n += 1;
    candidate = `${base}_${n}`.slice(0, 30);
  }
  return candidate;
}

async function saveMessages(messages) {
  await fs.mkdir(path.dirname(CHAT_FILE), { recursive: true });
  await fs.writeFile(CHAT_FILE, JSON.stringify(messages, null, 2));
}

async function cleanupOldMessages() {
  const messages = await loadMessages();
  const now = Date.now();
  const recent = messages.filter(msg => now - new Date(msg.timestamp).getTime() <= TWENTY_FOUR_HOURS);
  if (recent.length !== messages.length) {
    await saveMessages(recent);
    io.emit('messagesUpdate', recent);
  }
}

// Socket.io - Combined handler for chat and SOS
io.on("connection", async (socket) => {
  console.log("User connected:", socket.id, "| active sockets:", io.engine.clientsCount);
  await cleanupOldMessages();

  // ---- Chat events ----
  socket.on("join", async ({ name, userId, avatar }) => {
    onlineUsers.set(socket.id, {
      name: name || "Anonymous",
      userId: userId || "guest",
      avatar: normalizeAvatar(avatar),
    });
    io.emit("onlineUsers", Array.from(onlineUsers.values()));
    const prev = socketChatChannel.get(socket.id);
    if (prev) socket.leave(prev);
    socket.join("global");
    socketChatChannel.set(socket.id, "global");
  });

  socket.on("joinChatChannel", ({ channelId }) => {
    const ch = isAllowedChannelId(channelId) ? channelId : "global";
    const prev = socketChatChannel.get(socket.id);
    if (prev) socket.leave(prev);
    socket.join(ch);
    socketChatChannel.set(socket.id, ch);
  });

  socket.on("incident:join", ({ incidentId }) => {
    if (!incidentId) return;
    const ch = buildIncidentChannelId(String(incidentId).trim());
    const prev = socketChatChannel.get(socket.id);
    if (prev) socket.leave(prev);
    socket.join(ch);
    socketChatChannel.set(socket.id, ch);
  });

  socket.on("profileUpdate", ({ name, status, avatar }) => {
    const row = onlineUsers.get(socket.id);
    if (!row) return;
    row.name = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : row.name;
    if (typeof status === "string" && status.trim()) {
      row.status = status.trim().slice(0, 40);
    }
    if (typeof avatar === "string") {
      row.avatar = normalizeAvatar(avatar);
    }
    onlineUsers.set(socket.id, row);
    io.emit("onlineUsers", Array.from(onlineUsers.values()));
  });

  socket.on("message", async ({ text, channelId, replyTo }) => {
    const sender = onlineUsers.get(socket.id);
    if (!sender || !text || !String(text).trim()) return;
    const ch = isAllowedChannelId(channelId) ? channelId : "global";
    const trimmed = String(text).trim().slice(0, 4000);
    const message = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelId: ch,
      author: sender.name,
      authorId: sender.userId,
      authorAvatar: sender.avatar || "",
      text: trimmed,
      timestamp: new Date().toISOString(),
      reactedBy: [],
      mentions: extractMentions(trimmed),
      replyTo:
        replyTo && replyTo.id != null
          ? {
              id: replyTo.id,
              author: String(replyTo.author || "").slice(0, 60),
              text: String(replyTo.text || "").slice(0, 160),
            }
          : null,
    };
    const messages = await loadMessages();
    messages.push(message);
    await saveMessages(messages);
    io.to(ch).emit("message", message);
  });

  socket.on("incident:message", async ({ incidentId, text, replyTo }) => {
    if (!incidentId) return;
    const sender = onlineUsers.get(socket.id);
    if (!sender || !text || !String(text).trim()) return;
    const ch = buildIncidentChannelId(String(incidentId).trim());
    const trimmed = String(text).trim().slice(0, 4000);
    const message = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelId: ch,
      author: sender.name,
      authorId: sender.userId,
      authorAvatar: sender.avatar || "",
      text: trimmed,
      timestamp: new Date().toISOString(),
      reactedBy: [],
      mentions: extractMentions(trimmed),
      replyTo:
        replyTo && replyTo.id != null
          ? {
              id: replyTo.id,
              author: String(replyTo.author || "").slice(0, 60),
              text: String(replyTo.text || "").slice(0, 160),
            }
          : null,
    };
    const messages = await loadMessages();
    messages.push(message);
    await saveMessages(messages);
    io.to(ch).emit("message", message);
  });

  socket.on("react", async ({ messageId }) => {
    const sender = onlineUsers.get(socket.id);
    if (!sender) return;
    const reactorId = String(sender.userId || socket.id);
    const messages = await loadMessages();
    const msgIdx = messages.findIndex((m) => String(m.id) === String(messageId));
    if (msgIdx === -1) return;
    if (!Array.isArray(messages[msgIdx].reactedBy)) {
      messages[msgIdx].reactedBy = [];
    }
    const hasReacted = messages[msgIdx].reactedBy.includes(reactorId);
    messages[msgIdx].reactedBy = hasReacted
      ? messages[msgIdx].reactedBy.filter((id) => id !== reactorId)
      : [...messages[msgIdx].reactedBy, reactorId];
    await saveMessages(messages);
    const ch = messages[msgIdx].channelId || "global";
    io.to(ch).emit("react", {
      messageId: messages[msgIdx].id,
      reactedByCount: messages[msgIdx].reactedBy.length,
      reactedBy: messages[msgIdx].reactedBy,
    });
  });

  // ---- SOS Emergency events ----
  socket.on("sos-alert", async (data) => {
    console.log("🚨 SOS Alert via socket:", data);
    // Broadcast to ALL clients (including sender for confirmation)
    io.emit("sos-alert", data);
  });

  socket.on("sos-location-update", async (data) => {
    console.log("📍 SOS Location Update:", data);
    const persistedAlert = await persistSosLocationUpdate(
      data?.alertId,
      data?.location,
      { name: "Realtime client", role: "client" },
      "socket",
    ).catch((err) => {
      console.error("SOS socket location persistence error:", err);
      return null;
    });
    io.emit("sos-location-update", {
      ...data,
      status: persistedAlert?.status || data?.status,
      lastKnownLocation: persistedAlert?.lastKnownLocation || data?.location,
    });
  });

  socket.on("family-alert", (data) => {
    console.log("👨‍👩‍👧‍👦 Family Alert via socket:", data);
    io.emit("family-alert", data);
  });

  // ---- Disconnect ----
  socket.on("disconnect", (reason) => {
    console.log("User disconnected:", socket.id, "| reason:", reason, "| active sockets:", io.engine.clientsCount);
    onlineUsers.delete(socket.id);
    socketChatChannel.delete(socket.id);
    io.emit("onlineUsers", Array.from(onlineUsers.values()));
  });
});

setInterval(cleanupOldMessages, 60 * 60 * 1000);

// API endpoint for initial messages load
app.get("/api/chat/messages", async (req, res) => {
  try {
    const channel = String(req.query.channel || "global").trim();
    const safe = isAllowedChannelId(channel) ? channel : "global";
    const messages = await loadMessages();
    res.json(messages.filter((m) => (m.channelId || "global") === safe));
  } catch {
    res.json([]);
  }
});

// Guide PDFs index
app.get("/api/guides", async (req, res) => {
  try {
    const data = await loadGuideIndex();
    res.json({ data });
  } catch (err) {
    console.error("GET /api/guides:", err);
    res.json({ data: [] });
  }
});

app.get("/api/guides/files", async (req, res) => {
  try {
    const data = await loadGuideIndex();
    const items = [];
    data.forEach((category) => {
      category.situations?.forEach((situation) => {
        situation.subcategories?.forEach((sub) => {
          items.push({
            category: category.category,
            situation: situation.name,
            subcategoryTitle: sub.title,
            pdf: sub.pdf,
            pdfByLanguage: sub.pdfByLanguage || null,
          });
        });
      });
    });
    res.json({ items });
  } catch (err) {
    console.error("GET /api/guides/files:", err);
    res.json({ items: [] });
  }
});

const guideUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: GUIDE_UPLOAD_LIMIT },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed."));
    }
    cb(null, true);
  },
});

app.post("/api/guides/upload", guideUpload.single("file"), async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const language = normalizeGuideLanguage(req.body?.language);
    if (!req.file) {
      return res.status(400).json({ error: "Fisierul PDF este obligatoriu." });
    }
    if (!language) {
      return res.status(400).json({ error: "Limba ghidului este obligatorie si trebuie sa fie ro sau en." });
    }
    const data = await loadGuideIndex();
    const resolved = resolveGuideIdentity({
      data,
      body: req.body || {},
      endpointName: "POST /api/guides/upload",
      requireSubcategory: true,
    });
    if (resolved.error) {
      return res.status(resolved.status || 400).json({ error: resolved.error });
    }

    const { categoryRow, situationRow, subRow, categoryKey, situationKey } = resolved;
    const subcategoryTitle = subRow.title;
    const fileBase =
      toSafeSegment(subcategoryTitle) ||
      toSafeSegment(path.parse(req.file.originalname).name) ||
      `pdf-${Date.now()}`;
    const filename = `${fileBase}-${language}.pdf`;
    const relativePath = `/guide-pdfs/${categoryKey}/${situationKey}/${filename}`;
    const targetDir = path.join(GUIDE_ROOT, categoryKey, situationKey);
    const targetDiskPath = ensureSafeGuideDiskPath(path.join(targetDir, filename));
    if (!targetDiskPath) {
      return res.status(400).json({ error: "Calea fisierului PDF este invalida." });
    }

    let previousLanguagePath = "";
    const allowReplace = String(req.query.replace || req.body.replace || "").toLowerCase() === "true";
    const hasPdfByLanguage = subRow.pdfByLanguage && typeof subRow.pdfByLanguage === "object";
    const legacyPdfCandidate = hasPdfByLanguage
      ? ""
      : (language === LEGACY_PDF_DEFAULT_LANGUAGE ? String(subRow.pdf || "").trim() : "");
    const existingLanguagePdf = hasPdfByLanguage
      ? String(subRow.pdfByLanguage?.[language] || "").trim()
      : legacyPdfCandidate;
    previousLanguagePath = existingLanguagePdf;
    if (existingLanguagePdf && !allowReplace) {
      return res.status(409).json({
        error: "Exista deja un PDF pentru aceasta subcategorie. Bifeaza inlocuire pentru a rescrie.",
      });
    }
    if (!hasPdfByLanguage) {
      const legacyPdf = String(subRow.pdf || "").trim();
      subRow.pdfByLanguage = {};
      if (legacyPdf && LEGACY_PDF_DEFAULT_LANGUAGE) {
        subRow.pdfByLanguage[LEGACY_PDF_DEFAULT_LANGUAGE] = legacyPdf;
      }
    }
    subRow.pdfByLanguage[language] = relativePath;
    if (language === LEGACY_PDF_DEFAULT_LANGUAGE && !hasPdfByLanguage) {
      subRow.pdf = "";
    }
    subRow.updatedAt = new Date().toISOString();
    subRow.owner = requestUser?.username || requestUser?.email || subRow.owner || "";

    if (previousLanguagePath === relativePath) {
      previousLanguagePath = "";
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetDiskPath, req.file.buffer);
    try {
      await saveGuideIndex(data);
    } catch (saveError) {
      try {
        await fs.unlink(targetDiskPath);
      } catch {
        // ignore rollback delete errors
      }
      throw saveError;
    }

    if (previousLanguagePath) {
      const oldPath = safeGuidePdfDiskPath(previousLanguagePath);
      if (oldPath && oldPath !== targetDiskPath) {
        try {
          await fs.access(oldPath);
          await fs.unlink(oldPath);
        } catch {
          // ignore delete errors
        }
      }
    }

    res.json({ success: true, pdf: relativePath, pdfByLanguage: subRow.pdfByLanguage || {} });
  } catch (err) {
    console.error("POST /api/guides/upload:", err);
    res.status(500).json({ error: "Eroare la upload PDF." });
  }
});

app.post("/api/guides/subcategory", async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const subcategoryTitle = String(req.body?.subcategoryTitle || "").trim();
    if (!subcategoryTitle) return res.status(400).json({ error: "Subcategoria este obligatorie." });
    if (String(subcategoryTitle).trim().length < 3) {
      return res.status(400).json({ error: "Subcategoria trebuie sa aiba minim 3 caractere." });
    }

    const data = await loadGuideIndex();
    const resolved = resolveGuideIdentity({
      data,
      body: req.body || {},
      endpointName: "POST /api/guides/subcategory",
      requireSubcategory: false,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { situationRow, categoryKey, situationKey } = resolved;
    if (!situationRow) {
      return res.status(404).json({ error: "Situatia nu exista." });
    }

    const exists = situationRow.subcategories.some((row) => row.title === subcategoryTitle);
    if (exists) {
      return res.status(409).json({ error: "Subcategoria exista deja." });
    }

    const usedSubcategoryIds = new Set((situationRow.subcategories || []).map((row) => String(row.subcategoryId || "")));
    const subcategoryId = buildStableGuideKey(`${categoryKey}:${situationKey}:${subcategoryTitle}`, usedSubcategoryIds);
    situationRow.subcategories.push({
      ...DEFAULT_GUIDE_META,
      subcategoryId,
      title: subcategoryTitle,
      pdf: "",
      updatedAt: new Date().toISOString(),
      owner: requestUser?.username || requestUser?.email || "",
    });
    await saveGuideIndex(data);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/guides/subcategory:", err);
    res.status(500).json({ error: "Eroare la adaugare subcategorie." });
  }
});

app.patch("/api/guides/remove-pdf", async (req, res) => {
  try {
    const language = normalizeGuideLanguage(req.body?.language);
    if (!language) {
      return res.status(400).json({ error: "Categoria, situatia, subcategoria si limba (ro/en) sunt obligatorii." });
    }
    const data = await loadGuideIndex();
    const resolved = resolveGuideIdentity({
      data,
      body: req.body || {},
      endpointName: "PATCH /api/guides/remove-pdf",
      requireSubcategory: true,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { subRow } = resolved;

    const hasPdfByLanguage = subRow.pdfByLanguage && typeof subRow.pdfByLanguage === "object";
    const legacyPath = !hasPdfByLanguage && language === LEGACY_PDF_DEFAULT_LANGUAGE
      ? String(subRow.pdf || "").trim()
      : "";
    const languagePath = hasPdfByLanguage
      ? String(subRow.pdfByLanguage?.[language] || "").trim()
      : legacyPath;
    if (languagePath) {
      const diskPath = safeGuidePdfDiskPath(languagePath);
      if (diskPath) {
        try {
          await fs.access(diskPath);
          await fs.unlink(diskPath);
        } catch {
          // ignore missing file/delete errors
        }
      }
    }

    if (hasPdfByLanguage) {
      subRow.pdfByLanguage[language] = "";
    } else if (language === LEGACY_PDF_DEFAULT_LANGUAGE) {
      subRow.pdf = "";
    }
    subRow.updatedAt = new Date().toISOString();
    await saveGuideIndex(data);
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/guides/remove-pdf:", err);
    res.status(500).json({ error: "Eroare la stergere PDF." });
  }
});

app.delete("/api/guides/delete", async (req, res) => {
  try {
    const data = await loadGuideIndex();
    const resolved = resolveGuideIdentity({
      data,
      body: req.body || {},
      endpointName: "DELETE /api/guides/delete",
      requireSubcategory: true,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { categoryRow, situationRow, subcategoryId } = resolved;
    const subIndex = situationRow.subcategories.findIndex((row) => row.subcategoryId === subcategoryId);
    if (subIndex === -1) return res.status(404).json({ error: "Subcategoria nu exista." });

    const [removed] = situationRow.subcategories.splice(subIndex, 1);
    const pathsToDelete = new Set();
    if (removed?.pdfByLanguage && typeof removed.pdfByLanguage === "object") {
      for (const value of Object.values(removed.pdfByLanguage)) {
        const candidate = String(value || "").trim();
        if (candidate) pathsToDelete.add(candidate);
      }
    } else if (removed?.pdf) {
      pathsToDelete.add(String(removed.pdf || "").trim());
    }
    for (const pdfPath of pathsToDelete) {
      const diskPath = safeGuidePdfDiskPath(pdfPath);
      if (!diskPath) continue;
      try {
        await fs.access(diskPath);
        await fs.unlink(diskPath);
      } catch {
        // ignore delete errors
      }
    }

    if (situationRow.subcategories.length === 0) {
      categoryRow.situations = categoryRow.situations.filter((row) => row.situationKey !== situationRow.situationKey);
    }
    if (categoryRow.situations.length === 0) {
      const idx = data.findIndex((row) => row.categoryKey === categoryRow.categoryKey);
      if (idx !== -1) data.splice(idx, 1);
    }

    await saveGuideIndex(data);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/guides/delete:", err);
    res.status(500).json({ error: "Eroare la stergere PDF." });
  }
});

app.patch("/api/guides/rename", async (req, res) => {
  try {
    const { newTitle } = req.body || {};
    if (!newTitle) {
      return res.status(400).json({ error: "Date incomplete pentru rename." });
    }
    if (String(newTitle).trim().length < 3) {
      return res.status(400).json({ error: "Noul nume trebuie sa aiba minim 3 caractere." });
    }
    const data = await loadGuideIndex();
    const resolved = resolveGuideIdentity({
      data,
      body: req.body || {},
      endpointName: "PATCH /api/guides/rename",
      requireSubcategory: true,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { subRow } = resolved;

    const newSlug = toSafeSegment(newTitle) || `pdf-${Date.now()}`;
    if (subRow.pdfByLanguage && typeof subRow.pdfByLanguage === "object") {
      for (const language of Object.keys(subRow.pdfByLanguage)) {
        const currentPath = String(subRow.pdfByLanguage[language] || "").trim();
        if (!currentPath) continue;
        try {
          const oldDisk = safeGuidePdfDiskPath(currentPath);
          if (!oldDisk) continue;
          const folder = path.dirname(oldDisk);
          const nextLang = normalizeGuideLanguage(language) || language;
          const newDisk = ensureSafeGuideDiskPath(path.join(folder, `${newSlug}-${nextLang}.pdf`));
          if (!newDisk) continue;
          if (oldDisk !== newDisk) {
            await fs.access(oldDisk);
            await fs.rename(oldDisk, newDisk);
          }
          subRow.pdfByLanguage[language] = `/guide-pdfs/${path.relative(GUIDE_ROOT, newDisk).split(path.sep).join("/")}`;
        } catch (err) {
          console.error("Rename file error:", err);
        }
      }
    } else if (subRow.pdf) {
      try {
        const oldDisk = safeGuidePdfDiskPath(subRow.pdf);
        if (oldDisk) {
          const folder = path.dirname(oldDisk);
          const newDisk = ensureSafeGuideDiskPath(path.join(folder, `${newSlug}.pdf`));
          if (newDisk && oldDisk !== newDisk) {
            await fs.access(oldDisk);
            await fs.rename(oldDisk, newDisk);
          }
          if (newDisk) {
            subRow.pdf = `/guide-pdfs/${path.relative(GUIDE_ROOT, newDisk).split(path.sep).join("/")}`;
          }
        }
      } catch (err) {
        console.error("Rename file error:", err);
      }
    }

    subRow.title = newTitle;
    subRow.updatedAt = new Date().toISOString();
    await saveGuideIndex(data);
    res.json({ success: true, pdf: subRow.pdf });
  } catch (err) {
    console.error("PATCH /api/guides/rename:", err);
    res.status(500).json({ error: "Eroare la rename." });
  }
});

app.patch("/api/guides/metadata", async (req, res) => {
  try {
    const { category, situation, subcategoryTitle, tags, audience, incidentTypes, offlineEligible } = req.body || {};
    const data = await loadGuideIndex();
    const categoryRow = data.find((row) => row.category === category);
    if (!categoryRow) return res.status(404).json({ error: "Categoria nu exista." });
    const situationRow = categoryRow.situations.find((row) => row.name === situation);
    if (!situationRow) return res.status(404).json({ error: "Situatia nu exista." });
    const subRow = situationRow.subcategories.find((row) => row.title === subcategoryTitle);
    if (!subRow) return res.status(404).json({ error: "Subcategoria nu exista." });

    subRow.tags = Array.isArray(tags) ? tags.map((item) => String(item).trim()).filter(Boolean) : subRow.tags;
    subRow.audience = Array.isArray(audience)
      ? audience.map((item) => String(item).trim()).filter(Boolean)
      : subRow.audience;
    subRow.incidentTypes = Array.isArray(incidentTypes)
      ? incidentTypes.map((item) => String(item).trim()).filter(Boolean)
      : subRow.incidentTypes;
    if (typeof offlineEligible === "boolean") {
      subRow.offlineEligible = offlineEligible;
    }
    subRow.updatedAt = new Date().toISOString();

    await saveGuideIndex(data);
    res.json({ success: true, guide: subRow });
  } catch (err) {
    console.error("PATCH /api/guides/metadata:", err);
    res.status(500).json({ error: "Eroare la actualizarea metadatelor." });
  }
});

app.get("/api/incidents", async (req, res) => {
  try {
    await reconcileExpiredSosAlerts();
    const status = String(req.query.status || "").trim();
    const includeStale = String(req.query.includeStale || "").trim().toLowerCase() === "true";
    const query = buildIncidentsVisibilityQuery({ status, includeStale });
    const incidents = await Incident.find(query).sort({ updatedAt: -1 }).lean();
    res.json(incidents.map(serializeIncident));
  } catch (err) {
    console.error("GET /api/incidents:", err);
    res.status(500).json({ error: "Eroare la incarcarea incidentelor." });
  }
});

app.post("/api/incidents", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const actor = toActorFromUser(requestUser);
    const {
      title,
      type,
      severity,
      status,
      summary,
      location,
      dangerScore,
      resources,
      assignedUsers,
      useTemplate,
    } = req.body || {};

    if (!title || String(title).trim().length < 3) {
      return res.status(400).json({ error: "Titlul incidentului este obligatoriu." });
    }

    const templateKey = String(useTemplate || type || "").trim().toLowerCase();
    const templateTasks = (INCIDENT_TASK_TEMPLATES[templateKey] || []).map((task) => ({
      title: task.title,
      priority: task.priority,
      owner: "",
      status: "todo",
      templateKey,
    }));

    const incident = await Incident.create({
      title: String(title).trim().slice(0, 140),
      type: String(type || "general").trim() || "general",
      severity: severity || "medium",
      status: status || "open",
      summary: String(summary || "").trim().slice(0, 500),
      location: {
        ...(location && typeof location === "object" ? location : {}),
        radiusKm: clampNumber(location?.radiusKm, 0, 500, 0.5),
      },
      dangerScore: clampNumber(dangerScore, 0, 100, severityToDangerScore(severity || "medium")),
      riskUpdatedAt: new Date(),
      createdBy: actor,
      assignedUsers: Array.isArray(assignedUsers) ? assignedUsers.map(normalizeIncidentActor) : [],
      resources: Array.isArray(resources) ? resources : [],
      tasks: templateTasks,
      timeline: [
        {
          kind: "created",
          message: "Incident creat",
          actorName: actor.name,
          actorRole: actor.role,
          at: new Date(),
        },
      ],
      source: "manual",
    });

    emitIncidentUpdate("created", incident);
    emitNotification({
      type: "incident_created",
      title: incident.title,
      message: "Incident nou creat in centrul operational",
      link: `/incidents/${incident._id}`,
    });

    res.status(201).json(serializeIncident(incident));
  } catch (err) {
    console.error("POST /api/incidents:", err);
    res.status(500).json({ error: "Eroare la crearea incidentului." });
  }
});

app.get("/api/incidents/:incidentId", async (req, res) => {
  try {
    await reconcileExpiredSosAlerts();
    const incident = await Incident.findById(req.params.incidentId).lean();
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }
    res.json(serializeIncident(incident));
  } catch (err) {
    console.error("GET /api/incidents/:incidentId:", err);
    res.status(500).json({ error: "Eroare la incarcarea incidentului." });
  }
});

app.delete("/api/incidents/:incidentId", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const incident = await Incident.findByIdAndDelete(req.params.incidentId).lean();
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }
    io.emit("incident:update", {
      kind: "deleted",
      incidentId: String(incident._id),
    });
    emitNotification({
      type: "incident_deleted",
      title: incident.title,
      message: "Incident sters din fluxul operational",
      link: "/incidents",
    });
    res.json({ success: true, incidentId: String(incident._id) });
  } catch (err) {
    console.error("DELETE /api/incidents/:incidentId:", err);
    res.status(500).json({ error: "Eroare la stergerea incidentului." });
  }
});

app.patch("/api/incidents/:incidentId", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const actor = toActorFromUser(requestUser);
    const incident = await Incident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }

    const { title, type, severity, status, summary, location, resources, note, dangerScore } = req.body || {};
    if (title) incident.title = String(title).trim().slice(0, 140);
    if (type) incident.type = String(type).trim().slice(0, 80);
    if (severity) incident.severity = severity;
    if (status) incident.status = status;
    if (summary != null) incident.summary = String(summary).trim().slice(0, 500);
    if (location && typeof location === "object") {
      incident.location = {
        ...incident.location,
        ...location,
        radiusKm: clampNumber(location.radiusKm ?? incident.location?.radiusKm, 0, 500, 0.5),
      };
    }
    if (dangerScore != null) incident.dangerScore = clampNumber(dangerScore, 0, 100, incident.dangerScore || 50);
    if (Array.isArray(resources)) incident.resources = resources;
    incident.riskUpdatedAt = new Date();

    incident.timeline.push({
      kind: "updated",
      message: note ? String(note).trim().slice(0, 500) : "Incident actualizat",
      actorName: actor.name,
      actorRole: actor.role,
      at: new Date(),
    });

    await incident.save();
    emitIncidentUpdate("updated", incident);
    emitNotification({
      type: "incident_updated",
      title: incident.title,
      message: `Status curent: ${incident.status}`,
      link: `/incidents/${incident._id}`,
    });

    res.json(serializeIncident(incident));
  } catch (err) {
    console.error("PATCH /api/incidents/:incidentId:", err);
    res.status(500).json({ error: "Eroare la actualizarea incidentului." });
  }
});

app.post("/api/incidents/:incidentId/tasks", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const actor = toActorFromUser(requestUser);
    const incident = await Incident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }

    const { title, owner, priority, dueAt, completionNotes } = req.body || {};
    if (!title || String(title).trim().length < 3) {
      return res.status(400).json({ error: "Titlul taskului este obligatoriu." });
    }

    incident.tasks.push({
      title: String(title).trim().slice(0, 160),
      owner: String(owner || "").trim(),
      priority: priority || "medium",
      status: "todo",
      dueAt: dueAt || null,
      completionNotes: String(completionNotes || "").trim(),
    });
    incident.timeline.push({
      kind: "task",
      message: `Task adaugat: ${String(title).trim().slice(0, 160)}`,
      actorName: actor.name,
      actorRole: actor.role,
      at: new Date(),
    });

    await incident.save();
    emitIncidentUpdate("task_created", incident);
    io.emit("incident:task-update", { incident: serializeIncident(incident) });
    res.status(201).json(serializeIncident(incident));
  } catch (err) {
    console.error("POST /api/incidents/:incidentId/tasks:", err);
    res.status(500).json({ error: "Eroare la crearea taskului." });
  }
});

app.patch("/api/incidents/:incidentId/tasks/:taskId", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const actor = toActorFromUser(requestUser);
    const incident = await Incident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }

    const task = incident.tasks.id(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "Taskul nu a fost gasit." });
    }

    const { title, owner, priority, status, dueAt, completionNotes } = req.body || {};
    if (title) task.title = String(title).trim().slice(0, 160);
    if (owner != null) task.owner = String(owner).trim();
    if (priority) task.priority = priority;
    if (status) task.status = status;
    if (dueAt !== undefined) task.dueAt = dueAt || null;
    if (completionNotes != null) task.completionNotes = String(completionNotes).trim().slice(0, 300);

    incident.timeline.push({
      kind: "task",
      message: `Task actualizat: ${task.title}`,
      actorName: actor.name,
      actorRole: actor.role,
      at: new Date(),
    });

    await incident.save();
    emitIncidentUpdate("task_updated", incident);
    io.emit("incident:task-update", { incident: serializeIncident(incident), taskId: String(task._id) });
    res.json(serializeIncident(incident));
  } catch (err) {
    console.error("PATCH /api/incidents/:incidentId/tasks/:taskId:", err);
    res.status(500).json({ error: "Eroare la actualizarea taskului." });
  }
});

app.post("/api/incidents/:incidentId/assign", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const actor = toActorFromUser(requestUser);
    const incident = await Incident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }

    const rawAssigned = Array.isArray(req.body?.assignedUsers)
      ? req.body.assignedUsers
      : req.body?.assigneeName
        ? [{ name: req.body.assigneeName, role: "employee", status: "available" }]
        : [];

    if (!rawAssigned.length) {
      return res.status(400).json({ error: "Trimite cel putin o alocare." });
    }

    incident.assignedUsers = rawAssigned.map(normalizeIncidentActor).filter((entry) => entry.name || entry.userId);
    incident.timeline.push({
      kind: "assignment",
      message: `Asignare actualizata: ${incident.assignedUsers.map((entry) => entry.name || entry.userId).join(", ")}`,
      actorName: actor.name,
      actorRole: actor.role,
      at: new Date(),
    });

    await incident.save();
    emitIncidentUpdate("assigned", incident);
    emitNotification({
      type: "assignment",
      title: incident.title,
      message: "Asignarile incidentului au fost actualizate",
      link: `/incidents/${incident._id}`,
    });
    res.json(serializeIncident(incident));
  } catch (err) {
    console.error("POST /api/incidents/:incidentId/assign:", err);
    res.status(500).json({ error: "Eroare la actualizarea asignarilor." });
  }
});

app.post("/api/incidents/:incidentId/guides", async (req, res) => {
  try {
    const requestUser = await requireOperator(req, res);
    if (!requestUser) return;
    const incident = await Incident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incidentul nu a fost gasit." });
    }

    const { category, situation, subcategoryTitle } = req.body || {};
    const guideData = await loadGuideIndex();
    const categoryRow = guideData.find((row) => row.category === category);
    const situationRow = categoryRow?.situations.find((row) => row.name === situation);
    const guideRow = situationRow?.subcategories.find((row) => row.title === subcategoryTitle);
    if (!guideRow) {
      return res.status(404).json({ error: "Ghidul nu a fost gasit." });
    }

    const alreadyAttached = incident.guides.some(
      (guide) =>
        guide.category === category
        && guide.situation === situation
        && guide.subcategoryTitle === subcategoryTitle,
    );
    if (!alreadyAttached) {
      incident.guides.push({
        category,
        situation,
        subcategoryTitle,
        title: guideRow.title,
        pdf: guideRow.pdf,
        tags: guideRow.tags || [],
        audience: guideRow.audience || [],
        incidentTypes: guideRow.incidentTypes || [],
        offlineEligible: Boolean(guideRow.offlineEligible),
      });
      incident.timeline.push({
        kind: "guide",
        message: `Ghid atasat: ${guideRow.title}`,
        actorName: requestUser.username || requestUser.email || "Operator",
        actorRole: requestUser.role || requestUser.user_role || "employee",
        at: new Date(),
      });
      await incident.save();
    }

    emitIncidentUpdate("guide_attached", incident);
    emitNotification({
      type: "guide",
      title: guideRow.title,
      message: `Ghid atasat la ${incident.title}`,
      link: `/incidents/${incident._id}`,
    });

    res.json(serializeIncident(incident));
  } catch (err) {
    console.error("POST /api/incidents/:incidentId/guides:", err);
    res.status(500).json({ error: "Eroare la atasarea ghidului." });
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const limitRaw = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const allowedAudiences = userId ? ["all", "signed_in"] : ["all"];
    const notifications = await Notification.find({
      status: "active",
      audience: { $in: allowedAudiences },
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(notifications.map(serializeNotification).filter(Boolean));
  } catch (err) {
    console.error("GET /api/notifications:", err);
    res.status(500).json({ error: "Eroare la incarcarea notificarilor." });
  }
});

app.get("/api/dashboard/intelligence", async (req, res) => {
  try {
    const region = String(req.query.region || "").trim();
    const limit = Number(req.query.limit) || 12;
    const incidents = await Incident.find().sort({ updatedAt: -1 }).limit(40).lean();
    const payload = await buildDashboardIntelligence({
      incidents: incidents.map(serializeIncident),
      region,
      limit,
      buildIncidentNotifications,
    });
    res.json(payload);
  } catch (err) {
    console.error("GET /api/dashboard/intelligence:", err);
    res.status(500).json({ error: "Eroare la generarea intelligence dashboard." });
  }
});

app.get("/api/dashboard/news", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const language = normalizeTranslationLanguage(req.query.lang);
    const query = News.find({ status: "active" }).sort({ publishedAt: -1, updatedAt: -1 });
    if (Number.isFinite(limitRaw) && limitRaw > 0) {
      query.limit(clampNumber(limitRaw, 1, 1000, 1000));
    }
    const rows = await query;
    const translatedRows = [];
    for (const row of rows) {
      if (!language) {
        translatedRows.push(serializeNews(row));
        continue;
      }
      try {
        const translation = await translateNewsDocument(row, language, { includeContent: false });
        translatedRows.push(serializeNews(row, { translation }));
      } catch (error) {
        console.error("News translation failed:", error.message || error);
        translatedRows.push(serializeNews(row));
      }
    }
    res.json(translatedRows.filter(Boolean));
  } catch (err) {
    console.error("GET /api/dashboard/news:", err);
    res.status(500).json({ error: "Eroare la incarcarea stirilor dashboard." });
  }
});

app.get("/api/dashboard/news/:newsId", async (req, res) => {
  try {
    const { newsId } = req.params;
    const language = normalizeTranslationLanguage(req.query.lang);
    if (!mongoose.Types.ObjectId.isValid(newsId)) {
      return res.status(400).json({ error: "ID stire invalid." });
    }
    const row = await News.findOne({ _id: newsId, status: "active" });
    if (!row) {
      return res.status(404).json({ error: "Stirea nu a fost gasita." });
    }
    let translation = null;
    if (language) {
      try {
        translation = await translateNewsDocument(row, language, { includeContent: true });
      } catch (error) {
        console.error("News detail translation failed:", error.message || error);
      }
    }
    res.json(serializeNews(row, { includeContent: true, translation }));
  } catch (err) {
    console.error("GET /api/dashboard/news/:newsId:", err);
    res.status(500).json({ error: "Eroare la incarcarea detaliilor stirii." });
  }
});

app.post("/api/signup", async (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email si parola sunt obligatorii." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Parola trebuie sa aiba cel putin 6 caractere." });
    }
    const emailNorm = String(email).trim().toLowerCase();
    if (await User.findOne({ email: emailNorm })) {
      return res.status(400).json({ error: "Acest email este deja folosit." });
    }
    let uname =
      typeof username === "string" && username.trim().length >= 3
        ? username.trim().slice(0, 30)
        : await uniqueUsernameFromEmail(emailNorm);
    if (await User.findOne({ username: uname })) {
      uname = await uniqueUsernameFromEmail(emailNorm);
    }
    const user = new User({
      username: uname,
      email: emailNorm,
      password: String(password),
    });
    await user.save();
    const accessToken = signAccessToken(user);
    res.status(201).json({ user: toPublicUser(user), accessToken });
  } catch (err) {
    console.error("POST /api/signup:", err);
    res.status(500).json({ error: "Eroare la inregistrare." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email si parola sunt obligatorii." });
    }
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Email sau parola incorecta." });
    }
    const ok = await user.comparePassword(String(password));
    if (!ok) {
      return res.status(401).json({ error: "Email sau parola incorecta." });
    }
    const accessToken = signAccessToken(user);
    res.json({ user: toPublicUser(user), accessToken });
  } catch (err) {
    console.error("POST /api/login:", err);
    res.status(500).json({ error: "Eroare la autentificare." });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error("GET /api/me:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

app.get("/api/me/inclusion-profile", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const user = await User.findById(userId).select("inclusionProfile").lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({
      inclusionProfile: serializeInclusionProfile(user.inclusionProfile),
      allowlists: INCLUSION_ALLOWLISTS,
    });
  } catch (err) {
    console.error("GET /api/me/inclusion-profile:", err);
    res.status(500).json({ error: "Eroare la incarcarea datelor de siguranta." });
  }
});

app.put("/api/me/inclusion-profile", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const inclusionProfile = normalizeInclusionProfile(req.body?.inclusionProfile || req.body || {});
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { inclusionProfile } },
      { new: true, select: "inclusionProfile" },
    ).lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({ inclusionProfile: serializeInclusionProfile(user.inclusionProfile) });
  } catch (err) {
    console.error("PUT /api/me/inclusion-profile:", err);
    res.status(err.statusCode || 500).json({
      error: err.statusCode === 400 ? err.message : "Eroare la salvarea datelor de siguranta.",
    });
  }
});

app.delete("/api/me/inclusion-profile", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $unset: { inclusionProfile: "" } },
      { new: true, select: "inclusionProfile" },
    ).lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({ inclusionProfile: null, deleted: true });
  } catch (err) {
    console.error("DELETE /api/me/inclusion-profile:", err);
    res.status(500).json({ error: "Eroare la stergerea datelor de siguranta." });
  }
});

app.post("/api/profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Fisierul imaginii lipseste." });
    }
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Format invalid. Foloseste JPG, PNG sau WebP." });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Imaginea este prea mare (max 5MB)." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }

    user.profilePicture = {
      data: req.file.buffer,
      contentType: req.file.mimetype,
    };
    await user.save();

    const publicUser = toPublicUser(user);
    res.json({
      success: true,
      user: publicUser,
      profilePicture: publicUser.profilePicture || null,
    });
  } catch (err) {
    console.error("POST /api/profile-picture:", err);
    res.status(500).json({ error: "Eroare la upload poza de profil." });
  }
});

app.get("/api/me/location", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const user = await User.findById(userId).select("location").lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({ location: user.location || null });
  } catch (err) {
    console.error("GET /api/me/location:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

app.get("/api/dashboard/personal-risk", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { incidents, news, userLocation, operationalInclusionSummary } = await loadDashboardContext({
      userId,
      newsLimit: 30,
    });
    const payload = await buildPersonalRiskPayload({
      incidents,
      news,
      userLocation,
      userId,
      operationalInclusionSummary,
    });
    res.json(payload);
  } catch (err) {
    console.error("GET /api/dashboard/personal-risk:", err);
    res.status(500).json({ error: "Eroare la calcularea scorului personal de risc." });
  }
});

app.get("/api/dashboard/situation", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const overrideCoords = normalizeCoordinatesInput(req.query || {});
    const overrideLocation = buildOverrideLocation(
      overrideCoords,
      String(req.query.locationName || "").trim() || "Ad-hoc location",
    );

    const { situationPayload } = await buildRiskAndSituationContext({
      userId,
      newsLimit: 30,
      overrideLocation,
    });
    res.json(situationPayload);
  } catch (err) {
    console.error("GET /api/dashboard/situation:", err);
    res.status(500).json({ error: "Eroare la generarea situatiei live." });
  }
});

app.get("/api/dashboard/overview", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const overrideCoords = normalizeCoordinatesInput(req.query || {});
    const overrideLocation = buildOverrideLocation(
      overrideCoords,
      String(req.query.locationName || "").trim() || "Ad-hoc location",
    );

    const { dashboardContext, riskPayload, situationPayload } = await buildRiskAndSituationContext({
      userId,
      newsLimit: 36,
      overrideLocation,
    });

    res.json({
      risk: riskPayload,
      situation: situationPayload,
      news: dashboardContext.news.map((row) => serializeNews(row)).filter(Boolean),
      meta: {
        generatedAt: new Date().toISOString(),
        userLocation: dashboardContext.userLocation || null,
      },
    });
  } catch (err) {
    console.error("GET /api/dashboard/overview:", err);
    res.status(500).json({ error: "Eroare la generarea overview dashboard." });
  }
});

app.patch("/api/me/location", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const { name, raw } = req.body || {};
    const rawStr = typeof raw === "string" ? raw.trim() : "";
    if (!rawStr) {
      return res.status(400).json({ error: "Introdu coordonate (ex: 44.43, 26.10)." });
    }
    const coords = parseLatLon(rawStr);
    if (!coords) {
      return res.status(400).json({
        error:
          "Nu pot citi coordonatele. Incearca: 44.43, 26.10 (lat, lon) sau format DMS din exemplu.",
      });
    }
    const displayName =
      typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : "Locatie salvata";
    const location = {
      name: displayName,
      raw: rawStr,
      coordinates: { lat: coords.lat, lon: coords.lon },
    };
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { location } },
      { new: true, select: "location" },
    ).lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({ location: user.location });
  } catch (err) {
    console.error("PATCH /api/me/location:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

app.get("/api/me/presence", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const user = await User.findById(userId).select("presenceStatus role user_role").lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    res.json({
      presenceStatus: user.presenceStatus || "available",
      role: user.role || user.user_role || "customer",
    });
  } catch (err) {
    console.error("GET /api/me/presence:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

app.patch("/api/me/presence", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }
    const allowed = new Set(["available", "en_route", "on_scene", "unavailable", "active", "idle", "dnd", "offline"]);
    const nextStatus = String(req.body?.presenceStatus || "").trim();
    if (!allowed.has(nextStatus)) {
      return res.status(400).json({ error: "Status de prezenta invalid." });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { presenceStatus: nextStatus } },
      { new: true },
    ).lean();
    if (!user) {
      return res.status(404).json({ error: "Utilizator negasit." });
    }
    io.emit("presence:update", {
      userId: String(user._id),
      presenceStatus: user.presenceStatus || nextStatus,
    });
    res.json({
      presenceStatus: user.presenceStatus || nextStatus,
      role: user.role || user.user_role || "customer",
    });
  } catch (err) {
    console.error("PATCH /api/me/presence:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

// ==================== SOS EMERGENCY ROUTES ====================

// Create SOS alert
app.post("/api/sos/alert", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);
    const operationalInclusionSummary = buildOperationalInclusionSummary(requestUser?.inclusionProfile);

    const { type, message, location, contactsNotified, contacts } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Mesajul este obligatoriu." });
    }

    const normalizedSosLocation = normalizeSosLocation(location, "initial");
    const incidentLocation = normalizedSosLocation
      ? {
          lat: normalizedSosLocation.lat,
          lon: normalizedSosLocation.lng,
          accuracy: normalizedSosLocation.accuracy,
        }
      : (location || {});
    const sosContacts = normalizeSosContacts({ contacts, contactsNotified });
    const alert = new SOSAlert({
      userId: userId || null,
      type: type || "SOS",
      message: String(message).trim().slice(0, 500),
      location: location || null,
      contactsNotified: Array.isArray(contactsNotified) ? contactsNotified : [],
      contacts: sosContacts,
      operationalInclusionSummary,
      status: "active",
      priority: "critical",
      initialLocation: normalizedSosLocation,
      lastKnownLocation: normalizedSosLocation,
      locationHistory: normalizedSosLocation ? [normalizedSosLocation] : [],
      timeline: [
        buildSosTimelineEntry("sos_created", "Alerta SOS a fost creata.", actor),
      ],
      expiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS),
    });

    await alert.save();

    const incident = await Incident.create({
      title: `SOS ${actor.name || "Emergency"}`,
      type: "medical",
      severity: "critical",
      status: "active",
      summary: alert.message,
      location: incidentLocation,
      operationalInclusionSummary,
      createdBy: actor,
      assignedUsers: actor.userId ? [actor] : [],
      timeline: [
        {
          kind: "sos",
          message: "Incident creat automat din alerta SOS",
          actorName: actor.name,
          actorRole: actor.role,
          at: new Date(),
        },
      ],
      tasks: (INCIDENT_TASK_TEMPLATES.medical || []).map((task) => ({
        title: task.title,
        priority: task.priority,
        owner: "",
        status: "todo",
        templateKey: "medical",
      })),
      source: "sos",
      unreadCount: 1,
    });

    alert.incidentId = incident._id;
    alert.timeline.push(buildSosTimelineEntry(
      "incident_created",
      "Incident critic creat automat din alerta SOS.",
      actor,
    ));
    await alert.save();

    const normalizedLocation = normalizeCoordinatesInput(location || {});
    const overrideLocation = buildOverrideLocation(normalizedLocation, "SOS location");
    const { riskPayload, situationPayload } = await buildRiskAndSituationContext({
      userId,
      newsLimit: 20,
      overrideLocation,
    });
    const guideIndex = await loadGuideIndex();
    const { session, recommendation } = await createCopilotSession({
      userId,
      incident,
      sosAlert: alert,
      riskPayload,
      situationPayload,
      guideIndex,
      language: "ro",
      userLocation: incidentLocation || null,
      operationalInclusionSummary,
    });

    // Broadcast to all connected clients (in production, send to specific users)
    io.emit("sos-alert", {
      alertId: alert._id,
      type: alert.type,
      message: alert.message,
      location: alert.location,
      lastKnownLocation: alert.lastKnownLocation,
      timestamp: alert.createdAt,
      status: alert.status,
      incidentId: incident._id,
    });
    emitIncidentUpdate("sos_created", incident);
    await upsertSosNotification(alert, incident);

    console.log(`🚨 SOS Alert created: ${alert._id} - ${alert.message}`);
    res.status(201).json({
      alert: serializeSosAlert(alert),
      incident: serializeIncident(incident),
      success: true,
      copilotSessionId: String(session._id),
      recommendedGuides: recommendation.sources,
      initialActionChecklist: recommendation.actionChecklist,
      initialRecommendation: recommendation.answer,
      escalateNow: recommendation.escalateNow,
    });
  } catch (err) {
    console.error("POST /api/sos/alert:", err);
    res.status(500).json({ error: "Eroare la crearea alertei SOS." });
  }
});

// Get user's SOS alerts
app.get("/api/sos/alerts", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return respondUnauthorized(req, res);
    }

    const limit = parseInt(req.query.limit) || 20;
    const alerts = await SOSAlert.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(alerts);
  } catch (err) {
    console.error("GET /api/sos/alerts:", err);
    res.status(500).json({ error: "Eroare server." });
  }
});

app.patch("/api/sos/alert/:alertId/location", async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);
    const alert = await persistSosLocationUpdate(
      req.params.alertId,
      req.body?.location || req.body,
      actor,
      "api",
    );
    if (!alert) {
      return res.status(404).json({ error: "Alerta nu a fost gasita sau locatia este invalida." });
    }
    const payload = {
      alertId: alert._id,
      location: alert.lastKnownLocation,
      lastKnownLocation: alert.lastKnownLocation,
      status: alert.status,
    };
    io.emit("sos-location-update", payload);
    emitSosAlertUpdated(alert);
    res.json({ alert: serializeSosAlert(alert), success: true });
  } catch (err) {
    console.error("PATCH /api/sos/alert/:alertId/location:", err);
    res.status(500).json({ error: "Eroare la actualizarea locatiei SOS." });
  }
});

app.patch("/api/sos/alert/:alertId/acknowledge", async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);
    const alert = await SOSAlert.findById(req.params.alertId);
    if (!alert) {
      return res.status(404).json({ error: "Alerta nu a fost gasita." });
    }
    alert.status = "acknowledged";
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = actor;
    alert.timeline.push(buildSosTimelineEntry("acknowledged", "Alerta SOS a fost confirmata.", actor));
    await alert.save();
    const incident = alert.incidentId ? await Incident.findById(alert.incidentId).lean() : null;
    await upsertSosNotification(alert, incident);
    emitSosAlertUpdated(alert);
    res.json({ alert: serializeSosAlert(alert), success: true });
  } catch (err) {
    console.error("PATCH /api/sos/alert/:alertId/acknowledge:", err);
    res.status(500).json({ error: "Eroare la confirmarea alertei SOS." });
  }
});

app.patch("/api/sos/alert/:alertId/responding", async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);
    const alert = await SOSAlert.findById(req.params.alertId);
    if (!alert) {
      return res.status(404).json({ error: "Alerta nu a fost gasita." });
    }
    alert.status = "responding";
    alert.timeline.push(buildSosTimelineEntry("responding", "Raspunsul operational este in desfasurare.", actor));
    await alert.save();
    const incident = alert.incidentId ? await Incident.findById(alert.incidentId).lean() : null;
    await upsertSosNotification(alert, incident);
    emitSosAlertUpdated(alert);
    res.json({ alert: serializeSosAlert(alert), success: true });
  } catch (err) {
    console.error("PATCH /api/sos/alert/:alertId/responding:", err);
    res.status(500).json({ error: "Eroare la actualizarea raspunsului SOS." });
  }
});

app.patch("/api/sos/alert/:alertId/cancel", async (req, res) => {
  try {
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);
    const alert = await SOSAlert.findById(req.params.alertId);
    if (!alert) {
      return res.status(404).json({ error: "Alerta nu a fost gasita." });
    }
    const reason = String(req.body?.reason || req.body?.notes || "SOS anulat.").trim().slice(0, 500);
    alert.status = "cancelled";
    alert.cancelReason = reason;
    alert.resolvedAt = new Date();
    alert.expiresAt = null;
    alert.timeline.push(buildSosTimelineEntry("cancelled", reason, actor, alert.resolvedAt));
    await alert.save();
    const incident = alert.incidentId ? await Incident.findOne({ _id: alert.incidentId, source: "sos" }) : null;
    if (incident) {
      await resolveSosIncident(incident, {
        message: reason,
        actorName: actor.name,
        actorRole: actor.role,
      });
    }
    await upsertSosNotification(alert, incident, { resolved: true });
    io.emit("sos-alert-resolved", {
      alertId: alert._id,
      status: alert.status,
      resolvedAt: alert.resolvedAt,
    });
    emitSosAlertUpdated(alert, { resolvedAt: alert.resolvedAt });
    res.json({ alert: serializeSosAlert(alert), success: true });
  } catch (err) {
    console.error("PATCH /api/sos/alert/:alertId/cancel:", err);
    res.status(500).json({ error: "Eroare la anularea alertei SOS." });
  }
});

// Resolve/close an SOS alert
app.patch("/api/sos/alert/:alertId/resolve", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { notes } = req.body || {};
    const requestUser = await getRequestUser(req);
    const actor = toActorFromUser(requestUser);

    const alert = await SOSAlert.findById(alertId);
    if (!alert) {
      return res.status(404).json({ error: "Alerta nu a fost gasita." });
    }

    alert.status = "resolved";
    alert.resolvedAt = new Date();
    alert.expiresAt = null;
    alert.resolvedBy = requestUser?._id || alert.resolvedBy || undefined;
    if (notes) {
      alert.resolutionNotes = String(notes).trim().slice(0, 500);
    }
    alert.timeline.push(buildSosTimelineEntry(
      "resolved",
      notes ? String(notes).trim().slice(0, 500) : "Alerta SOS a fost rezolvata.",
      actor,
      alert.resolvedAt,
    ));

    await alert.save();

    const relatedIncident = alert.incidentId
      ? await Incident.findOne({ _id: alert.incidentId, source: "sos" })
      : await Incident.findOne({
          source: "sos",
          summary: alert.message,
          status: { $ne: "resolved" },
        }).sort({ createdAt: -1 });

    if (relatedIncident) {
      await resolveSosIncident(relatedIncident, {
        message: notes
          ? String(notes).trim().slice(0, 500)
          : "Incident inchis din fluxul SOS.",
        actorName: actor.name,
        actorRole: actor.role,
      });
    }
    await upsertSosNotification(alert, relatedIncident, { resolved: true });

    // Broadcast update
    io.emit("sos-alert-resolved", {
      alertId: alert._id,
      status: alert.status,
      resolvedAt: alert.resolvedAt,
    });
    emitSosAlertUpdated(alert, { resolvedAt: alert.resolvedAt });

    res.json({ alert: serializeSosAlert(alert), success: true });
  } catch (err) {
    console.error("PATCH /api/sos/alert/:alertId/resolve:", err);
    res.status(500).json({ error: "Eroare la actualizarea alertei." });
  }
});

app.post("/api/emergency/copilot/sessions", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { incidentId, sosAlertId, location, language } = req.body || {};
    const { session, recommendation } = await createCopilotSessionFromIds({
      userId,
      incidentId,
      sosAlertId,
      location,
      language,
    });

    res.status(201).json({
      session: serializeCopilotSession(session),
      recommendation,
    });
  } catch (err) {
    console.error("POST /api/emergency/copilot/sessions:", err);
    res.status(500).json({ error: "Eroare la crearea sesiunii copilot." });
  }
});

app.post("/api/emergency/copilot/sessions/:sessionId/messages", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Mesajul este obligatoriu." });
    }
    const userId = getUserIdFromRequest(req);
    const { session: updatedSession, response } = await appendCopilotMessageFromRequest({
      sessionId,
      userId,
      message,
      location: req.body?.location || null,
      language: req.body?.language || "",
    });

    res.json({
      session: serializeCopilotSession(updatedSession),
      response,
    });
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    console.error("POST /api/emergency/copilot/sessions/:sessionId/messages:", err);
    res.status(statusCode).json({ error: err?.message || "Eroare la procesarea mesajului copilot." });
  }
});

app.get("/api/emergency/copilot/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await loadSerializedCopilotSessionById(sessionId);
    res.json({ session });
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    console.error("GET /api/emergency/copilot/sessions/:sessionId:", err);
    res.status(statusCode).json({ error: err?.message || "Eroare la incarcarea sesiunii copilot." });
  }
});

app.get("/api/emergency/copilot/meta", (req, res) => {
  try {
    res.json({ runtime: getEmergencyCopilotRuntimeInfo() });
  } catch (err) {
    console.error("GET /api/emergency/copilot/meta:", err);
    res.status(500).json({ error: "Eroare la incarcarea meta informatiilor copilotului." });
  }
});

app.post("/api/emergency/copilot/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Mesajul este obligatoriu." });
    }

    const userId = getUserIdFromRequest(req);
    const normalizedLocation = normalizeCoordinatesInput(req.body?.location || {});
    const overrideLocation = buildOverrideLocation(normalizedLocation, "Communication AI location");
    const { riskPayload, situationPayload } = await buildRiskAndSituationContext({
      userId,
      newsLimit: 20,
      overrideLocation,
    });
    const guideIndex = await loadGuideIndex();
    const response = await answerCommunicationMessage({
      message,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      guideIndex,
      riskPayload,
      situationPayload,
      userLocation: normalizedLocation,
      language: String(req.body?.language || "").trim(),
    });

    res.json({
      response,
      runtime: getEmergencyCopilotRuntimeInfo(),
    });
  } catch (err) {
    console.error("POST /api/emergency/copilot/chat:", err);
    res.status(500).json({ error: "Eroare la procesarea mesajului AI." });
  }
});

// Backward compatible aliases
app.post("/api/emergency/copilot/session", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { incidentId, sosAlertId, location, language } = req.body || {};
    const { session, recommendation } = await createCopilotSessionFromIds({
      userId,
      incidentId,
      sosAlertId,
      location,
      language,
    });
    res.status(201).json({
      session: serializeCopilotSession(session),
      recommendation,
    });
  } catch (err) {
    console.error("POST /api/emergency/copilot/session:", err);
    res.status(500).json({ error: "Eroare la crearea sesiunii copilot." });
  }
});

app.post("/api/emergency/copilot/message", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId este obligatoriu." });
    }
    if (!message) {
      return res.status(400).json({ error: "Mesajul este obligatoriu." });
    }
    const userId = getUserIdFromRequest(req);
    const { session: updatedSession, response } = await appendCopilotMessageFromRequest({
      sessionId,
      userId,
      message,
      location: req.body?.location || null,
      language: req.body?.language || "",
    });

    res.json({
      session: serializeCopilotSession(updatedSession),
      response,
    });
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    console.error("POST /api/emergency/copilot/message:", err);
    res.status(statusCode).json({ error: err?.message || "Eroare la procesarea mesajului copilot." });
  }
});

app.get("/api/emergency/copilot/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await loadSerializedCopilotSessionById(sessionId);
    res.json({ session });
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    console.error("GET /api/emergency/copilot/session/:sessionId:", err);
    res.status(statusCode).json({ error: err?.message || "Eroare la incarcarea sesiunii copilot." });
  }
});

// Family alert endpoint
app.post("/api/family/alert", async (req, res) => {
  try {
    const { type, message, location } = req.body || {};

    // Broadcast to all connected family members
    io.emit("family-alert", {
      id: `family-${Date.now()}`,
      type: type || "FAMILY",
      message: message || "Alerta de la familie",
      location: location || null,
      timestamp: new Date().toISOString(),
      status: "active",
    });

    res.json({ success: true, message: "Alerta trimisa familiei" });
  } catch (err) {
    console.error("POST /api/family/alert:", err);
    res.status(500).json({ error: "Eroare la trimiterea alertei." });
  }
});

// Listen only after the database is reachable so API routes don't fail with buffered-query 500s.
const PORT = process.env.PORT || 5000;
assertAuthConfiguration();

connectToMongo()
  .then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server + Socket.io running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB startup error:", formatMongoStartupError(err));
    process.exit(1);
  });
