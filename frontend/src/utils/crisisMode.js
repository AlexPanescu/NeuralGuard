export const CRISIS_MODE_STORAGE_KEY = "crisisModePreference";
export const OFFLINE_GUIDE_INDEX_KEY = "offlineGuideIndex";
export const OFFLINE_LAST_SYNC_KEY = "offlineLastSync";
export const QUEUED_CRISIS_MESSAGES_KEY = "queuedCrisisMessages";

export const CRISIS_MODE_OPTIONS = ["auto", "low-data", "offline-ready"];
export const QUEUED_CRISIS_MESSAGES_CHANGED_EVENT = "queuedCrisisMessagesChanged";
const QUEUED_CRISIS_MESSAGES_LIMIT = 50;
const QUEUED_MESSAGE_STATUSES = ["queued", "sending", "sent", "failed"];

const hasStorage = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const normalizeCrisisModePreference = (value) =>
  CRISIS_MODE_OPTIONS.includes(value) ? value : "auto";

export const getConnectionProfile = () => {
  if (typeof navigator === "undefined") {
    return {
      online: true,
      saveData: false,
      effectiveType: "unknown",
    };
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  return {
    online: navigator.onLine !== false,
    saveData: Boolean(connection?.saveData),
    effectiveType: typeof connection?.effectiveType === "string" ? connection.effectiveType : "unknown",
  };
};

export const readJsonStorage = (key, fallback = null) => {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeJsonStorage = (key, value) => {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const readCrisisModePreference = () => {
  if (!hasStorage()) return "auto";
  return normalizeCrisisModePreference(window.localStorage.getItem(CRISIS_MODE_STORAGE_KEY));
};

export const writeCrisisModePreference = (value) => {
  if (!hasStorage()) return "auto";
  const normalized = normalizeCrisisModePreference(value);
  window.localStorage.setItem(CRISIS_MODE_STORAGE_KEY, normalized);
  return normalized;
};

export const readOfflineLastSync = () => {
  if (!hasStorage()) return "";
  return window.localStorage.getItem(OFFLINE_LAST_SYNC_KEY) || "";
};

export const writeOfflineLastSync = (timestamp = new Date().toISOString()) => {
  if (!hasStorage()) return "";
  const nextValue = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || "");
  if (!nextValue) return "";
  window.localStorage.setItem(OFFLINE_LAST_SYNC_KEY, nextValue);
  return nextValue;
};

export const readOfflineGuideIndex = () => {
  const cached = readJsonStorage(OFFLINE_GUIDE_INDEX_KEY, null);
  return Array.isArray(cached) && cached.length ? cached : null;
};

export const writeOfflineGuideIndex = (guideData) => {
  if (!Array.isArray(guideData) || !guideData.length) return false;
  return writeJsonStorage(OFFLINE_GUIDE_INDEX_KEY, guideData);
};

const dispatchQueuedMessagesChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUEUED_CRISIS_MESSAGES_CHANGED_EVENT));
};

const makeQueuedMessageId = () =>
  `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeQueuedMessage = (message, index = 0) => {
  const now = new Date().toISOString();
  const text = String(message?.text || message?.payload?.text || "").trim();
  const channel = String(message?.channel || message?.channelId || message?.payload?.channelId || "global");
  const payload = message?.payload && typeof message.payload === "object"
    ? { ...message.payload, text, channelId: message.payload.channelId || channel }
    : { text, channelId: channel };
  const status = QUEUED_MESSAGE_STATUSES.includes(message?.status) ? message.status : "queued";
  const reason = message?.reason === "socket_unavailable" ? "socket_unavailable" : "offline";

  return {
    id: message?.id ? String(message.id) : `${makeQueuedMessageId()}-${index}`,
    text,
    channel,
    payload,
    reason,
    status,
    createdAt: message?.createdAt || now,
    updatedAt: message?.updatedAt || message?.createdAt || now,
    ...(message?.lastError ? { lastError: String(message.lastError) } : {}),
  };
};

export const getQueuedCrisisMessages = () => {
  const queued = readJsonStorage(QUEUED_CRISIS_MESSAGES_KEY, []);
  if (!Array.isArray(queued)) return [];
  return queued
    .map(normalizeQueuedMessage)
    .filter((message) => message.text)
    .slice(0, QUEUED_CRISIS_MESSAGES_LIMIT);
};

export const saveQueuedCrisisMessages = (messages) => {
  const normalized = Array.isArray(messages)
    ? messages.map(normalizeQueuedMessage).filter((message) => message.text).slice(0, QUEUED_CRISIS_MESSAGES_LIMIT)
    : [];
  const saved = writeJsonStorage(QUEUED_CRISIS_MESSAGES_KEY, normalized);
  dispatchQueuedMessagesChanged();
  return saved ? normalized : [];
};

export const addQueuedCrisisMessage = (message) => {
  const now = new Date().toISOString();
  const normalized = normalizeQueuedMessage({
    ...message,
    id: message?.id || makeQueuedMessageId(),
    status: message?.status || "queued",
    createdAt: message?.createdAt || now,
    updatedAt: now,
  });
  saveQueuedCrisisMessages([normalized, ...getQueuedCrisisMessages()]);
  return normalized;
};

export const updateQueuedCrisisMessage = (id, patch) => {
  const targetId = String(id || "");
  let updatedMessage = null;
  const nextMessages = getQueuedCrisisMessages().map((message) => {
    if (String(message.id) !== targetId) return message;
    updatedMessage = normalizeQueuedMessage({
      ...message,
      ...patch,
      id: message.id,
      updatedAt: new Date().toISOString(),
    });
    return updatedMessage;
  });
  saveQueuedCrisisMessages(nextMessages);
  return updatedMessage;
};

export const removeQueuedCrisisMessage = (id) => {
  const targetId = String(id || "");
  const nextMessages = getQueuedCrisisMessages().filter((message) => String(message.id) !== targetId);
  saveQueuedCrisisMessages(nextMessages);
  return nextMessages;
};

export const markQueuedMessageSending = (id) =>
  updateQueuedCrisisMessage(id, { status: "sending", lastError: "" });

export const markQueuedMessageSent = (id) =>
  updateQueuedCrisisMessage(id, { status: "sent", lastError: "" });

export const markQueuedMessageFailed = (id, reason) =>
  updateQueuedCrisisMessage(id, { status: "failed", lastError: String(reason || "Send failed.") });

export const clearSentQueuedMessages = () => {
  const nextMessages = getQueuedCrisisMessages().filter((message) => message.status !== "sent");
  saveQueuedCrisisMessages(nextMessages);
  return nextMessages;
};

export const getUnsentQueuedMessageCount = () =>
  getQueuedCrisisMessages().filter((message) => ["queued", "sending", "failed"].includes(message.status)).length;

export const readQueuedCrisisMessages = getQueuedCrisisMessages;
export const writeQueuedCrisisMessages = saveQueuedCrisisMessages;
export const queueCrisisMessage = (message) => {
  const queuedMessage = addQueuedCrisisMessage(message);
  return queuedMessage;
};

export const formatSyncTime = (value, locale = "en-US", fallback = "No critical sync yet", unknown = "Sync time unknown") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknown;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};
