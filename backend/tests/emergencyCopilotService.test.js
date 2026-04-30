const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasMinimumLiveContext,
  decideResponseMode,
} = require("../src/services/emergencyCopilotService");

test("hasMinimumLiveContext returns false without risk, factors or source health", () => {
  const result = hasMinimumLiveContext(
    { riskStatus: { score: 0 }, sourceHealth: [] },
    { liveRiskFactors: [] },
  );
  assert.equal(result, false);
});

test("hasMinimumLiveContext returns true when factors exist", () => {
  const result = hasMinimumLiveContext(
    { riskStatus: { score: 0 }, sourceHealth: [] },
    { liveRiskFactors: [{ id: "factor-1" }] },
  );
  assert.equal(result, true);
});

test("decideResponseMode enforces rules_only for critical/escalated", () => {
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
      escalateNow: true,
      hasGuides: true,
      hasLiveContext: true,
    }),
    "rules_only",
  );
});

test("decideResponseMode allows hybrid_llm only with guides and live context", () => {
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
  assert.equal(
    decideResponseMode({
      triageLevel: "medium",
      escalateNow: false,
      hasGuides: false,
      hasLiveContext: true,
    }),
    "fallback",
  );
});
