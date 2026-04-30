const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const mongoose = require("mongoose");
const EmergencyCopilotSession = require("../../models/EmergencyCopilotSession");

const BEHAVIOR_CONFIG_PATH = path.join(
  __dirname,
  "../../data/ai/emergency-copilot-behavior.json",
);
const OLLAMA_HOST = process.env.EMERGENCY_COPILOT_OLLAMA_HOST || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.EMERGENCY_COPILOT_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen3:14b";
const OLLAMA_TIMEOUT_MS = Math.max(
  2000,
  Number.parseInt(process.env.EMERGENCY_COPILOT_OLLAMA_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || "12000", 10) || 12000,
);

let behaviorConfigCache = null;
function isRoutingDebugEnabled() {
  return process.env.NODE_ENV !== "production"
    || String(process.env.EMERGENCY_COPILOT_DEBUG_ROUTING || "").trim() === "1";
}
const CONTEXT_BOOST_MAX_TURNS = 6;
const CONTEXT_BOOST_MAX_AGE_MS = 20 * 60 * 1000;
const CONTEXT_BOOST_SCORE = 3;
const CLEAR_SCENARIO_SCORE = 5;
const CLEAR_SCENARIO_MARGIN = 2;

function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(value) {
  return stripDiacritics(value).toLowerCase().trim();
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
}

function readBehaviorConfig() {
  if (behaviorConfigCache) return behaviorConfigCache;
  const raw = fs.readFileSync(BEHAVIOR_CONFIG_PATH, "utf8").replace(/^\uFEFF/, "");
  behaviorConfigCache = JSON.parse(raw);
  return behaviorConfigCache;
}

function getScenarioCatalog() {
  const config = readBehaviorConfig();
  return Array.isArray(config.scenarios) ? config.scenarios : [];
}

function getScenarioById(scenarioId) {
  const safeScenarioId = String(scenarioId || "").trim();
  return getScenarioCatalog().find((scenario) => scenario.id === safeScenarioId) || null;
}

function getPlaybookCatalog() {
  const config = readBehaviorConfig();
  return Array.isArray(config.playbooks) ? config.playbooks : [];
}

function getPlaybookById(playbookId) {
  const safePlaybookId = String(playbookId || "").trim();
  return getPlaybookCatalog().find((playbook) => playbook.id === safePlaybookId) || null;
}

function getSeverityProfile(level = "medium") {
  const config = readBehaviorConfig();
  return config?.severityProfiles?.[String(level || "medium").toLowerCase()] || config?.severityProfiles?.medium || {};
}

function getLocalizedContent(row, language = "ro") {
  if (!row?.localized) return null;
  const lang = language === "en" ? "en" : "ro";
  return row.localized[lang] || row.localized.ro || null;
}

function getTrainingExamplesForScenario(scenarioId, intent = null, limit = 4) {
  const config = readBehaviorConfig();
  const items = Array.isArray(config.trainingExamples) ? config.trainingExamples : [];
  return items
    .filter((entry) => entry.scenarioId === scenarioId && (!intent || entry.intent === intent))
    .slice(0, limit);
}

function buildSearchCorpus(message = "", incident = null) {
  return [
    String(message || ""),
    String(incident?.title || ""),
    String(incident?.summary || ""),
    String(incident?.type || ""),
  ].join(" ");
}

function getScenarioInstructions(scenario, language = "ro") {
  const lang = language === "en" ? "en" : "ro";
  const playbook = getPlaybookById(scenario?.playbookRef || "");
  const localizedPlaybook = getLocalizedContent(playbook, lang);
  const localizedBehavior = scenario?.behavior?.[lang] || scenario?.behavior?.ro || null;
  const immediateSteps = Array.isArray(localizedPlaybook?.immediateSteps)
    ? localizedPlaybook.immediateSteps
    : Array.isArray(localizedBehavior?.steps)
      ? localizedBehavior.steps
      : [];
  const followUpQuestions = Array.isArray(localizedPlaybook?.followUpQuestions)
    ? localizedPlaybook.followUpQuestions
    : localizedBehavior?.askNext
      ? [localizedBehavior.askNext]
      : [];

  return {
    summary: String(localizedPlaybook?.summary || localizedBehavior?.summary || "").trim(),
    immediateSteps,
    donts: Array.isArray(localizedPlaybook?.donts) ? localizedPlaybook.donts : [],
    followUpQuestions,
    call112Triggers: Array.isArray(localizedPlaybook?.call112Triggers) ? localizedPlaybook.call112Triggers : [],
    category: playbook?.category || scenario?.category || "",
  };
}

function getScenarioTerms(scenario) {
  return {
    keywords: uniqueStrings(scenario?.keywords),
    synonyms: uniqueStrings(scenario?.synonyms),
    misspellings: uniqueStrings(scenario?.misspellings),
    colloquial: uniqueStrings(scenario?.colloquial),
    routingHints: uniqueStrings(scenario?.routingHints),
  };
}

function detectLanguage(message, sessionLanguage = "ro", history = []) {
  const text = normalize(message);
  if (/(english|speak english|in english)/.test(text)) return "en";
  if (/(romana|romaneste|in romana|romanian)/.test(text)) return "ro";

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entryText = normalize(history[index]?.content || history[index]?.text || "");
    if (/(english|speak english|in english)/.test(entryText)) return "en";
    if (/(romana|romaneste|in romana|romanian)/.test(entryText)) return "ro";
  }

  return sessionLanguage || "ro";
}

function normalizeCopilotLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "en") return "en";
  if (normalized === "ro") return "ro";
  return "";
}

