export function formatNewsTimestamp(value, locale = "en-GB", fallback = "Unknown") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function normalizeNewsItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: String(item.id || item._id || ""),
    title: String(item.title || "").trim(),
    summary: String(item.summary || "").trim(),
    source: String(item.source || "").trim(),
    articleUrl: String(item.articleUrl || item.url || "").trim(),
    imageUrl: String(item.imageUrl || "").trim(),
    content: String(item.content || "").trim(),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)).filter(Boolean) : [],
    publishedAt: item.publishedAt || "",
    isFallback: Boolean(item.isFallback),
  };
}

export function normalizeLegacyNewsItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || item._id || item.url || item.title || "");
  return {
    id,
    title: String(item.title || "").trim(),
    summary: String(item.summary || "").trim(),
    source: String(item.source || "").trim(),
    articleUrl: String(item.url || item.articleUrl || "").trim(),
    imageUrl: String(item.imageUrl || "").trim(),
    content: "",
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)).filter(Boolean) : [],
    publishedAt: item.publishedAt || "",
    isFallback: Boolean(item.isFallback),
  };
}

export function buildNewsParagraphs(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const byBlankLines = raw.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (byBlankLines.length > 1) return byBlankLines;

  const oneBlock = byBlankLines[0] || raw;
  const sentences = oneBlock
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentences.length <= 3) return [oneBlock];

  const chunks = [];
  for (let index = 0; index < sentences.length; index += 3) {
    chunks.push(sentences.slice(index, index + 3).join(" "));
  }
  return chunks;
}
