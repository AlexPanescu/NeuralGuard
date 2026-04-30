const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RISK_EVALUATION_VERSION,
  buildPersonalRiskPayload,
  computeAdjustedScore,
  computePersonalRiskV2,
} = require("../src/services/riskSnapshotService");

const userLocation = {
  name: "Home",
  coordinates: { lat: 44.4268, lon: 26.1025 },
};

function incident(overrides = {}) {
  return {
    id: overrides.id || "incident-1",
    title: overrides.title || "Nearby incident",
    type: overrides.type || "public_safety",
    source: overrides.source,
    status: overrides.status || "active",
    severity: overrides.severity,
    dangerScore: overrides.dangerScore,
    riskUpdatedAt: overrides.riskUpdatedAt || "2026-04-15T11:30:00.000Z",
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
    operatorConfirmed: overrides.operatorConfirmed,
    ingestionMeta: overrides.ingestionMeta,
    timeline: overrides.timeline,
    location: {
      lat: overrides.lat ?? 44.4268,
      lon: overrides.lon ?? 26.1025,
      radiusKm: overrides.radiusKm,
    },
  };
}

test("v2 critical nearby incident produces elevated score", () => {
  const result = computePersonalRiskV2({
    incidents: [incident({ title: "Incendiu cu victime", type: "fire", dangerScore: 90, radiusKm: 1 })],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 90);
  assert.equal(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.evaluationVersion, "v2.0.3");
  assert.equal(result.scoringMeta.hasDirectSafetySignal, true);
});

test("v2 one nearby active unconfirmed SOS does not exceed score 55", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({
        id: "sos-single",
        title: "SOS grok",
        type: "medical",
        source: "sos",
        severity: "critical",
        dangerScore: 70,
        radiusKm: 0,
        riskUpdatedAt: "2026-04-15T11:59:00.000Z",
      }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 55);
  assert.notEqual(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.sosCalibration.unconfirmedSosCount, 1);
  assert.equal(result.scoringMeta.sosCalibration.capApplied, true);
  assert.equal(result.scoringMeta.sosCalibration.capReason, "unconfirmed_sos_single");
  assert.match(result.riskExplanation.plainSummary, /not been operationally confirmed/);
});

test("v2 multiple similar unconfirmed SOS alerts do not exceed score 65", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "sos-1", title: "SOS grok", type: "medical", source: "sos", dangerScore: 70, lat: 44.4268, lon: 26.1025, radiusKm: 0, riskUpdatedAt: "2026-04-15T11:59:00.000Z" }),
      incident({ id: "sos-2", title: "SOS grok", type: "medical", source: "sos", dangerScore: 70, lat: 44.4271, lon: 26.1027, radiusKm: 0, riskUpdatedAt: "2026-04-15T11:58:00.000Z" }),
      incident({ id: "sos-3", title: "SOS grok", type: "medical", source: "sos", dangerScore: 70, lat: 44.4272, lon: 26.1028, radiusKm: 0, riskUpdatedAt: "2026-04-15T11:57:00.000Z" }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.ok(result.riskStatus.score <= 65);
  assert.notEqual(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.sosCalibration.unconfirmedSosCount, 3);
  assert.equal(result.scoringMeta.sosCalibration.clusterCount, 1);
  assert.equal(result.scoringMeta.sosCalibration.capApplied, true);
  assert.equal(result.scoringMeta.sosCalibration.capReason, "unconfirmed_sos_cluster");
  assert.match(result.riskExplanation.groupingExplanation, /grouped/);
});

test("v2 collapses duplicate SOS signals before aggregation", () => {
  const duplicateSos = (id, riskUpdatedAt) =>
    incident({
      id,
      title: "SOS grok",
      type: "medical",
      source: "sos",
      severity: "critical",
      dangerScore: 50,
      radiusKm: 0,
      riskUpdatedAt,
    });

  const result = computePersonalRiskV2({
    incidents: [
      duplicateSos("sos-1", "2026-04-15T11:59:00.000Z"),
      duplicateSos("sos-2", "2026-04-15T11:59:05.000Z"),
      duplicateSos("sos-3", "2026-04-15T11:59:10.000Z"),
      incident({ id: "hazard-1", title: "Pericol pe carosabil", type: "hazard", dangerScore: 20, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.scoringMeta.duplicateSignalsCollapsed, 2);
  assert.equal(result.scoringMeta.sosCalibration.duplicateCount, 2);
  assert.equal(result.scoringMeta.numberOfSignalsUsed, 2);
  assert.equal(result.riskStatus.score, 55);
});

test("v2 operator-confirmed SOS can exceed 75", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({
        id: "sos-confirmed",
        title: "SOS confirmat",
        type: "medical",
        source: "sos",
        dangerScore: 90,
        radiusKm: 1,
        timeline: [{ kind: "acknowledged", message: "Alerta SOS a fost confirmata." }],
      }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 90);
  assert.equal(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.sosCalibration.operatorConfirmed, true);
  assert.equal(result.scoringMeta.sosCalibration.capApplied, false);
});

test("v2 severe direct SOS with dangerScore at least 85 can exceed 75", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({
        id: "sos-severe",
        title: "SOS medical sever",
        type: "medical",
        source: "sos",
        dangerScore: 85,
        radiusKm: 1,
      }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 85);
  assert.equal(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.sosCalibration.unconfirmedSosCount, 0);
  assert.equal(result.scoringMeta.sosCalibration.capApplied, false);
});

test("v2 multiple independent severe non-SOS direct signals can exceed 75", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "fire-1", title: "Incendiu cu victime", type: "fire", dangerScore: 80, lat: 44.4268, lon: 26.1025, radiusKm: 1 }),
      incident({ id: "medical-1", title: "Interventie medicala", type: "medical", dangerScore: 75, lat: 44.4271, lon: 26.1026, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 100);
  assert.equal(result.riskStatus.level, "Critical");
});