function countKeywordHits(text, keywords = []) {
  const haystack = normalize(text);
  if (!haystack) return 0;
  return keywords.reduce((total, keyword) => (
    haystack.includes(normalize(keyword)) ? total + 1 : total
  ), 0);
}

function tokenizeNormalizedText(text) {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isShortFollowUpMessage(text = "") {
  const tokens = tokenizeNormalizedText(text);
  return tokens.length > 0 && tokens.length <= 3 && normalize(text).length <= 28;
}

function hasHighSignalEmergencyTokens(text = "") {
  const normalized = normalize(text);
  return [
    "fire",
    "smoke",
    "choking",
    "bleeding",
    "intruder",
    "not breathing",
    "cant breathe",
    "cannot breathe",
  ].some((item) => normalized.includes(item));
}

function isLikelyFullNewMessage(text = "") {
  const tokens = tokenizeNormalizedText(text);
  return tokens.length >= 5;
}

function getContextScenarioFromHistory(history = []) {
  const now = Date.now();
  let seen = 0;
  for (let index = history.length - 1; index >= 0 && seen < CONTEXT_BOOST_MAX_TURNS; index -= 1) {
    const entry = history[index] || {};
    seen += 1;
    const scenarioId = String(
      entry.scenarioId
      || entry.meta?.scenarioId
      || entry.routing?.scenarioId
      || "",
    ).trim();
    if (!scenarioId) continue;
    const scenario = getScenarioById(scenarioId);
    if (!scenario || !scenario.isEmergency) continue;

    const atValue = entry.at || entry.createdAt || entry.timestamp || null;
    const atMs = atValue ? Date.parse(atValue) : NaN;
    if (Number.isFinite(atMs) && now - atMs > CONTEXT_BOOST_MAX_AGE_MS) {
      return null;
    }
    return {
      scenarioId,
      turnsBack: seen,
      ageMs: Number.isFinite(atMs) ? Math.max(0, now - atMs) : null,
    };
  }
  return null;
}

function withScenarioTieBreak(scoredScenarios = []) {
  return [...scoredScenarios].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aPriority = a.scenario?.isEmergency ? 1 : 0;
    const bPriority = b.scenario?.isEmergency ? 1 : 0;
    if (bPriority !== aPriority) return bPriority - aPriority;
    return String(a.scenario?.id || "").localeCompare(String(b.scenario?.id || ""));
  });
}

function getTopEmergencyAndNonEmergency(scoredScenarios = []) {
  const topEmergency = scoredScenarios.find((entry) => entry.scenario?.isEmergency) || null;
  const topNonEmergency = scoredScenarios.find((entry) => !entry.scenario?.isEmergency) || null;
  return { topEmergency, topNonEmergency };
}

function fallbackAliasScenario(message = "") {
  const text = normalize(message);
  const aliases = [
    { patterns: ["fire", "smoke"], scenarioId: "fire_home" },
    { patterns: ["not breathing", "cant breathe", "cannot breathe", "choking"], scenarioId: "respiratory_distress" },
    { patterns: ["bleeding"], scenarioId: "severe_bleeding" },
    { patterns: ["intruder"], scenarioId: "home_intruder" },
  ];
  const hit = aliases.find((entry) => entry.patterns.some((pattern) => text.includes(pattern)));
  return hit ? getScenarioById(hit.scenarioId) : null;
}

function hasInformationalNonEmergencyIndicators(message = "") {
  const text = normalize(message);
  return [
    "account",
    "password",
    "login",
    "in the news",
    "news article",
    "how does this work",
  ].some((item) => text.includes(item));
}

function scoreScenarioMatch(scenario, text, incidentType = "") {
  const terms = getScenarioTerms(scenario);
  let score = 0;
  score += countKeywordHits(text, terms.keywords) * 6;
  score += countKeywordHits(text, terms.synonyms) * 5;
  score += countKeywordHits(text, terms.colloquial) * 4;
  score += countKeywordHits(text, terms.misspellings) * 3;
  score += countKeywordHits(text, terms.routingHints) * 2;

  const normalizedIncidentType = normalize(incidentType);
  if (
    normalizedIncidentType
    && terms.routingHints.some((item) => normalizedIncidentType.includes(normalize(item)))
  ) {
    score += 2;
  }

  return score;
}

function shouldPreferNonEmergency({ nonEmergencyScore, topEmergencyScore, normalizedText }) {
  const looksQuestionLike = normalizedText.includes("?")
    || normalizedText.startsWith("cum ")
    || normalizedText.startsWith("ce ")
    || normalizedText.startsWith("care ");
  return nonEmergencyScore > 0 && looksQuestionLike && nonEmergencyScore >= topEmergencyScore;
}

function inferEscalation({ scenario, triageLevel, corpus }) {
  if (!scenario) return false;
  if (scenario.defaultEscalateNow) return true;

  const triageProfile = getSeverityProfile(triageLevel);
  if (triageProfile?.call112Default) return true;

  const instructions = getScenarioInstructions(scenario, "ro");
  return instructions.call112Triggers.some((item) => normalize(corpus).includes(normalize(item)));
}

