const crypto = require("crypto");

const SUPPORTED_TRANSLATION_LANGUAGES = new Set(["en", "ro"]);
const TRANSLATABLE_FIELDS = ["title", "summary", "content"];
const TRANSLATION_PROVIDER = process.env.NEWS_TRANSLATION_PROVIDER || "argos-translate";
const TRANSLATION_PROVIDER_VERSION = process.env.NEWS_TRANSLATION_PROVIDER_VERSION || "local-v1";

function normalizeTranslationLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase().slice(0, 2);
  return SUPPORTED_TRANSLATION_LANGUAGES.has(normalized) ? normalized : "";
}

function normalizeSourceField(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function getTranslationSourceHash(newsDoc) {
  const payload = {};
  for (const field of TRANSLATABLE_FIELDS) {
    payload[field] = normalizeSourceField(newsDoc?.[field]);
  }
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function readCachedTranslation(newsDoc, language) {
  const translations = newsDoc?.translations;
  if (!translations) return null;
  const cached = translations instanceof Map ? translations.get(language) : translations?.[language];
  return cached && typeof cached === "object" ? cached : null;
}

function getCachedTranslation(newsDoc, language, includeContent = false) {
  const cached = readCachedTranslation(newsDoc, language);
  if (!cached) return null;
  if (cached.provider !== TRANSLATION_PROVIDER) return null;
  if (cached.providerVersion !== TRANSLATION_PROVIDER_VERSION) return null;
  if (cached.translationSourceHash !== getTranslationSourceHash(newsDoc)) return null;

  const title = normalizeString(cached.title);
  const summary = normalizeString(cached.summary);
  const content = normalizeString(cached.content);
  if (hasText(newsDoc?.title) && !title) return null;
  if (hasText(newsDoc?.summary) && !summary) return null;
  if (includeContent && hasText(newsDoc?.content) && !content) return null;

  return {
    title,
    summary,
    ...(includeContent ? { content } : {}),
    translationLanguage: language,
    translationStatus: "cached",
  };
}

async function translateNewsDocument(newsDoc, language, options = {}) {
  const targetLanguage = normalizeTranslationLanguage(language);
  if (!targetLanguage) return null;
  return getCachedTranslation(newsDoc, targetLanguage, Boolean(options.includeContent));
}

module.exports = {
  getTranslationSourceHash,
  normalizeTranslationLanguage,
  translateNewsDocument,
};