test("v2 severe non-SOS incident stays above SOS cap with nearby unconfirmed SOS", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "fire-1", title: "Incendiu cu victime", type: "fire", dangerScore: 90, radiusKm: 1 }),
      incident({ id: "sos-nearby", title: "SOS grok", type: "medical", source: "sos", dangerScore: 70, radiusKm: 0 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 100);
  assert.equal(result.riskStatus.level, "Critical");
  assert.equal(result.scoringMeta.sosCap, null);
});

test("v2 resolved incident contributes zero", () => {
  const result = computePersonalRiskV2({
    incidents: [incident({ status: "resolved", dangerScore: 90, radiusKm: 1 })],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 0);
  assert.equal(result.riskStatus.level, "Low");
});

test("v2 distant incident outside radius and decay zone contributes zero", () => {
  const result = computePersonalRiskV2({
    incidents: [incident({ dangerScore: 90, lat: 44.5268, lon: 26.1025, radiusKm: 0.5 })],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 0);
  assert.equal(result.scoringMeta.topSignalValue, 0);
});

test("v2 missing timestamp is stale recency and missing radius uses 0.5km", () => {
  const item = incident({ dangerScore: 80 });
  delete item.riskUpdatedAt;
  delete item.location.radiusKm;

  const result = computePersonalRiskV2({
    incidents: [item],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 20);
  assert.equal(result.signals[0].recency, 0.25);
  assert.equal(result.signals[0].radiusKm, 0.5);
  assert.equal(result.signals[0].proximity, 1);
});

test("v2 no eligible signals skips aggregation and returns zero", () => {
  const result = computePersonalRiskV2({
    incidents: [incident({ status: "unknown", dangerScore: 90 })],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 0);
  assert.equal(result.scoringMeta.numberOfSignalsUsed, 0);
  assert.deepEqual(result.scoringMeta.aggregationBreakdown, []);
  assert.equal(
    result.riskExplanation.headline,
    "No active nearby incidents with usable location were found.",
  );
  assert.deepEqual(result.riskExplanation.mainReasons, []);
  assert.equal(result.riskExplanation.notCounted.unrecognized_status.length, 1);
});

test("v2 sorts signals before diminishing aggregation", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "a", title: "Twenty", dangerScore: 20, radiusKm: 1 }),
      incident({ id: "b", title: "Fifty", dangerScore: 50, radiusKm: 1 }),
      incident({ id: "c", title: "Thirty", dangerScore: 30, radiusKm: 1 }),
      incident({ id: "d", title: "Forty", dangerScore: 40, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 72);
  assert.deepEqual(
    result.scoringMeta.aggregationBreakdown.map((item) => item.title),
    ["Fifty", "Forty", "Thirty", "Twenty"],
  );
});

test("v2 congestion-only signals cannot saturate personal risk", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "jam-1", title: "Trafic aglomerat - DN1", type: "traffic", dangerScore: 80, radiusKm: 1 }),
      incident({ id: "jam-2", title: "Trafic aglomerat - DNCB", type: "traffic", dangerScore: 80, radiusKm: 1 }),
      incident({ id: "jam-3", title: "Trafic aglomerat - Centura", type: "traffic", dangerScore: 80, radiusKm: 1 }),
      incident({ id: "jam-4", title: "Trafic aglomerat - Bucuresti", type: "traffic", dangerScore: 80, radiusKm: 1 }),
      incident({ id: "jam-5", title: "Trafic aglomerat - Sector", type: "traffic", dangerScore: 80, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.scoringMeta.topSignalValue, 25);
  assert.equal(result.riskStatus.level, "Medium");
  assert.ok(result.riskStatus.score < 76);
});