function resolveScenario({
  message = "",
  incident = null,
  history = [],
}) {
  const config = readBehaviorConfig();
  const incidentType = normalize(incident?.type || "");
  const text = buildSearchCorpus(message, incident);
  const normalizedText = normalize(text);
  const diagnostics = {
    topMatchedScenarioId: "",
    topScore: 0,
    contextBoostApplied: false,
    contextBoostScenarioId: "",
    fallbackReason: "",
    topScored: [],
  };

  const triageMatch = (Array.isArray(config.triageRules) ? config.triageRules : [])
    .map((rule) => ({
      rule,
      score: countKeywordHits(text, rule.keywords || []),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (triageMatch) {
    const scenario = getScenarioById(triageMatch.rule.scenarioId) || getScenarioById("general_emergency");
    const triageLevel = triageMatch.rule.triageLevel || scenario?.defaultTriage || "medium";
    diagnostics.topMatchedScenarioId = scenario?.id || "";
    diagnostics.topScore = triageMatch.score || 0;
    diagnostics.fallbackReason = "triage_rule_match";
    return {
      scenario,
      triageLevel,
      escalateNow: Boolean(triageMatch.rule.escalateNow) || inferEscalation({ scenario, triageLevel, corpus: text }),
      matchedRuleId: triageMatch.rule.id || "",
      ...(isRoutingDebugEnabled() ? { routingDiagnostics: diagnostics } : {}),
    };
  }

  const baseScoredScenarios = withScenarioTieBreak(getScenarioCatalog()
    .map((scenario) => ({
      scenario,
      score: scoreScenarioMatch(scenario, text, incidentType),
    }))
  );
  diagnostics.topScored = baseScoredScenarios.slice(0, 3).map((entry) => ({
    scenarioId: entry.scenario?.id || "",
    score: entry.score,
  }));

  let scoredScenarios = baseScoredScenarios;
  const baseTop = baseScoredScenarios[0] || null;
  const followUpEligible =
    isShortFollowUpMessage(message) && (hasHighSignalEmergencyTokens(message) || normalize(message).length <= 10);
  const context = followUpEligible && !isLikelyFullNewMessage(message)
    ? getContextScenarioFromHistory(history)
    : null;
  if (context?.scenarioId) {
    const boosted = baseScoredScenarios.map((entry) => ({
      ...entry,
      score: entry.scenario?.id === context.scenarioId ? entry.score + CONTEXT_BOOST_SCORE : entry.score,
    }));
    const boostedSorted = withScenarioTieBreak(boosted);
    const boostedTop = boostedSorted[0] || null;
    const baseSecond = baseScoredScenarios[1] || null;
    const clearNewScenario =
      baseTop?.scenario
      && baseTop.scenario.id !== context.scenarioId
      && baseTop.score >= CLEAR_SCENARIO_SCORE
      && (baseTop.score - (baseSecond?.score || 0)) >= CLEAR_SCENARIO_MARGIN;
    if (!clearNewScenario && boostedTop?.score > 0) {
      scoredScenarios = boostedSorted;
      diagnostics.contextBoostApplied = true;
      diagnostics.contextBoostScenarioId = context.scenarioId;
    }
  }

  const aliasScenario = fallbackAliasScenario(message);
  if (aliasScenario) {
    scoredScenarios = withScenarioTieBreak(scoredScenarios.map((entry) => ({
      ...entry,
      score: entry.scenario?.id === aliasScenario.id ? Math.max(entry.score, CLEAR_SCENARIO_SCORE + 2) : entry.score,
    })));
  }

  const topOverall = scoredScenarios[0] || null;
  const { topEmergency, topNonEmergency } = getTopEmergencyAndNonEmergency(scoredScenarios);
  diagnostics.topMatchedScenarioId = topOverall?.scenario?.id || "";
  diagnostics.topScore = topOverall?.score || 0;

  if (
    topNonEmergency?.scenario
    && shouldPreferNonEmergency({
      nonEmergencyScore: topNonEmergency.score,
      topEmergencyScore: topEmergency?.score || 0,
      normalizedText,
    })
  ) {
    const triageLevel = topNonEmergency.scenario.defaultTriage || "low";
    return {
      scenario: topNonEmergency.scenario,
      triageLevel,
      escalateNow: false,
      matchedRuleId: "",
      ...(isRoutingDebugEnabled() ? { routingDiagnostics: { ...diagnostics, fallbackReason: "prefer_non_emergency" } } : {}),
    };
  }

  if (
    hasInformationalNonEmergencyIndicators(message)
    && !(topEmergency?.score > 0 && topEmergency.score >= CLEAR_SCENARIO_SCORE)
  ) {
    const infoScenario = getScenarioById("non_emergency_general") || topNonEmergency?.scenario;
    const triageLevel = infoScenario?.defaultTriage || "low";
    return {
      scenario: infoScenario,
      triageLevel,
      escalateNow: false,
      matchedRuleId: "",
      ...(isRoutingDebugEnabled()
        ? { routingDiagnostics: { ...diagnostics, topMatchedScenarioId: infoScenario?.id || "", fallbackReason: "informational_non_emergency" } }
        : {}),
    };
  }

  if (topOverall?.scenario && topOverall.score > 0) {
    const triageLevel = topOverall.scenario.defaultTriage || "medium";
    return {
      scenario: topOverall.scenario,
      triageLevel,
      escalateNow: inferEscalation({ scenario: topOverall.scenario, triageLevel, corpus: text }),
      matchedRuleId: "",
      ...(isRoutingDebugEnabled() ? { routingDiagnostics: { ...diagnostics, fallbackReason: "best_score_match" } } : {}),
    };
  }

  const nonEmergencyHintCount = (config?.routingHints?.nonEmergencyIndicators || [])
    .reduce((total, item) => (normalizedText.includes(normalize(item)) ? total + 1 : total), 0);

  const fallbackScenario = nonEmergencyHintCount > 0
    ? getScenarioById("non_emergency_general")
    : getScenarioById("general_emergency");
  const triageLevel = fallbackScenario?.defaultTriage || "medium";

  return {
    scenario: fallbackScenario,
    triageLevel,
    escalateNow: inferEscalation({ scenario: fallbackScenario, triageLevel, corpus: text }),
    matchedRuleId: "",
    ...(isRoutingDebugEnabled()
      ? {
        routingDiagnostics: {
          ...diagnostics,
          topMatchedScenarioId: fallbackScenario?.id || "",
          fallbackReason: nonEmergencyHintCount > 0 ? "non_emergency_hint_fallback" : "generic_emergency_fallback",
        },
      }
      : {}),
  };
}

function triageFromText(text, incident = null) {
  return resolveScenario({ message: text, incident }).triageLevel;
}

function shouldEscalateNow({ triageLevel, text, incident = null }) {
  const resolved = resolveScenario({ message: text, incident });
  if (resolved.escalateNow) return true;
  return String(triageLevel || "").toLowerCase() === "critical";
}

function flattenGuides(guideIndex = []) {
  const rows = [];
  for (const category of guideIndex || []) {
    for (const situation of category.situations || []) {
      for (const guide of situation.subcategories || []) {
        rows.push({
          id: `${category.category}:${situation.name}:${guide.title}`,
          category: category.category,
          situation: situation.name,
          title: guide.title,
          incidentTypes: Array.isArray(guide.incidentTypes) ? guide.incidentTypes : [],
          tags: Array.isArray(guide.tags) ? guide.tags : [],
          pdf: guide.pdf || "",
        });
      }
    }
  }
  return rows;
}

function findRelevantGuides({
  guideIndex = [],
  scenario = null,
  incident = null,
  message = "",
}) {
  const text = `${normalize(message)} ${normalize(incident?.title)} ${normalize(incident?.summary)} ${normalize(incident?.type)}`;
  const scenarioHints = [
    scenario?.id,
    scenario?.label,
    getScenarioInstructions(scenario, "ro").category,
  ].filter(Boolean).map((item) => normalize(item));

  return flattenGuides(guideIndex)
    .map((guide) => {
      let score = 0;
      const guideNeedles = [
        normalize(guide.category),
        normalize(guide.situation),
        normalize(guide.title),
        ...guide.tags.map((item) => normalize(item)),
        ...guide.incidentTypes.map((item) => normalize(item)),
      ];

      score += scenarioHints.filter((item) => guideNeedles.some((needle) => needle.includes(item))).length * 2;
      score += guideNeedles.filter((needle) => needle && text.includes(needle)).length;
      return { ...guide, score };
    })
    .filter((guide) => guide.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function hasMinimumLiveContext(riskPayload = null, situationPayload = null) {
  const riskScore = Number(riskPayload?.riskStatus?.score || 0);
  const hasFactors =
    Array.isArray(situationPayload?.liveRiskFactors) && situationPayload.liveRiskFactors.length > 0;
  const hasSourceHealth =
    Array.isArray(riskPayload?.sourceHealth) && riskPayload.sourceHealth.length > 0;
  return riskScore > 0 || hasFactors || hasSourceHealth;
}

function decideResponseMode({
  triageLevel = "medium",
  escalateNow = false,
  hasGuides = false,
  hasLiveContext = false,
  isEmergency = true,
}) {
  if (!isEmergency) return "model_allowed";
  if (triageLevel === "critical" || escalateNow) return "rules_only";
  if (hasGuides && hasLiveContext) return "hybrid_llm";
  if (hasGuides) return "retrieval_only";
  return "fallback";
}

function buildChecklistFromScenario(scenario, language = "ro") {
  const instructions = getScenarioInstructions(scenario, language);
  return instructions.immediateSteps.map((step) => ({
    id: step.id,
    title: step.title,
    detail: step.detail,
    priority: step.priority || "medium",
    status: "todo",
  }));
}

function buildSafetyFlags({
  triageLevel,
  escalateNow,
  hasGuides,
  scenarioId,
  hasLocation,
}) {
  const flags = [];
  if (String(triageLevel || "").toLowerCase() === "critical") flags.push("life_threatening_signal");
  if (escalateNow) flags.push("requires_112_now");
  if (!hasGuides) flags.push("limited_guide_context");
  if (!hasLocation) flags.push("location_missing");
  if (scenarioId) flags.push(`scenario_${scenarioId}`);
  return flags;
}

function countQuestionMarks(text) {
  return (String(text || "").match(/\?/g) || []).length;
}

function containsForbiddenContent(text, language = "ro", scenario = null) {
  const config = readBehaviorConfig();
  const localizedForbidden = config?.forbiddenContent?.[language === "en" ? "en" : "ro"] || [];
  const scenarioForbidden = Array.isArray(scenario?.forbiddenContent) ? scenario.forbiddenContent : [];
  const haystack = normalize(text);
  return [...localizedForbidden, ...scenarioForbidden].some((item) => haystack.includes(normalize(item)));
}

function buildEmergencyResponseText({
  language = "ro",
  scenario,
  escalateNow = false,
  hasLocation = false,
  userMessage = "",
}) {
  const config = readBehaviorConfig();
  const lang = language === "en" ? "en" : "ro";
  const instructions = getScenarioInstructions(
    scenario || getScenarioById("general_emergency"),
    lang,
  );
  const lines = [];
  const panicSignals = Array.isArray(config?.routingHints?.panicSignals) ? config.routingHints.panicSignals : [];
  const normalizedMessage = normalize(userMessage);
  const userLooksPanicked = panicSignals.some((item) => normalizedMessage.includes(normalize(item)));

  if (userLooksPanicked && config?.globalRules?.panicDeescalation?.[lang]) {
    lines.push(config.globalRules.panicDeescalation[lang]);
  }

  if (escalateNow) {
    lines.push(config.globalRules.call112[lang]);
  }

  if (instructions.summary) {
    lines.push(instructions.summary);
  }

  instructions.immediateSteps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title}. ${step.detail}`);
  });

  const donts = instructions.donts.slice(0, 3);
  if (donts.length) {
    lines.push(
      lang === "en"
        ? `Do not: ${donts.join("; ")}`
        : `Nu face asta: ${donts.join("; ")}`,
    );
  }

  lines.push(
    hasLocation
      ? config.globalRules.locationUsefulNote[lang]
      : config.globalRules.locationMissingNote[lang],
  );

  return lines.filter(Boolean).join("\n");
}

function buildAskNext({
  scenario,
  language = "ro",
}) {
  const config = readBehaviorConfig();
  const lang = language === "en" ? "en" : "ro";
  const instructions = getScenarioInstructions(scenario, lang);
  const question = String(
    instructions.followUpQuestions?.[0] || config.globalRules.fallbackQuestion[lang] || "",
  ).trim();
  if (!question) return "";
  return countQuestionMarks(question) > 1 ? question.replace(/\?+/g, "?") : question;
}

function resolveReasoningBasis({ scenario, hasGuides, llmUsed, intent = "" }) {
  const basis = [
    "emergency-copilot-json-kb",
    `scenario_router:${scenario?.id || "general_emergency"}`,
    `intent:${intent || (scenario?.isEmergency ? "real_emergency" : "general_question")}`,
  ];
  if (hasGuides) basis.push("guide_retrieval");
  if (llmUsed) basis.push("ollama_generation");
  return basis;
}

function parseJsonResponse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(OLLAMA_HOST);
    } catch (error) {
      reject(new Error("Invalid OLLAMA_HOST"));
      return;
    }

    const data = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.15,
        num_predict: 220,
      },
    });

    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: "/api/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Ollama error ${response.statusCode}`));
            return;
          }
          const parsed = parseJsonResponse(body);
          if (!parsed || typeof parsed.response !== "string") {
            reject(new Error("Invalid Ollama response"));
            return;
          }
          resolve(parsed.response.trim());
        });
      },
    );

    request.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      request.destroy(new Error("Ollama request timeout"));
    });
    request.on("error", (error) => reject(error));
    request.write(data);
    request.end();
  });
}

