const assert = require("node:assert/strict");

const {
  classifySignalHealth,
  shouldReplaceSignal,
} = require("../src/services/signalFusionService");
const {
  buildPersonalRiskPayload,
  computePersonalRiskV2,
  computeAdjustedScore,
} = require("../src/services/riskSnapshotService");
const {
  buildSituationalAwareness,
} = require("../src/services/situationalAwarenessEngine");
const {
  hasMinimumLiveContext,
  decideResponseMode,
  resolveScenario,
  classifyCommunicationIntent,
  buildAssistantResponse,
  answerCommunicationMessage,
  getEmergencyCopilotRuntimeInfo,
} = require("../src/services/emergencyCopilotService");
const {
  buildApproximateLocationLabel,
  buildSosTimelineEntry,
  normalizeSosContacts,
  normalizeSosLocation,
} = require("../src/services/sosLifecycleService");
const {
  getTranslationSourceHash,
  translateNewsDocument,
} = require("../src/services/newsTranslationService");
const {
  normalizeInclusionProfile,
  serializeInclusionProfile,
  buildOperationalInclusionSummary,
} = require("../src/services/inclusionProfileService");
const { createAuthTokenService } = require("../src/services/authTokenService");

const tests = [];

function addTest(name, fn) {
  tests.push({ name, fn });
}

addTest("signal health: live/degraded/stale rules", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");

  const live = classifySignalHealth(
    {
      observedAt: new Date("2026-04-15T11:52:00.000Z"),
      freshUntil: new Date("2026-04-15T12:20:00.000Z"),
      confidence: 70,
    },
    now,
  );
  assert.equal(live.status, "live");

  const degraded = classifySignalHealth(
    {
      observedAt: new Date("2026-04-15T11:50:00.000Z"),
      freshUntil: new Date("2026-04-15T12:20:00.000Z"),
      confidence: 42,
    },
    now,
  );
  assert.equal(degraded.status, "degraded");

  const stale = classifySignalHealth(
    {
      observedAt: new Date("2026-04-15T10:00:00.000Z"),
      freshUntil: new Date("2026-04-15T12:20:00.000Z"),
      confidence: 80,
    },
    now,
  );
  assert.equal(stale.status, "stale");
});

addTest("news translation service returns valid cached translations only", async () => {
  const article = {
    title: "Storm warning",
    summary: "Heavy rain expected",
    content: "Stay inside.",
    translations: {},
  };
  article.translations.ro = {
    title: "Avertizare de furtuna",
    summary: "Se asteapta ploi puternice",
    content: "Ramaneti inauntru.",
    provider: "argos-translate",
    providerVersion: "local-v1",
    translationSourceHash: getTranslationSourceHash(article),
  };

  const cached = await translateNewsDocument(article, "ro", { includeContent: true });
  assert.equal(cached.title, "Avertizare de furtuna");
  assert.equal(cached.summary, "Se asteapta ploi puternice");
  assert.equal(cached.content, "Ramaneti inauntru.");
  assert.equal(cached.translationStatus, "cached");

  article.translations.ro.translationSourceHash = "stale";
  const stale = await translateNewsDocument(article, "ro", { includeContent: true });
  assert.equal(stale, null);
});

addTest("news translation service falls back when cached translation is incomplete", async () => {
  const article = {
    title: "Storm warning",
    summary: "Heavy rain expected",
    content: "Stay inside.",
    translations: {},
  };
  article.translations.ro = {
    title: "Avertizare de furtuna",
    summary: "",
    content: "Ramaneti inauntru.",
    provider: "argos-translate",
    providerVersion: "local-v1",
    translationSourceHash: getTranslationSourceHash(article),
  };

  const cached = await translateNewsDocument(article, "ro", { includeContent: true });
  assert.equal(cached, null);
});