test("v2 many minor traffic signals are capped after the top three", () => {
  const result = computePersonalRiskV2({
    incidents: Array.from({ length: 80 }, (_, index) =>
      incident({
        id: `jam-many-${index}`,
        title: `Trafic aglomerat - ${index}`,
        type: "traffic",
        dangerScore: 80,
        radiusKm: 1,
      }),
    ),
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.scoringMeta.topSignalValue, 25);
  assert.equal(result.riskStatus.score, 54);
  assert.equal(result.riskStatus.level, "High");
  assert.ok(result.scoringMeta.aggregationBreakdown.some((item) => item.capped));
});

test("v2 clusters without direct safety signals are capped below critical", () => {
  const result = computePersonalRiskV2({
    incidents: Array.from({ length: 12 }, (_, index) =>
      incident({
        id: `closed-${index}`,
        title: `Drum inchis - ${index}`,
        type: "road_closed",
        dangerScore: 95,
        radiusKm: 1,
      }),
    ),
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 74);
  assert.equal(result.riskStatus.level, "High");
  assert.equal(result.scoringMeta.aggregationCap.reason, "no_direct_safety_signal");
  assert.equal(result.scoringMeta.hasDirectSafetySignal, false);
  assert.match(result.riskExplanation.capExplanation, /Score capped at 74/);
});

test("v2 mixed Waze-style hazards without injury language stay capped below critical", () => {
  const result = computePersonalRiskV2({
    incidents: [
      ...Array.from({ length: 8 }, (_, index) =>
        incident({
          id: `hazard-${index}`,
          title: `Pericol pe carosabil - ${index}`,
          type: "hazard",
          dangerScore: 88,
          radiusKm: 1,
        }),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        incident({
          id: `accident-${index}`,
          title: `Accident rutier - ${index}`,
          type: "traffic",
          dangerScore: 88,
          radiusKm: 1,
        }),
      ),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 74);
  assert.equal(result.riskStatus.level, "High");
  assert.equal(result.scoringMeta.aggregationCap.reason, "no_direct_safety_signal");
});

test("riskExplanation main reasons are scored, short and sorted by contribution", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "top", title: "Incendiu cu victime", type: "fire", dangerScore: 90, radiusKm: 1 }),
      incident({ id: "mid", title: "Medical nearby", type: "medical", dangerScore: 60, radiusKm: 1 }),
      incident({ id: "low", title: "Security nearby", type: "security", dangerScore: 30, radiusKm: 1 }),
      incident({ id: "tail", title: "Another security signal", type: "security", dangerScore: 20, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  const reasons = result.riskExplanation.mainReasons;
  assert.equal(reasons.length, 3);
  assert.ok(reasons.every((item) => item.signalId));
  assert.deepEqual(reasons.map((item) => item.signalId), ["top", "mid", "low"]);
  assert.ok(reasons[0].scoreContribution >= reasons[1].scoreContribution);
  assert.ok(reasons[1].scoreContribution >= reasons[2].scoreContribution);
});

test("riskExplanation excludes zero-contribution signals from main reasons", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({ id: "active-1", title: "Incendiu cu victime", type: "fire", dangerScore: 90, radiusKm: 1 }),
      incident({ id: "resolved-1", title: "Resolved traffic", status: "resolved", dangerScore: 90, radiusKm: 1 }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.deepEqual(result.riskExplanation.mainReasons.map((item) => item.signalId), ["active-1"]);
  assert.equal(result.riskExplanation.notCounted.resolved.length, 1);
});

test("riskExplanation marks signals outside radius as distance-reduced", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({
        id: "edge-1",
        title: "Pericol pe carosabil - edge",
        type: "hazard",
        dangerScore: 45,
        lat: 44.4349,
        lon: 26.1025,
        radiusKm: 0.8,
      }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  const [reason] = result.riskExplanation.mainReasons;
  assert.ok(reason.evidence.distanceKm > reason.evidence.radiusKm);
  assert.equal(reason.evidence.proximity, "outside the impact radius; contribution reduced by distance");
  assert.match(reason.explanation, /outside the impact radius; contribution reduced by distance/);
});

test("riskExplanation notCounted is capped per reason and does not affect score", () => {
  const missing = Array.from({ length: 8 }, (_, index) => {
    const item = incident({ id: `missing-${index}`, title: `Missing ${index}`, dangerScore: 90 });
    delete item.location.lat;
    delete item.location.lon;
    return item;
  });
  const result = computePersonalRiskV2({
    incidents: missing,
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 0);
  assert.equal(result.riskExplanation.notCounted.missing_coordinates.length, 5);
});

test("v2 sourceHealth is metadata only and does not change score", () => {
  const base = {
    incidents: [incident({ dangerScore: 75, radiusKm: 1 })],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  };

  const live = computePersonalRiskV2({
    ...base,
    sourceHealth: [{ source: "internal", status: "live", confidence: 95 }],
  });
  const stale = computePersonalRiskV2({
    ...base,
    sourceHealth: [{ source: "internal", status: "stale", confidence: 5 }],
  });

  assert.equal(live.riskStatus.score, stale.riskStatus.score);
  assert.match(live.scoringMeta.sourceHealthNote, /informational only/);
});

test("v2 police presence slightly reduces existing nearby risk and never drives explanations", () => {
  const hazard = incident({
    id: "hazard-1",
    title: "Pericol pe carosabil",
    type: "hazard",
    dangerScore: 60,
    radiusKm: 1,
  });
  const police = incident({
    id: "police-1",
    title: "Politie in zona",
    type: "police",
    dangerScore: 90,
    radiusKm: 1,
  });

  const base = computePersonalRiskV2({
    incidents: [hazard],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });
  const withPolice = computePersonalRiskV2({
    incidents: [hazard, police],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(base.riskStatus.score, 60);
  assert.equal(withPolice.riskStatus.score, 56);
  assert.ok(base.riskStatus.score - withPolice.riskStatus.score <= 8);
  assert.equal(withPolice.scoringMeta.mitigationTotal, 4);
  assert.equal(withPolice.scoringMeta.numberOfSignalsUsed, 1);
  assert.equal(withPolice.scoringMeta.numberOfMitigationSignalsUsed, 1);
  assert.deepEqual(withPolice.riskExplanation.mainReasons.map((item) => item.signalId), ["hazard-1"]);
});

test("v2 police-only signal does not create personal risk", () => {
  const result = computePersonalRiskV2({
    incidents: [
      incident({
        id: "police-only",
        title: "Echipaj politie in zona",
        type: "police",
        dangerScore: 90,
        radiusKm: 1,
      }),
    ],
    userLocation,
    now: new Date("2026-04-15T12:00:00.000Z"),
  });

  assert.equal(result.riskStatus.score, 0);
  assert.equal(result.scoringMeta.topSignalValue, 0);
  assert.equal(result.scoringMeta.numberOfSignalsUsed, 0);
  assert.equal(result.scoringMeta.numberOfMitigationSignalsUsed, 1);
  assert.deepEqual(result.riskExplanation.mainReasons, []);
});

test("personal risk topSignals exclude police mitigation signals", async () => {
  const currentTime = new Date().toISOString();
  const payload = await buildPersonalRiskPayload({
    incidents: [
      incident({ id: "hazard-1", title: "Pericol pe carosabil", type: "hazard", dangerScore: 60, radiusKm: 1, riskUpdatedAt: currentTime }),
      incident({ id: "police-1", title: "Politie in zona", type: "police", dangerScore: 90, radiusKm: 1, riskUpdatedAt: currentTime }),
    ],
    news: [],
    userLocation,
    persist: false,
  });

  assert.equal(payload.riskStatus.score, 56);
  assert.deepEqual(payload.topSignals.map((item) => item.id), ["hazard-1"]);
  assert.equal(payload.scoringMeta.numberOfMitigationSignalsUsed, 1);
});

test("legacy computeAdjustedScore no longer applies source penalties", () => {
  const result = computeAdjustedScore(70, [
    { status: "degraded", confidence: 20 },
    { status: "stale", confidence: 10 },
  ]);

  assert.equal(result.score, 70);
  assert.equal(result.sourcePenalty, 0);
  assert.equal(result.confidenceFactor, 1);
  assert.equal(result.degradedCount, 1);
  assert.equal(result.staleCount, 1);
});

test("v2 non-local news does not change personal risk score", async () => {
  const payload = await buildPersonalRiskPayload({
    incidents: [],
    news: [
      {
        id: "news-1",
        title: "Regional briefing",
        severityScore: 95,
        status: "active",
        publishedAt: "2026-04-15T11:30:00.000Z",
      },
    ],
    userLocation,
    persist: false,
  });

  assert.equal(payload.riskStatus.score, 0);
  assert.equal(payload.scoringMeta.newsUsed, 0);
  assert.equal(payload.riskExplanation.notCounted.non_local_news.length, 1);
});

test("personal risk payload preserves frontend response keys", async () => {
  const payload = await buildPersonalRiskPayload({
    incidents: [incident({ dangerScore: 60, radiusKm: 1 })],
    news: [],
    userLocation,
    persist: false,
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "changedBecause",
    "delta",
    "locationReady",
    "previousScore",
    "riskDrivers",
    "riskExplanation",
    "riskStatus",
    "scoringMeta",
    "sourceHealth",
    "topSignals",
  ]);
  assert.equal(payload.scoringMeta.evaluationVersion, RISK_EVALUATION_VERSION);
});