function buildEmergencyRewritePrompt({
  scenario,
  language,
  baseAnswer,
  userMessage,
  escalateNow,
}) {
  const config = readBehaviorConfig();
  const lang = language === "en" ? "en" : "ro";
  const examples = getTrainingExamplesForScenario(scenario?.id, "real_emergency", 3);
  const forbidden = [
    ...(config.forbiddenContent?.[lang] || []),
    ...(Array.isArray(scenario?.forbiddenContent) ? scenario.forbiddenContent : []),
  ];

  return [
    "You are Emergency Copilot.",
    "This is an emergency response rewrite task, not open-ended chatting.",
    "Keep the answer calm, direct, short, practical and scenario-specific.",
    "Preserve all life-saving steps and any 112 escalation.",
    "Do not introduce news, risk scores, geopolitics, dashboard context or nearby incident summaries.",
    "Do not ask a question in the answer body.",
    `Language: ${lang}`,
    `Scenario: ${scenario?.id || "general_emergency"}`,
    `Escalate now: ${escalateNow ? "YES" : "NO"}`,
    `User message: ${String(userMessage || "").trim()}`,
    `Distinct behavior: ${scenario?.expectedBehavior?.distinctLogic || ""}`,
    `Forbidden content: ${forbidden.join(", ")}`,
    examples.length
      ? `Few-shot examples:\n${examples.map((entry) => `User: ${entry.input}\nIdeal: ${entry.idealOutput}`).join("\n\n")}`
      : "",
    `Draft answer:\n${baseAnswer}`,
    "Return plain text only.",
  ].filter(Boolean).join("\n\n");
}