addTest("sos lifecycle helpers persist operational location without exposing exact notification text", () => {
  const location = normalizeSosLocation({
    lat: 44.4268123,
    lng: 26.1025123,
    accuracy: 12,
    timestamp: "2026-04-15T12:00:00.000Z",
  });
  assert.equal(location.lat, 44.4268123);
  assert.equal(location.lng, 26.1025123);
  assert.equal(location.lon, 26.1025123);
  assert.equal(location.source, "client");

  const label = buildApproximateLocationLabel(location);
  assert.match(label, /zona aprox\./);
  assert.doesNotMatch(label, /44\.4268123/);
  assert.doesNotMatch(label, /26\.1025123/);
});

addTest("sos contacts are honest when no delivery provider exists", () => {
  const contacts = normalizeSosContacts({
    contacts: [
      { name: "Ana", phone: "0712345678", relationship: "family", notifyMethod: "sms" },
    ],
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].notifiedStatus, "not_available");
  assert.equal(contacts[0].notifiedAt, null);
  assert.match(contacts[0].error, /No SMS\/email delivery provider/);
});

addTest("sos timeline entries include audit type, message, timestamp, and actor", () => {
  const at = new Date("2026-04-15T12:00:00.000Z");
  const entry = buildSosTimelineEntry("acknowledged", "Confirmed", { name: "Operator" }, at);
  assert.equal(entry.type, "acknowledged");
  assert.equal(entry.message, "Confirmed");
  assert.equal(entry.at, at);
  assert.deepEqual(entry.actor, { name: "Operator" });
});

addTest("inclusion profile normalizes allowlisted optional fields only", () => {
  const profile = normalizeInclusionProfile({
    consentForEmergencyUse: true,
    mobilityNeeds: ["wheelchair", "wheelchair", "needs_transport_assistance"],
    sensoryNeeds: ["deaf"],
    communicationNeeds: ["prefers_text", "simple_language"],
    medicalFlags: ["critical_medication"],
    supportContacts: [
      { name: "Ana Emergency Contact".repeat(8), phone: "+40 712 345 678 ext !!!!", relationship: "family" },
    ],
    shortNotes: " Foloseste mesaje scurte. ".repeat(20),
  });

  assert.equal(profile.consentForEmergencyUse, true);
  assert.deepEqual(profile.mobilityNeeds, ["wheelchair", "needs_transport_assistance"]);
  assert.equal(profile.supportContacts.length, 1);
  assert.equal(profile.supportContacts[0].name.length, 80);
  assert.ok(profile.shortNotes.length <= 160);
});

addTest("inclusion profile rejects values outside allowlists", () => {
  assert.throws(
    () => normalizeInclusionProfile({ medicalFlags: ["diagnostic_free_text"] }),
    /valoare nepermisa/,
  );
  assert.throws(
    () => normalizeInclusionProfile({ supportContacts: [{ relationship: "unknown_role" }] }),
    /relationship/,
  );
});

addTest("operational inclusion summary is consent-gated and minimal", () => {
  const profile = normalizeInclusionProfile({
    consentForEmergencyUse: false,
    mobilityNeeds: ["wheelchair"],
    medicalFlags: ["critical_medication"],
    shortNotes: "Nota scurta",
  });
  assert.equal(buildOperationalInclusionSummary(profile), null);

  const consented = serializeInclusionProfile({ ...profile, consentForEmergencyUse: true });
  const summary = buildOperationalInclusionSummary(consented);
  assert.equal(summary.consentForEmergencyUse, true);
  assert.match(summary.summary, /scaun rulant/);
  assert.match(summary.summary, /medicatie critica/);
  assert.doesNotMatch(JSON.stringify(summary), /diagnostic/i);
});

