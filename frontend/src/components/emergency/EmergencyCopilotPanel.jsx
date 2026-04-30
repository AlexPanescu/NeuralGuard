import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../../api/client";
import useMediaQuery from "../../hooks/useMediaQuery";
import { useLanguage } from "../../i18n/LanguageContext";

const MAP_LOCATION_LOCAL_KEY = "mapSavedLocation";

function readSavedCommunicationLocation() {
  try {
    const raw = localStorage.getItem(MAP_LOCATION_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.coordinates?.lat);
    const lon = Number(parsed?.coordinates?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      accuracy: Number.isFinite(Number(parsed?.accuracy)) ? Number(parsed.accuracy) : null,
      timestamp: parsed?.timestamp || null,
    };
  } catch {
    return null;
  }
}

function EmergencyCopilotPanel({ className = "", compact = false }) {
  const { t, language } = useLanguage();
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiRuntime, setAiRuntime] = useState(null);
  const [aiLocation, setAiLocation] = useState(() => readSavedCommunicationLocation());
  const aiMessagesEndRef = useRef(null);
  const isMobileLayout = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  useEffect(() => {
    // Isolate session context per selected UI language.
    setAiMessages([]);
    setAiError("");
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    const syncLocation = () => {
      if (!cancelled) {
        setAiLocation(readSavedCommunicationLocation());
      }
    };

    const loadRuntime = async () => {
      try {
        const response = await apiClient.get("/api/emergency/copilot/meta");
        if (!cancelled) {
          setAiRuntime(response?.data?.runtime || null);
        }
      } catch {
        if (!cancelled) {
          setAiRuntime(null);
        }
      }
    };

    syncLocation();
    loadRuntime();

    window.addEventListener("storage", syncLocation);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", syncLocation);
    };
  }, []);

  const sendAiMessage = useCallback(async (quickText) => {
    const text = String(quickText || aiInput || "").trim();
    if (!text || aiBusy) return;

    const userEntry = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      triageLevel: null,
      scenarioId: "",
      intent: "",
      responseMode: "user",
      isEmergency: false,
    };
    const nextHistory = [...aiMessages, userEntry];

    setAiMessages(nextHistory);
    setAiInput("");
    setAiBusy(true);
    setAiError("");

    try {
      const response = await apiClient.post("/api/emergency/copilot/chat", {
        message: text,
        language: language === "en" ? "en" : "ro",
        history: nextHistory.map((entry) => ({
          role: entry.role,
          content: entry.text,
        })),
        location: aiLocation,
      });

      const payload = response?.data?.response || {};
      const assistantEntry = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: String(payload.answer || "").trim() || t("aiCopilot.fallbackAnswer"),
        triageLevel: payload.triageLevel || null,
        scenarioId: payload.scenarioId || "",
        intent: payload.intent || "",
        responseMode: payload.responseMode || "",
        isEmergency: Boolean(payload.isEmergency),
        escalateNow: Boolean(payload.escalateNow),
        askNext: payload.askNext || "",
      };

      setAiMessages((current) => [...current, assistantEntry]);
      setAiRuntime(response?.data?.runtime || null);
    } catch (error) {
      const message =
        error?.response?.data?.error
        || t("aiCopilot.error");
      setAiError(message);
      setAiMessages((current) => [...current, {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: message,
        triageLevel: "high",
        scenarioId: "system_fallback",
        intent: "system_error",
        responseMode: "fallback",
        isEmergency: false,
        escalateNow: false,
        askNext: "",
      }]);
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiInput, aiLocation, aiMessages, language, t]);

  return (
    <div className={`comm-card ai-card ${compact ? "ai-card-standalone" : ""} ${className}`.trim()} data-tutorial="communication-ai">
      <div className="card-header ai-header">
        <div>
          <h2>{t("aiCopilot.title")}</h2>
          <p className="channel-sub">
            {t("aiCopilot.description")}
          </p>
        </div>
        <span className={`ai-status-pill ${aiBusy ? "is-busy" : "is-ready"}`}>
          {aiBusy ? t("aiCopilot.states.analyzing") : t("aiCopilot.states.ready")}
        </span>
      </div>

      <div className="ai-meta-row">
        <span className="ai-meta-pill">
          {aiRuntime?.provider ? t("aiCopilot.meta.provider", { provider: aiRuntime.provider }) : t("aiCopilot.meta.localProvider")}
        </span>
        <span className="ai-meta-pill">
          {aiRuntime?.model ? t("aiCopilot.meta.model", { model: aiRuntime.model }) : t("aiCopilot.meta.unknownModel")}
        </span>
        <span className="ai-meta-pill">
          {aiLocation ? t("aiCopilot.meta.locationAvailable") : t("aiCopilot.meta.noLocation")}
        </span>
      </div>

      <div className="ai-list">
        {aiMessages.length === 0 ? (
          <div className="ai-empty">
            {t("aiCopilot.empty", {
              example1: t("aiCopilot.examples.fire"),
              example2: t("aiCopilot.examples.breathing"),
              example3: t("aiCopilot.examples.earthquake"),
            })}
          </div>
        ) : (
          aiMessages.map((message) => (
            <div
              key={message.id}
              className={`ai-message ${message.role === "assistant" ? "is-assistant" : "is-user"} ${message.triageLevel === "critical" || message.escalateNow ? "is-critical" : ""}`}
            >
              <div className="ai-message-meta">
                <span className="ai-author">
                  {message.role === "assistant" ? t("aiCopilot.title") : t("aiCopilot.authorYou")}
                </span>
                {message.role === "assistant" && message.triageLevel ? (
                  <span className={`ai-badge ai-badge-${message.triageLevel}`}>
                    {message.triageLevel}
                  </span>
                ) : null}
                {message.role === "assistant" && message.intent ? (
                  <span className="ai-badge ai-badge-intent">{message.intent}</span>
                ) : null}
              </div>
              <p className="ai-text">{message.text}</p>
              {message.askNext ? (
                <p className="ai-follow-up">{message.askNext}</p>
              ) : null}
            </div>
          ))
        )}
        <div ref={aiMessagesEndRef} />
      </div>

      {aiError ? <p className="ai-error">{aiError}</p> : null}

      <div className={`chat-input ai-input ${isMobileLayout ? "mobile-sticky-bar" : ""}`}>
        <input
          type="text"
          placeholder={t("aiCopilot.placeholder")}
          value={aiInput}
          onChange={(event) => setAiInput(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && sendAiMessage()}
          disabled={aiBusy}
        />
        <button type="button" onClick={() => sendAiMessage()} disabled={aiBusy || !aiInput.trim()}>
          {t("common.actions.send")}
        </button>
      </div>
    </div>
  );
}

export default EmergencyCopilotPanel;