function buildNonEmergencyPrompt({
  scenario,
  language,
  userMessage,
  history = [],
}) {
  const config = readBehaviorConfig();
  const lang = language === "en" ? "en" : "ro";
  const examples = getTrainingExamplesForScenario(scenario?.id, "general_question", 2);
  const historyLines = history
    .slice(-4)
    .map((item) => `${item.role || "user"}: ${String(item.content || item.text || "").trim()}`)
    .filter(Boolean);

  return [
    "You are Emergency Copilot in non-emergency communication mode.",
    config?.nonEmergencyHandling?.systemPromptIntent || "",
    `Language: ${lang}`,
    `Allowed topics: ${(config?.nonEmergencyHandling?.allowedTopics || []).join(", ")}`,
    "Stay concise, practical and aligned with the emergency knowledge base.",
    "If the message becomes urgent, say so clearly and pivot to emergency advice.",
    examples.length
      ? `Few-shot examples:\n${examples.map((entry) => `User: ${entry.input}\nIdeal: ${entry.idealOutput}`).join("\n\n")}`
      : "",
    historyLines.length ? `Recent history:\n${historyLines.join("\n")}` : "",
    `User message: ${String(userMessage || "").trim()}`,
    "Return plain text only.",
  ].filter(Boolean).join("\n\n");
}