addTest("signal conflict policy: priority > confidence > recency", () => {
  const previous = {
    sourcePriority: 70,
    confidence: 70,
    observedAt: new Date("2026-04-15T10:00:00.000Z"),
  };
  assert.equal(
    shouldReplaceSignal(previous, {
      sourcePriority: 80,
      confidence: 10,
      observedAt: new Date("2026-04-15T09:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldReplaceSignal(previous, {
      sourcePriority: 70,
      confidence: 90,
      observedAt: new Date("2026-04-15T09:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldReplaceSignal(previous, {
      sourcePriority: 70,
      confidence: 70,
      observedAt: new Date("2026-04-15T12:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldReplaceSignal(previous, {
      sourcePriority: 60,
      confidence: 99,
      observedAt: new Date("2026-04-15T13:00:00.000Z"),
    }),
    false,
  );
});

addTest("auth token service enforces strict Bearer format", () => {
  const auth = createAuthTokenService({ jwtSecret: "test-secret", nodeEnv: "test" });
  assert.equal(auth.extractBearerToken("").errorType, "missing_token");
  assert.equal(auth.extractBearerToken("Basic abc").errorType, "malformed_token");
  assert.equal(auth.extractBearerToken("Bearer").errorType, "malformed_token");
  assert.equal(auth.extractBearerToken("Bearer a b").errorType, "malformed_token");
});

addTest("auth token service signs and verifies minimal claims", () => {
  const auth = createAuthTokenService({
    jwtSecret: "test-secret",
    jwtExpiresIn: "8h",
    jwtClockSkewSeconds: 60,
    nodeEnv: "test",
  });
  const token = auth.signAccessToken({
    _id: "507f191e810c19729de860ea",
    email: "USER@EXAMPLE.COM",
    role: "employee",
  });
  const verified = auth.verifyJwtToken(token);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.sub, "507f191e810c19729de860ea");
  assert.equal(verified.payload.email, "user@example.com");
  assert.equal(verified.payload.role, "employee");
});

addTest("auth token service detects invalid signature and malformed tokens", () => {
  const a = createAuthTokenService({ jwtSecret: "secret-a", nodeEnv: "test" });
  const b = createAuthTokenService({ jwtSecret: "secret-b", nodeEnv: "test" });
  const signedByB = b.signAccessToken({
    _id: "507f191e810c19729de860ea",
    email: "user@example.com",
    role: "customer",
  });
  assert.equal(a.verifyJwtToken(signedByB).errorType, "invalid_signature");
  assert.equal(a.verifyJwtToken("not.a.jwt").errorType, "malformed_token");
});

addTest("auth token service applies clock skew tolerance for near-expired token", () => {
  const auth = createAuthTokenService({
    jwtSecret: "skew-secret",
    jwtExpiresIn: "-30s",
    jwtClockSkewSeconds: 60,
    nodeEnv: "test",
  });
  const token = auth.signAccessToken({
    _id: "507f191e810c19729de860ea",
    email: "user@example.com",
    role: "customer",
  });
  const verified = auth.verifyJwtToken(token);
  assert.equal(verified.ok, true);
});

addTest("risk scoring v2 keeps source health informational", () => {
  const userLocation = {
    name: "Home",
    coordinates: { lat: 44.4268, lon: 26.1025 },
  };
  const incidents = [
    {
      id: "incident-1",
      title: "Nearby incident",
      status: "active",
      dangerScore: 70,
      riskUpdatedAt: "2026-04-15T11:30:00.000Z",
      location: { lat: 44.4268, lon: 26.1025, radiusKm: 1 },
    },
  ];
  const live = computePersonalRiskV2({
    incidents,
    userLocation,
    sourceHealth: [{ status: "live", confidence: 90 }],
    now: new Date("2026-04-15T12:00:00.000Z"),
  });
  const stale = computePersonalRiskV2({
    incidents,
    userLocation,
    sourceHealth: [{ status: "stale", confidence: 10 }],
    now: new Date("2026-04-15T12:00:00.000Z"),
  });
  assert.equal(live.riskStatus.score, stale.riskStatus.score);
  assert.equal(live.scoringMeta.evaluationVersion, "v2.0.3");

  const adjusted = computeAdjustedScore(70, [
    { status: "live", confidence: 80 },
    { status: "degraded", confidence: 50 },
    { status: "stale", confidence: 30 },
  ]);
  assert.equal(adjusted.score, 70);
  assert.equal(adjusted.sourcePenalty, 0);
  assert.equal(adjusted.confidenceFactor, 1);
  assert.equal(adjusted.degradedCount, 1);
  assert.equal(adjusted.staleCount, 1);
});

addTest("dashboard situation exposes regional-context liveRiskFactors shape", async () => {
  const payload = await buildSituationalAwareness({
    incidents: [
      {
        id: "waze-1",
        title: "Ambuteiaj Waze nivel 4 pe Bd. I. C. Bratianu",
        type: "traffic_jam",
        status: "active",
        dangerScore: 80,
        riskUpdatedAt: "2026-04-15T11:30:00.000Z",
        location: { lat: 44.4268, lon: 26.1025, radiusKm: 1 },
      },
    ],
    news: [],
    userLocation: {
      name: "Home",
      coordinates: { lat: 44.4268, lon: 26.1025 },
    },
  });

  assert.deepEqual(payload.liveRiskFactors.map((item) => item.category), [
    "Political stability",
    "Economic pressure",
    "Border / conflict risk",
    "Infrastructure resilience",
    "System stress",
  ]);
  assert.ok(payload.liveRiskFactors.every((item) =>
    ["id", "category", "score", "status", "detail"].every((key) => Object.hasOwn(item, key)),
  ));
  assert.ok(payload.liveRiskFactors.every((item) => item.scope === "regional_context"));
  assert.equal(payload.liveRiskFactors.every((item) => !/Waze|Ambuteiaj|Bratianu/i.test(item.detail)), true);
});

addTest("dashboard regional context filters irrelevant news and avoids raw titles in detail", async () => {
  const sportsTitle = "The Athletic Sports coverage";
  const payload = await buildSituationalAwareness({
    incidents: [],
    news: [
      {
        id: "sports-1",
        title: sportsTitle,
        summary: "Unrivaled sports coverage across every team and every league.",
        severityScore: 95,
        publishedAt: new Date().toISOString(),
        source: "Sports feed",
      },
      {
        id: "conflict-1",
        title: "Armed groups launch coordinated attacks across Mali",
        summary: "Regional security officials warn that border escalation and armed groups may raise conflict pressure.",
        severityScore: 82,
        publishedAt: new Date().toISOString(),
        source: "Regional security feed",
        region: "Africa",
      },
      {
        id: "economy-1",
        title: "Inflation and energy prices add market stress",
        summary: "Economy analysts report inflation, energy prices, and supply chain pressure across the region.",
        severityScore: 68,
        publishedAt: new Date().toISOString(),
        source: "Macro feed",
        region: "Europe",
      },
    ],
  });

  const details = payload.liveRiskFactors.map((item) => item.detail).join(" ");
  const contributorText = payload.liveRiskFactors
    .flatMap((item) => item.contributors || [])
    .map((item) => item.summary)
    .join(" ");
  assert.equal(/classified as|average evidence strength|web:[^\s]+ contributes/i.test(`${details} ${contributorText}`), false);
  assert.equal(/Sports coverage|every team|every league/i.test(`${details} ${contributorText}`), false);
  assert.equal(payload.liveRiskFactors.some((item) => item.detail === sportsTitle), false);
  assert.equal(payload.liveRiskFactors.some((item) => item.detail === "Armed groups launch coordinated attacks across Mali"), false);
  assert.ok(payload.liveRiskFactors.find((item) => item.category === "Border / conflict risk").score > 0);
  const economic = payload.liveRiskFactors.find((item) => item.category === "Economic pressure");
  assert.ok(economic.score > 0);
  assert.equal(economic.contributors.every((item) => item.signalId !== "conflict-1"), true);
  assert.equal(payload.liveRiskFactors.find((item) => item.category === "Infrastructure resilience").score, 0);
});

addTest("regional context keeps system stress low without multi-category elevation", async () => {
  const payload = await buildSituationalAwareness({
    incidents: [],
    news: [
      {
        id: "economy-low-1",
        title: "Energy prices mentioned in regional outlook",
        summary: "Regional economy coverage mentions energy prices and inflation, but analysts describe the outlook as stable.",
        severityScore: 34,
        publishedAt: new Date().toISOString(),
        source: "Macro feed",
        region: "Europe",
      },
      {
        id: "politics-low-1",
        title: "Parliament debate continues without major instability",
        summary: "Government and parliament talks continue without protest escalation or cabinet crisis.",
        severityScore: 32,
        publishedAt: new Date().toISOString(),
        source: "Politics feed",
        region: "Europe",
      },
    ],
  });

  const systemStress = payload.liveRiskFactors.find((item) => item.category === "System stress");
  assert.ok(systemStress.score < 56);
  assert.notEqual(systemStress.status, "High");
  assert.match(systemStress.detail, /low|capped/i);
});

addTest("regional context caps system stress below high for only two elevated categories", async () => {
  const payload = await buildSituationalAwareness({
    incidents: [],
    news: [
      {
        id: "economy-high-1",
        title: "Inflation and energy prices add market stress",
        summary: "Inflation, energy prices, market stress and supply chain pressure are elevated across the region.",
        severityScore: 95,
        publishedAt: new Date().toISOString(),
        source: "Macro feed",
        region: "Europe",
      },
      {
        id: "conflict-high-1",
        title: "Border conflict escalation",
        summary: "Military border escalation, armed groups, sanctions and security posture are raising conflict risk.",
        severityScore: 95,
        publishedAt: new Date().toISOString(),
        source: "Security feed",
        region: "Europe",
      },
    ],
  });

  const systemStress = payload.liveRiskFactors.find((item) => item.category === "System stress");
  assert.ok(systemStress.score < 76);
  assert.notEqual(systemStress.status, "High");
});

addTest("regional context contributors are deduped across categories", async () => {
  const payload = await buildSituationalAwareness({
    incidents: [],
    news: [
      {
        id: "multi-1",
        url: "https://example.com/shared-regional-brief",
        title: "Government, inflation and border pressure in one regional brief",
        summary: "Government talks, inflation pressure and border security are all mentioned in one regional brief.",
        severityScore: 70,
        publishedAt: new Date().toISOString(),
        source: "web:example.com",
        region: "Europe",
      },
      {
        id: "multi-duplicate",
        url: "https://example.com/shared-regional-brief",
        title: "Duplicate regional brief",
        summary: "Duplicate government and inflation brief.",
        severityScore: 90,
        publishedAt: new Date().toISOString(),
        source: "web:example.com",
        region: "Europe",
      },
    ],
  });

  const signalIds = payload.liveRiskFactors
    .filter((item) => item.category !== "System stress")
    .flatMap((item) => item.contributors || [])
    .map((item) => item.signalId);
  assert.equal(signalIds.length, new Set(signalIds).size);
  assert.equal(signalIds.filter((id) => id === "multi-1" || id === "multi-duplicate").length, 1);
  assert.equal(/web:[^\s]+ contributes/i.test(JSON.stringify(payload.liveRiskFactors)), false);
});

addTest("regional context does not modify personal-risk payload", async () => {
  const userLocation = {
    name: "Home",
    coordinates: { lat: 44.4268, lon: 26.1025 },
  };
  const incidents = [
    {
      id: "incident-1",
      title: "Nearby fire",
      type: "fire",
      status: "active",
      dangerScore: 70,
      riskUpdatedAt: "2026-04-15T11:30:00.000Z",
      location: { lat: 44.4268, lon: 26.1025, radiusKm: 1 },
    },
  ];
  const regionalNews = [
    {
      id: "conflict-1",
      title: "Border conflict escalation",
      summary: "Military border escalation and sanctions raised regional conflict risk.",
      severityScore: 95,
      publishedAt: "2026-04-15T11:00:00.000Z",
      source: "Regional security feed",
    },
  ];

  await buildSituationalAwareness({ incidents: [], news: regionalNews, userLocation });
  const withoutNews = await buildPersonalRiskPayload({ incidents, news: [], userLocation, persist: false });
  const withRegionalNews = await buildPersonalRiskPayload({ incidents, news: regionalNews, userLocation, persist: false });

  assert.equal(withRegionalNews.riskStatus.score, withoutNews.riskStatus.score);
  assert.deepEqual(Object.keys(withRegionalNews).sort(), Object.keys(withoutNews).sort());
});

addTest("copilot mode guardrails", () => {
  assert.equal(
    hasMinimumLiveContext(
      { riskStatus: { score: 0 }, sourceHealth: [] },
      { liveRiskFactors: [] },
    ),
    false,
  );
  assert.equal(
    decideResponseMode({
      triageLevel: "critical",
      escalateNow: false,
      hasGuides: true,
      hasLiveContext: true,
    }),
    "rules_only",
  );
  assert.equal(
    decideResponseMode({
      triageLevel: "medium",
      escalateNow: false,
      hasGuides: true,
      hasLiveContext: true,
    }),
    "hybrid_llm",
  );
  assert.equal(
    decideResponseMode({
      triageLevel: "medium",
      escalateNow: false,
      hasGuides: true,
      hasLiveContext: false,
    }),
    "retrieval_only",
  );
});

addTest("copilot runtime exposes real implementation details", () => {
  const info = getEmergencyCopilotRuntimeInfo();
  assert.equal(info.hasScenarioRouting, true);
  assert.equal(info.usesDynamicPrompts, true);
  assert.equal(info.usesRetrieval, true);
  assert.ok(info.policyVersion);
  assert.ok(info.scenarioCount >= 5);
  assert.ok(info.playbookCount >= 5);
  assert.ok(info.trainingExampleCount >= 10);
});

addTest("copilot scenario routing differentiates fire vs earthquake vs breathing", () => {
  assert.equal(
    resolveScenario({ message: "incendiu in apartament si mult fum" }).scenario.id,
    "fire_home",
  );
  assert.equal(
    resolveScenario({ message: "este cutremur si se misca tot in apartament" }).scenario.id,
    "earthquake_indoor",
  );
  assert.equal(
    resolveScenario({ message: "nu pot respira deloc" }).scenario.id,
    "respiratory_distress",
  );
});

addTest("copilot routing is deterministic for same input and history", () => {
  const history = [
    { role: "assistant", scenarioId: "general_emergency", at: "2026-04-29T12:00:00.000Z" },
    { role: "user", text: "there is a fire active", at: "2026-04-29T12:00:05.000Z" },
  ];
  const a = resolveScenario({ message: "fire", history });
  const b = resolveScenario({ message: "fire", history });
  assert.equal(a.scenario.id, b.scenario.id);
  assert.equal(a.triageLevel, b.triageLevel);
  assert.equal(a.escalateNow, b.escalateNow);
  assert.equal(a.routingDiagnostics?.topScore, b.routingDiagnostics?.topScore);
});

addTest("copilot short follow-up fire routes to fire scenario", () => {
  const history = [
    { role: "assistant", scenarioId: "general_emergency", at: new Date().toISOString() },
    { role: "user", text: "there is a fire active", at: new Date().toISOString() },
  ];
  const resolved = resolveScenario({ message: "fire", history });
  assert.equal(resolved.scenario.id, "fire_home");
});

addTest("copilot clear new scenario overrides previous fire context", () => {
  const history = [
    { role: "assistant", scenarioId: "fire_home", at: new Date().toISOString() },
    { role: "user", text: "fire", at: new Date().toISOString() },
  ];
  const resolved = resolveScenario({ message: "not breathing", history });
  assert.equal(resolved.scenario.id, "respiratory_distress");
});

addTest("copilot false-positive inputs stay non-emergency/general", () => {
  assert.equal(
    classifyCommunicationIntent({ message: "I need help with my account" }).scenario.id,
    "non_emergency_general",
  );
  assert.equal(
    classifyCommunicationIntent({ message: "there was an accident in the news" }).scenario.id,
    "non_emergency_general",
  );
});

addTest("copilot does not auto-escalate vague pain input", () => {
  const response = classifyCommunicationIntent({ message: "I have pain from yesterday" });
  assert.notEqual(response.triageLevel, "critical");
});

addTest("copilot diagnostics explain generic fallback reason in dev/test", () => {
  const resolved = resolveScenario({ message: "zzqv" });
  assert.ok(typeof resolved.routingDiagnostics?.fallbackReason === "string");
  assert.ok(resolved.routingDiagnostics.fallbackReason.length > 0);
});

addTest("copilot production mode hides routing diagnostics", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDebug = process.env.EMERGENCY_COPILOT_DEBUG_ROUTING;
  process.env.NODE_ENV = "production";
  delete process.env.EMERGENCY_COPILOT_DEBUG_ROUTING;
  const result = classifyCommunicationIntent({ message: "zzqv" });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "routingDiagnostics"), false);
  process.env.NODE_ENV = originalNodeEnv;
  if (originalDebug == null) {
    delete process.env.EMERGENCY_COPILOT_DEBUG_ROUTING;
  } else {
    process.env.EMERGENCY_COPILOT_DEBUG_ROUTING = originalDebug;
  }
});

