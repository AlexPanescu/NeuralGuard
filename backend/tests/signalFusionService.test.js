const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifySignalHealth,
  shouldReplaceSignal,
} = require("../src/services/signalFusionService");

test("classifySignalHealth marks live when <=15m and not expired", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");
  const signal = {
    observedAt: new Date("2026-04-15T11:52:00.000Z"),
    freshUntil: new Date("2026-04-15T12:30:00.000Z"),
    confidence: 72,
  };
  const result = classifySignalHealth(signal, now);
  assert.equal(result.status, "live");
  assert.equal(result.healthy, true);
});

test("classifySignalHealth marks degraded for low confidence", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");
  const signal = {
    observedAt: new Date("2026-04-15T11:55:00.000Z"),
    freshUntil: new Date("2026-04-15T12:20:00.000Z"),
    confidence: 30,
  };
  const result = classifySignalHealth(signal, now);
  assert.equal(result.status, "degraded");
  assert.equal(result.healthy, false);
});

test("classifySignalHealth marks stale if expired", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");
  const signal = {
    observedAt: new Date("2026-04-15T11:58:00.000Z"),
    freshUntil: new Date("2026-04-15T11:59:00.000Z"),
    confidence: 95,
  };
  const result = classifySignalHealth(signal, now);
  assert.equal(result.status, "stale");
  assert.equal(result.healthy, false);
});

test("shouldReplaceSignal follows priority > confidence > recency", () => {
  const prev = {
    sourcePriority: 70,
    confidence: 70,
    observedAt: new Date("2026-04-15T11:00:00.000Z"),
  };

  const higherPriority = {
    sourcePriority: 80,
    confidence: 10,
    observedAt: new Date("2026-04-15T10:00:00.000Z"),
  };
  assert.equal(shouldReplaceSignal(prev, higherPriority), true);

  const samePriorityHigherConfidence = {
    sourcePriority: 70,
    confidence: 85,
    observedAt: new Date("2026-04-15T09:00:00.000Z"),
  };
  assert.equal(shouldReplaceSignal(prev, samePriorityHigherConfidence), true);

  const samePrioritySameConfidenceNewer = {
    sourcePriority: 70,
    confidence: 70,
    observedAt: new Date("2026-04-15T12:00:00.000Z"),
  };
  assert.equal(shouldReplaceSignal(prev, samePrioritySameConfidenceNewer), true);

  const lowerPriority = {
    sourcePriority: 60,
    confidence: 99,
    observedAt: new Date("2026-04-15T13:00:00.000Z"),
  };
  assert.equal(shouldReplaceSignal(prev, lowerPriority), false);
});