async function maybeRefineEmergencyResponseWithLlm({
  responseMode,
  scenario,
  language,
  baseAnswer,
  userMessage,
  escalateNow,
}) {
  if (responseMode !== "hybrid_llm") {
    return {
      answer: baseAnswer,
      llmUsed: false,
      provider: "deterministic",
      model: "json-kb-router",
    };
  }

  try {
    const candidate = await callOllama(
      buildEmergencyRewritePrompt({
        scenario,
        language,
        baseAnswer,
        userMessage,
        escalateNow,
      }),
    );
    if (!candidate) {
      return {
        answer: baseAnswer,
        llmUsed: false,
        provider: "deterministic",
        model: "json-kb-router",
      };
    }
    if (containsForbiddenContent(candidate, language, scenario)) {
      return {
        answer: baseAnswer,
        llmUsed: false,
        provider: "deterministic",
        model: "json-kb-router",
      };
    }
    if (countQuestionMarks(candidate) > 0) {
      return {
        answer: baseAnswer,
        llmUsed: false,
        provider: "deterministic",
        model: "json-kb-router",
      };
    }
    if (escalateNow && !normalize(candidate).includes("112")) {
      return {
        answer: baseAnswer,
        llmUsed: false,
        provider: "deterministic",
        model: "json-kb-router",
      };
    }
    return {
      answer: candidate,
      llmUsed: true,
      provider: "ollama",
      model: OLLAMA_MODEL,
    };
  } catch {
    return {
      answer: baseAnswer,
      llmUsed: false,
      provider: "deterministic",
      model: "json-kb-router",
    };
  }
}

async function answerNonEmergencyWithLlm({
  scenario,
  language,
  userMessage,
  history = [],
}) {
  const config = readBehaviorConfig();
  const lang = language === "en" ? "en" : "ro";
  const fallback =
    config?.nonEmergencyHandling?.fallbackResponse?.[lang]
    || config?.nonEmergencyHandling?.fallbackResponse?.ro
    || "";

  try {
    const candidate = await callOllama(
      buildNonEmergencyPrompt({
        scenario,
        language,
        userMessage,
        history,
      }),
    );
    if (!candidate) {
      throw new Error("Empty candidate");
    }
    if (containsForbiddenContent(candidate, language, scenario)) {
      throw new Error("Forbidden content");
    }
    return {
      answer: candidate,
      llmUsed: true,
      provider: "ollama",
      model: OLLAMA_MODEL,
    };
  } catch {
    return {
      answer: fallback,
      llmUsed: false,
      provider: "deterministic",
      model: "json-kb-router",
    };
  }
}

function classifyCommunicationIntent({ message = "", incident = null, history = [] }) {
  const resolved = resolveScenario({ message, incident, history });
  const scenario = resolved.scenario || getScenarioById("general_emergency");
  const payload = {
    intent: scenario.isEmergency ? "real_emergency" : "general_question",
    scenario,
    triageLevel: resolved.triageLevel,
    escalateNow: resolved.escalateNow,
    matchedRuleId: resolved.matchedRuleId,
  };
  if (isRoutingDebugEnabled() && resolved.routingDiagnostics) {
    payload.routingDiagnostics = resolved.routingDiagnostics;
  }
  return payload;
}

function withOperationalInclusionGuidance(answer, operationalInclusionSummary = null, language = "ro") {
  const summary = String(operationalInclusionSummary?.summary || "").trim();
  if (!summary) return answer;
  if (language === "en") {
    return `${answer}\n\nOperational accessibility note: ${summary}. Adapt communication and evacuation help to these needs without sharing extra private details.`;
  }
  return `${answer}\n\nNota operationala accesibilitate: ${summary}. Adapteaza comunicarea si evacuarea la aceste nevoi, fara a distribui alte detalii private.`;
}

async function buildAssistantResponse({
  language = "ro",
  incident = null,
  userMessage = "",
  guideIndex = [],
  riskPayload = null,
  situationPayload = null,
  userLocation = null,
  operationalInclusionSummary = null,
  history = [],
}) {
  const classified = classifyCommunicationIntent({
    message: userMessage,
    incident,
    history,
  });
  const scenario = classified.scenario || getScenarioById("general_emergency");
  const guides = findRelevantGuides({
    guideIndex,
    scenario,
    incident,
    message: userMessage,
  });
  const hasLocation = Boolean(
    userLocation?.lat != null
    || userLocation?.lon != null
    || userLocation?.coordinates?.lat != null
    || userLocation?.coordinates?.lon != null,
  );
  const plannedMode = decideResponseMode({
    triageLevel: classified.triageLevel,
    escalateNow: classified.escalateNow,
    hasGuides: guides.length > 0,
    hasLiveContext: hasMinimumLiveContext(riskPayload, situationPayload),
    isEmergency: true,
  });
  const baseAnswer = withOperationalInclusionGuidance(buildEmergencyResponseText({
    language,
    scenario,
    escalateNow: classified.escalateNow,
    hasLocation,
    userMessage,
  }), operationalInclusionSummary, language);
  const llmResult = await maybeRefineEmergencyResponseWithLlm({
    responseMode: plannedMode,
    scenario,
    language,
    baseAnswer,
    userMessage,
    escalateNow: classified.escalateNow,
  });
  const deliveredMode = llmResult.llmUsed
    ? "hybrid_llm"
    : guides.length > 0
      ? "retrieval_only"
      : "rules_only";

  const actionChecklist = buildChecklistFromScenario(scenario, language);
  const sources = [
    { type: "policy", id: scenario.id, label: scenario.label || scenario.id },
    ...guides.map((guide) => ({ type: "guide", id: guide.id, label: guide.title })),
  ];
  const safetyFlags = buildSafetyFlags({
    triageLevel: classified.triageLevel,
    escalateNow: classified.escalateNow,
    hasGuides: guides.length > 0,
    scenarioId: scenario.id,
    hasLocation,
  });

  const payload = {
    answer: llmResult.answer,
    askNext: buildAskNext({ scenario, language }),
    actionChecklist,
    reasoningBasis: resolveReasoningBasis({
      scenario,
      hasGuides: guides.length > 0,
      llmUsed: llmResult.llmUsed,
      intent: classified.intent,
    }),
    sources,
    guideSummary: guides.map((guide) => guide.title).join(", "),
    responseMode: deliveredMode,
    triageLevel: classified.triageLevel,
    escalateNow: classified.escalateNow,
    safetyFlags,
    scenarioId: scenario.id,
    provider: llmResult.provider,
    model: llmResult.model,
    matchedRuleId: classified.matchedRuleId,
    intent: classified.intent,
    isEmergency: true,
  };
  if (isRoutingDebugEnabled() && classified.routingDiagnostics) {
    payload.routingDiagnostics = classified.routingDiagnostics;
  }
  return payload;
}