addTest("copilot answers stay scenario-specific and avoid dashboard content", async () => {
  const fire = await buildAssistantResponse({
    language: "ro",
    userMessage: "incendiu in bucatarie",
    guideIndex: [],
    riskPayload: { riskStatus: { score: 88 }, sourceHealth: [{ status: "live" }] },
    situationPayload: { liveRiskFactors: [{ id: "factor-1" }] },
    userLocation: null,
  });
  assert.match(fire.answer, /112/i);
  assert.match(fire.answer, /lift/i);
  assert.match(fire.answer, /fum/i);
  assert.doesNotMatch(fire.answer, /scor de risc/i);
  assert.doesNotMatch(fire.answer, /news/i);
  assert.doesNotMatch(fire.answer, /dashboard/i);

  const quake = await buildAssistantResponse({
    language: "ro",
    userMessage: "cutremur puternic",
    guideIndex: [],
    riskPayload: null,
    situationPayload: null,
    userLocation: null,
  });
  assert.match(quake.answer, /protejeaza capul/i);
  assert.match(quake.answer, /geamuri/i);
  assert.match(quake.answer, /scari/i);
  assert.notEqual(quake.answer, fire.answer);

  const breathing = await buildAssistantResponse({
    language: "ro",
    userMessage: "nu pot respira",
    guideIndex: [],
    riskPayload: null,
    situationPayload: null,
    userLocation: null,
  });
  assert.match(breathing.answer, /112/i);
  assert.match(breathing.answer, /semisezand/i);
  assert.match(breathing.answer, /respirat/i);
});

