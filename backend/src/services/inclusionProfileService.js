const MOBILITY_NEEDS = new Set(["reduced_mobility", "wheelchair", "needs_transport_assistance"]);
const SENSORY_NEEDS = new Set(["low_vision", "hard_of_hearing", "deaf"]);
const COMMUNICATION_NEEDS = new Set(["prefers_text", "prefers_voice", "simple_language", "needs_interpreter"]);
const MEDICAL_FLAGS = new Set(["critical_medication", "uses_medical_device", "allergy_risk"]);
const SUPPORT_RELATIONSHIPS = new Set(["family", "caregiver", "friend", "neighbor", "doctor", "social_worker", "other"]);

const ARRAY_LIMIT = 6;
const CONTACT_LIMIT = 3;
const SHORT_NOTES_MAX = 160;
const CONTACT_NAME_MAX = 80;
const CONTACT_PHONE_MAX = 32;

const LABELS = {
  reduced_mobility: "mobilitate redusa",
  wheelchair: "utilizator scaun rulant",
  needs_transport_assistance: "nevoie de asistenta la transport",
  low_vision: "vedere redusa",
  hard_of_hearing: "auz redus",
  deaf: "surd",
  prefers_text: "prefera comunicare text",
  prefers_voice: "prefera comunicare vocala",
  simple_language: "are nevoie de limbaj simplu",
  needs_interpreter: "are nevoie de interpret",
  critical_medication: "medicatie critica",
  uses_medical_device: "dispozitiv medical",
  allergy_risk: "risc alergic operational",
};

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAllowlistArray(value, allowed, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    const error = new Error(`${fieldName} trebuie sa fie lista.`);
    error.statusCode = 400;
    throw error;
  }
  const result = [];
  for (const raw of value.slice(0, ARRAY_LIMIT)) {
    const item = String(raw || "").trim();
    if (!item) continue;
    if (!allowed.has(item)) {
      const error = new Error(`${fieldName} contine o valoare nepermisa: ${item}`);
      error.statusCode = 400;
      throw error;
    }
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

function normalizeSupportContacts(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    const error = new Error("supportContacts trebuie sa fie lista.");
    error.statusCode = 400;
    throw error;
  }

  return value.slice(0, CONTACT_LIMIT).map((raw) => {
    const name = sanitizeText(raw?.name, CONTACT_NAME_MAX);
    const phone = sanitizeText(raw?.phone, CONTACT_PHONE_MAX).replace(/[^\d+().\-\s]/g, "");
    const relationship = sanitizeText(raw?.relationship, 32);
    if (relationship && !SUPPORT_RELATIONSHIPS.has(relationship)) {
      const error = new Error(`supportContacts.relationship contine o valoare nepermisa: ${relationship}`);
      error.statusCode = 400;
      throw error;
    }
    return {
      name,
      phone,
      relationship: relationship || "other",
    };
  }).filter((contact) => contact.name || contact.phone);
}

function normalizeInclusionProfile(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    consentForEmergencyUse: source.consentForEmergencyUse === true,
    mobilityNeeds: normalizeAllowlistArray(source.mobilityNeeds, MOBILITY_NEEDS, "mobilityNeeds"),
    sensoryNeeds: normalizeAllowlistArray(source.sensoryNeeds, SENSORY_NEEDS, "sensoryNeeds"),
    communicationNeeds: normalizeAllowlistArray(source.communicationNeeds, COMMUNICATION_NEEDS, "communicationNeeds"),
    medicalFlags: normalizeAllowlistArray(source.medicalFlags, MEDICAL_FLAGS, "medicalFlags"),
    supportContacts: normalizeSupportContacts(source.supportContacts),
    shortNotes: sanitizeText(source.shortNotes, SHORT_NOTES_MAX),
    updatedAt: new Date(),
  };
}

function serializeInclusionProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  return {
    consentForEmergencyUse: profile.consentForEmergencyUse === true,
    mobilityNeeds: Array.isArray(profile.mobilityNeeds) ? profile.mobilityNeeds : [],
    sensoryNeeds: Array.isArray(profile.sensoryNeeds) ? profile.sensoryNeeds : [],
    communicationNeeds: Array.isArray(profile.communicationNeeds) ? profile.communicationNeeds : [],
    medicalFlags: Array.isArray(profile.medicalFlags) ? profile.medicalFlags : [],
    supportContacts: Array.isArray(profile.supportContacts)
      ? profile.supportContacts.map((contact) => ({
          name: sanitizeText(contact?.name, CONTACT_NAME_MAX),
          phone: sanitizeText(contact?.phone, CONTACT_PHONE_MAX),
          relationship: SUPPORT_RELATIONSHIPS.has(contact?.relationship) ? contact.relationship : "other",
        })).filter((contact) => contact.name || contact.phone).slice(0, CONTACT_LIMIT)
      : [],
    shortNotes: sanitizeText(profile.shortNotes, SHORT_NOTES_MAX),
    updatedAt: profile.updatedAt || null,
  };
}

function buildOperationalInclusionSummary(profile) {
  const safeProfile = serializeInclusionProfile(profile);
  if (!safeProfile || safeProfile.consentForEmergencyUse !== true) return null;

  const categories = [
    ...safeProfile.mobilityNeeds,
    ...safeProfile.sensoryNeeds,
    ...safeProfile.communicationNeeds,
    ...safeProfile.medicalFlags,
  ];
  const labels = categories.map((item) => LABELS[item]).filter(Boolean);
  const supportContactCount = safeProfile.supportContacts.length;
  const summaryParts = [
    ...labels.slice(0, 6),
    ...(supportContactCount > 0 ? [`${supportContactCount} contact(e) de sprijin disponibil(e)`] : []),
    ...(safeProfile.shortNotes ? [`nota operationala scurta: ${safeProfile.shortNotes}`] : []),
  ];

  if (!summaryParts.length) return null;

  return {
    consentForEmergencyUse: true,
    labels: labels.slice(0, 6),
    mobilityNeeds: safeProfile.mobilityNeeds,
    sensoryNeeds: safeProfile.sensoryNeeds,
    communicationNeeds: safeProfile.communicationNeeds,
    medicalFlags: safeProfile.medicalFlags,
    supportContactCount,
    shortNotes: safeProfile.shortNotes,
    summary: summaryParts.join("; ").slice(0, 360),
  };
}

module.exports = {
  ALLOWLISTS: {
    mobilityNeeds: [...MOBILITY_NEEDS],
    sensoryNeeds: [...SENSORY_NEEDS],
    communicationNeeds: [...COMMUNICATION_NEEDS],
    medicalFlags: [...MEDICAL_FLAGS],
    supportRelationships: [...SUPPORT_RELATIONSHIPS],
  },
  normalizeInclusionProfile,
  serializeInclusionProfile,
  buildOperationalInclusionSummary,
};