async function answerCommunicationMessage({
  message = "",
  incident = null,
  history = [],
  guideIndex = [],
  riskPayload = null,
  situationPayload = null,
  userLocation = null,
  language = "ro",
}) {
  const explicitLanguage = normalizeCopilotLanguage(language);
  const nextLanguage = explicitLanguage || detectLanguage(message, "ro", history);
  const classified = classifyCommunicationIntent({ message, incident, history });
  const scenario = classified.scenario || getScenarioById("general_emergency");

  if (classified.intent === "real_emergency") {
    return buildAssistantResponse({
      language: nextLanguage,
      incident,
      userMessage: message,
      guideIndex,
      riskPayload,
      situationPayload,
      userLocation,
      history,
    });
  }

  const llmResult = await answerNonEmergencyWithLlm({
    scenario,
    language: nextLanguage,
    userMessage: message,
    history,
  });

  const payload = {
    answer: llmResult.answer,
    askNext: "",
    actionChecklist: [],
    reasoningBasis: resolveReasoningBasis({
      scenario,
      hasGuides: false,
      llmUsed: llmResult.llmUsed,
      intent: classified.intent,
    }),
    sources: [{ type: "policy", id: scenario.id, label: scenario.label || scenario.id }],
    guideSummary: "",
    responseMode: llmResult.llmUsed ? "model_allowed" : "fallback",
    triageLevel: classified.triageLevel,
    escalateNow: false,
    safetyFlags: [`scenario_${scenario.id}`],
    scenarioId: scenario.id,
    provider: llmResult.provider,
    model: llmResult.model,
    matchedRuleId: classified.matchedRuleId,
    intent: classified.intent,
    isEmergency: false,
  };
  if (isRoutingDebugEnabled() && classified.routingDiagnostics) {
    payload.routingDiagnostics = classified.routingDiagnostics;
  }
  return payload;
}

async function createCopilotSession({
  userId = null,
  incident = null,
  sosAlert = null,
  riskPayload = null,
  situationPayload = null,
  guideIndex = [],
  language = "ro",
  userLocation = null,
  operationalInclusionSummary = null,
}) {
  const normalizedLanguage = language === "en" ? "en" : "ro";
  const effectiveLocation = userLocation || sosAlert?.location || null;
  const response = await buildAssistantResponse({
    language: normalizedLanguage,
    incident,
    userMessage: incident?.summary || incident?.title || sosAlert?.message || "",
    guideIndex,
    riskPayload,
    situationPayload,
    userLocation: effectiveLocation,
    operationalInclusionSummary,
    history: [],
  });

  const session = await EmergencyCopilotSession.create({
    userId: userId && mongoose.Types.ObjectId.isValid(String(userId)) ? userId : null,
    incidentId: incident?._id || incident?.id || null,
    sosAlertId: sosAlert?._id || sosAlert?.id || null,
    status: response.escalateNow ? "escalated" : "active",
    language: normalizedLanguage,
    responseMode: response.responseMode,
    latestTriageLevel: response.triageLevel,
    activeChecklist: response.actionChecklist,
    guideIdsUsed: response.sources.filter((item) => item.type === "guide").map((item) => item.id),
    signalIdsUsed: [],
    incidentSnapshot: incident
      ? {
          id: String(incident._id || incident.id),
          title: incident.title,
          type: incident.type,
          severity: incident.severity,
          scenarioId: response.scenarioId,
        }
      : {},
    operationalInclusionSummary,
    riskSnapshotId: riskPayload?.scoringMeta?.riskSnapshotId || null,
    modelVersion: `${response.provider}:${response.model}`,
    safetyFlags: response.safetyFlags,
    lastRecommendationAt: new Date(),
    messages: [
      {
        role: "assistant",
        text: response.answer,
        responseMode: response.responseMode,
        triageLevel: response.triageLevel,
        escalateNow: response.escalateNow,
        reasoningBasis: response.reasoningBasis,
        safetyFlags: response.safetyFlags,
        sources: response.sources,
        at: new Date(),
      },
    ],
  });

  return {
    session,
    recommendation: {
      ...response,
      sessionId: String(session._id),
    },
  };
}