addTest("copilot remains useful without location", async () => {
  const response = await buildAssistantResponse({
    language: "ro",
    userMessage: "am cazut si cred ca am fractura la picior",
    guideIndex: [],
    riskPayload: null,
    situationPayload: null,
    userLocation: null,
  });
  assert.match(response.answer, /Chiar daca locatia lipseste/i);
  assert.match(response.answer, /Nu forta miscarea/i);
  assert.equal((response.askNext.match(/\?/g) || []).length <= 1, true);
});

addTest("communication intent detects emergency vs general question", () => {
  assert.equal(
    classifyCommunicationIntent({ message: "nu pot respira si ma sufoc" }).intent,
    "real_emergency",
  );
  assert.equal(
    classifyCommunicationIntent({ message: "cum ma pregatesc pentru cutremur?" }).intent,
    "general_question",
  );
});

addTest("communication AI stays rules-first for emergencies", async () => {
  const response = await answerCommunicationMessage({
    message: "se vede osul la picior dupa cazatura",
    history: [],
    language: "ro",
  });
  assert.equal(response.isEmergency, true);
  assert.equal(response.scenarioId, "fracture_open");
  assert.match(response.answer, /112/i);
  assert.match(response.answer, /nu face asta|nu forta|acopera rana/i);
});

addTest("communication AI can answer non-emergency questions safely", async () => {
  const response = await answerCommunicationMessage({
    message: "cum ma pregatesc pentru un cutremur acasa?",
    history: [],
    language: "ro",
  });
  assert.equal(response.isEmergency, false);
  assert.equal(response.intent, "general_question");
  assert.equal(response.scenarioId, "non_emergency_general");
  assert.ok(typeof response.answer === "string" && response.answer.length > 0);
});

async function run() {
  let failures = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${entry.name}`);
      console.error(error?.stack || error);
    }
  }
  
  if (failures > 0) {
    console.error(`\nTest run finished with ${failures} failure(s).`);
    process.exit(1);
  }

  console.log(`\nAll ${tests.length} tests passed.`);
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
