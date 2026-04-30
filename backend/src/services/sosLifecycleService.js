function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSosLocation(input, source = "client") {
  const lat = toFiniteNumber(input?.lat);
  const lng = toFiniteNumber(input?.lng ?? input?.lon);
  if (lat == null || lng == null) return null;
  const timestamp = input?.timestamp ? new Date(input.timestamp) : new Date();
  return {
    lat,
    lng,
    lon: lng,
    accuracy: toFiniteNumber(input?.accuracy),
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    source: String(input?.source || source || "client").trim() || "client",
  };
}

function buildApproximateLocationLabel(location) {
  const normalized = normalizeSosLocation(location);
  if (!normalized) return "locatie indisponibila";
  const latBand = normalized.lat >= 0 ? "N" : "S";
  const lngBand = normalized.lng >= 0 ? "E" : "W";
  return `zona aprox. ${Math.abs(normalized.lat).toFixed(2)}${latBand}, ${Math.abs(normalized.lng).toFixed(2)}${lngBand}`;
}

function buildSosTimelineEntry(type, message, actor = null, at = new Date()) {
  return {
    type: String(type || "update").trim() || "update",
    message: String(message || "").trim().slice(0, 500),
    at,
    actor: actor || null,
  };
}

function normalizeSosContacts({ contacts = [], contactsNotified = [] } = {}) {
  const richContacts = Array.isArray(contacts) ? contacts : [];
  const legacyContacts = Array.isArray(contactsNotified) ? contactsNotified : [];
  const rows = richContacts.length
    ? richContacts
    : legacyContacts.map((name) => ({ name }));

  return rows
    .map((contact) => {
      const name = String(contact?.name || contact?.label || "").trim();
      const phone = String(contact?.phone || contact?.number || "").trim();
      const email = String(contact?.email || "").trim();
      const notifyMethod = String(contact?.notifyMethod || "").trim();
      const relationship = String(contact?.relationship || contact?.type || "").trim();
      if (!name && !phone && !email) return null;
      return {
        name,
        phone,
        email,
        relationship,
        notifyMethod,
        notifiedStatus: "not_available",
        notifiedAt: null,
        error: "No SMS/email delivery provider is configured in this phase.",
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildApproximateLocationLabel,
  buildSosTimelineEntry,
  normalizeSosContacts,
  normalizeSosLocation,
};