async function appendCopilotMessage({
  sessionId,
  userMessage,
  incident = null,
  riskPayload = null,
  situationPayload = null,
  guideIndex = [],
  userLocation = null,
  operationalInclusionSummary = null,
  language = "",
}) {
  const session = await EmergencyCopilotSession.findById(sessionId);
  if (!session) {
    const error = new Error("Sesiunea copilot nu a fost gasita.");
    error.statusCode = 404;
    throw error;
  }

  const explicitLanguage = normalizeCopilotLanguage(language);
  const nextLanguage = explicitLanguage || detectLanguage(userMessage, session.language || "ro");
  const response = await buildAssistantResponse({
    language: nextLanguage,
    incident: incident || session.incidentSnapshot,
    userMessage,
    guideIndex,
    riskPayload,
    situationPayload,
    userLocation,
    operationalInclusionSummary: operationalInclusionSummary || session.operationalInclusionSummary || null,
    history: Array.isArray(session.messages) ? session.messages : [],
  });

  session.language = nextLanguage;
  session.status = response.escalateNow ? "escalated" : session.status === "ended" ? "active" : session.status;
  session.responseMode = response.responseMode;
  session.latestTriageLevel = response.triageLevel;
  session.safetyFlags = [...new Set([...(session.safetyFlags || []), ...response.safetyFlags])];
  session.guideIdsUsed = [
    ...new Set([
      ...(session.guideIdsUsed || []),
      ...response.sources.filter((item) => item.type === "guide").map((item) => item.id),
    ]),
  ];
  session.lastRecommendationAt = new Date();
  session.activeChecklist = response.actionChecklist;
  session.messages.push({
    role: "user",
    text: String(userMessage || "").trim().slice(0, 8000),
    responseMode: "rules_only",
    triageLevel: response.triageLevel,
    escalateNow: false,
    reasoningBasis: ["user input"],
    safetyFlags: [],
    sources: [],
    at: new Date(),
  });
  session.messages.push({
    role: "assistant",
    text: response.answer,
    responseMode: response.responseMode,
    triageLevel: response.triageLevel,
    escalateNow: response.escalateNow,
    reasoningBasis: response.reasoningBasis,
    safetyFlags: response.safetyFlags,
    sources: response.sources,
    at: new Date(),
  });
  await session.save();

  return {
    session,
    response,
  };
}

function serializeCopilotSession(sessionDoc) {
  const session = sessionDoc?.toObject ? sessionDoc.toObject() : sessionDoc;
  if (!session) return null;
  return {
    id: String(session._id),
    _id: String(session._id),
    userId: session.userId ? String(session.userId) : null,
    incidentId: session.incidentId ? String(session.incidentId) : null,
    sosAlertId: session.sosAlertId ? String(session.sosAlertId) : null,
    status: session.status,
    language: session.language,
    responseMode: session.responseMode,
    latestTriageLevel: session.latestTriageLevel,
    activeChecklist: Array.isArray(session.activeChecklist) ? session.activeChecklist : [],
    guideIdsUsed: Array.isArray(session.guideIdsUsed) ? session.guideIdsUsed : [],
    signalIdsUsed: Array.isArray(session.signalIdsUsed) ? session.signalIdsUsed : [],
    incidentSnapshot: session.incidentSnapshot || {},
    operationalInclusionSummary: session.operationalInclusionSummary || null,
    riskSnapshotId: session.riskSnapshotId ? String(session.riskSnapshotId) : null,
    modelVersion: session.modelVersion,
    safetyFlags: Array.isArray(session.safetyFlags) ? session.safetyFlags : [],
    lastRecommendationAt: session.lastRecommendationAt || null,
    endedAt: session.endedAt || null,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
    messages: Array.isArray(session.messages)
      ? session.messages.map((msg) => ({
          role: msg.role,
          text: msg.text,
          responseMode: msg.responseMode,
          triageLevel: msg.triageLevel,
          escalateNow: Boolean(msg.escalateNow),
          reasoningBasis: Array.isArray(msg.reasoningBasis) ? msg.reasoningBasis : [],
          safetyFlags: Array.isArray(msg.safetyFlags) ? msg.safetyFlags : [],
          sources: Array.isArray(msg.sources) ? msg.sources : [],
          at: msg.at || null,
        }))
      : [],
  };
}

function getEmergencyCopilotRuntimeInfo() {
  const config = readBehaviorConfig();
  return {
    provider: "json_kb_router_with_optional_ollama",
    model: OLLAMA_MODEL,
    behaviorConfigPath: BEHAVIOR_CONFIG_PATH,
    policyVersion: config?.meta?.version || "unknown",
    scenarioCount: Array.isArray(config?.scenarios) ? config.scenarios.length : 0,
    playbookCount: Array.isArray(config?.playbooks) ? config.playbooks.length : 0,
    trainingExampleCount: Array.isArray(config?.trainingExamples) ? config.trainingExamples.length : 0,
    jsonUsage:
      "Primary knowledge base and orchestration policy for emergency routing, triage, steps, forbidden content and examples.",
    llmUsage:
      "Ollama is used only for controlled non-critical generation or emergency rewrites when guardrails allow it.",
    llmAvoidedWhen:
      "Critical scenarios, explicit 112 escalation, or when the model output violates safety guardrails.",
    usesDynamicPrompts: true,
    usesRetrieval: true,
    hasScenarioRouting: true,
    currentImplementation:
      "Rules-first emergency engine powered by a large JSON knowledge base, plus optional Ollama for safe refinement and non-emergency chat.",
  };
}

module.exports = {
  hasMinimumLiveContext,
  decideResponseMode,
  detectLanguage,
  resolveScenario,
  triageFromText,
  shouldEscalateNow,
  classifyCommunicationIntent,
  buildAssistantResponse,
  answerCommunicationMessage,
  createCopilotSession,
  appendCopilotMessage,
  serializeCopilotSession,
  getEmergencyCopilotRuntimeInfo,
};
