import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { useCrisisMode } from "../context/CrisisModeContext";
import { useLanguage } from "../i18n/LanguageContext";
import { getRealtimeSocket } from "../lib/realtimeSocket";
import { getBestSOSLocation } from "../utils/locationFallback";
import "../styles/pages/SOSEmergencyPage.css";

const SOS_EMERGENCY_STORAGE_KEY = "sosEmergencyData";

const buildDefaultEmergencyContacts = (t) => [
  { id: 1, name: t("sos.contacts.ambulance"), number: "112", type: "emergency", icon: "Amb" },
  { id: 2, name: t("sos.contacts.police"), number: "112", type: "emergency", icon: "Pol" },
  { id: 3, name: t("sos.contacts.firefighters"), number: "112", type: "emergency", icon: "Pom" },
];

const normalizeAlertId = (value) => String(value || "");

const alertFingerprint = (alert) => {
  const type = String(alert?.type || "").trim().toLowerCase();
  const message = String(alert?.message || "").trim().toLowerCase();
  const rawTime = alert?.timestamp || alert?.createdAt || "";
  const timestamp = rawTime ? new Date(rawTime).getTime() : Number.NaN;
  if (!type || !message || Number.isNaN(timestamp)) return "";
  return `${type}:${message}:${Math.round(timestamp / 2000)}`;
};

const dedupeAlerts = (alerts) => {
  const seen = new Set();
  const seenFingerprints = new Set();
  const result = [];
  for (const raw of Array.isArray(alerts) ? alerts : []) {
    const id = normalizeAlertId(raw?.id || raw?.alertId);
    const fingerprint = alertFingerprint(raw);
    if ((id && seen.has(id)) || (fingerprint && seenFingerprints.has(fingerprint))) continue;
    if (id) seen.add(id);
    if (fingerprint) seenFingerprints.add(fingerprint);
    result.push({ ...raw, id: id || fingerprint });
  }
  return result;
};

const upsertAlert = (alerts, nextAlert) => {
  const incomingId = normalizeAlertId(nextAlert?.id || nextAlert?.alertId);
  const incomingFingerprint = alertFingerprint(nextAlert);
  if (!incomingId && !incomingFingerprint) return dedupeAlerts(alerts).slice(0, 10);
  const normalizedNext = { ...nextAlert, id: incomingId || incomingFingerprint };
  const filtered = dedupeAlerts(alerts).filter((entry) => {
    const entryId = normalizeAlertId(entry.id || entry.alertId);
    const entryFingerprint = alertFingerprint(entry);
    return entryId !== incomingId && (!incomingFingerprint || entryFingerprint !== incomingFingerprint);
  });
  return [normalizedNext, ...filtered].slice(0, 10);
};

const formatAlertStatus = (status) =>
  String(status || "active").replaceAll("_", " ").toUpperCase();

const formatLocationTime = (location, locale, t) => {
  const raw = location?.timestamp || location?.updatedAt || "";
  if (!raw) return t("sos.states.staleLocation");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return t("sos.states.staleLocation");
  return t("sos.labels.lastLocation", { time: date.toLocaleString(locale) });
};

const getSosLocationLabel = (locationState, t) => {
  const location = locationState?.location;
  if (!location) return t("sos.states.unavailableLocation");
  if (location.resolvedFrom === "browser_gps") return t("sos.labels.gpsLive");
  if (location.resolvedFrom === "account_location") {
    return t("sos.labels.accountLocation", { label: location.label || t("sos.states.savedLocation") });
  }
  return t("sos.labels.mapLocation", { label: location.label || t("sos.states.savedLocation") });
};

const SOSEmergencyPage = () => {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const { isOffline, isOfflineReady } = useCrisisMode();
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(3);
  const [emergencyContacts, setEmergencyContacts] = useState(() => buildDefaultEmergencyContacts(t));
  const [familyAlerts, setFamilyAlerts] = useState([]);
  const [location, setLocation] = useState(null);
  const [sosLocationState, setSosLocationState] = useState({ location: null, warning: "" });
  const [isSending, setIsSending] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [linkedIncident, setLinkedIncident] = useState(null);
  const [activeAlert, setActiveAlert] = useState(null);
  const [activeAlertId, setActiveAlertId] = useState("");
  const [sosDeliveryState, setSosDeliveryState] = useState("idle");
  const [copilotSessionId, setCopilotSessionId] = useState("");
  const [copilotMessages, setCopilotMessages] = useState([]);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const countdownRef = useRef(null);
  const locationWatchRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = getRealtimeSocket();
    socketRef.current = socket;

    const handleSosAlert = (alertData) => {
      const normalized = {
        id: normalizeAlertId(alertData.alertId || alertData.id),
        type: alertData.type || "SOS",
        message: alertData.message,
        location: alertData.location,
        timestamp: alertData.timestamp,
        status: alertData.status || "active",
        incidentId: alertData.incidentId || null,
      };
      setFamilyAlerts((current) => upsertAlert(current, normalized));
      setActiveAlert((current) =>
        current && normalizeAlertId(current.id || current._id) === normalizeAlertId(normalized.id)
          ? { ...current, ...normalized }
          : current,
      );
    };

    const handleSosLocationUpdate = (data) => {
      const nextLocation = data.lastKnownLocation || data.location;
      setFamilyAlerts((current) =>
        current.map((alert) =>
          normalizeAlertId(alert.id) === normalizeAlertId(data.alertId)
            ? { ...alert, location: nextLocation, lastKnownLocation: nextLocation }
            : alert,
        ),
      );
      setActiveAlert((current) =>
        current && normalizeAlertId(current.id || current._id) === normalizeAlertId(data.alertId)
          ? { ...current, lastKnownLocation: nextLocation, location: nextLocation, status: data.status || current.status }
          : current,
      );
    };

    const handleFamilyAlert = (alertData) => {
      setFamilyAlerts((current) => upsertAlert(current, alertData));
    };

    const handleSosResolved = (payload) => {
      const resolvedId = normalizeAlertId(payload?.alertId);
      if (!resolvedId) return;
      setFamilyAlerts((current) =>
        current.map((alert) =>
          normalizeAlertId(alert.id) === resolvedId
            ? { ...alert, status: payload?.status || "resolved" }
            : alert,
        ),
      );
      setActiveAlertId((current) => (normalizeAlertId(current) === resolvedId ? "" : current));
      setActiveAlert((current) =>
        current && normalizeAlertId(current.id || current._id) === resolvedId
          ? { ...current, status: payload?.status || "resolved", resolvedAt: payload?.resolvedAt }
          : current,
      );
    };

    const handleSosUpdated = (payload) => {
      const updated = payload?.alert || payload;
      const updatedId = normalizeAlertId(updated?.id || updated?._id || payload?.alertId);
      if (!updatedId) return;
      setFamilyAlerts((current) =>
        current.map((alert) =>
          normalizeAlertId(alert.id || alert._id) === updatedId
            ? { ...alert, ...updated, id: updatedId }
            : alert,
        ),
      );
      setActiveAlert((current) =>
        current && normalizeAlertId(current.id || current._id) === updatedId
          ? { ...current, ...updated, id: updatedId }
          : current,
      );
    };

    socket.on("sos-alert", handleSosAlert);
    socket.on("sos-location-update", handleSosLocationUpdate);
    socket.on("family-alert", handleFamilyAlert);
    socket.on("sos-alert-resolved", handleSosResolved);
    socket.on("sos-alert-updated", handleSosUpdated);

    window.sosSocket = socket;
    return () => {
      if (locationWatchRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      socket.off("sos-alert", handleSosAlert);
      socket.off("sos-location-update", handleSosLocationUpdate);
      socket.off("family-alert", handleFamilyAlert);
      socket.off("sos-alert-resolved", handleSosResolved);
      socket.off("sos-alert-updated", handleSosUpdated);
      socketRef.current = null;
      delete window.sosSocket;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SOS_EMERGENCY_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed.contacts) setEmergencyContacts(parsed.contacts);
      if (parsed.alerts) setFamilyAlerts(dedupeAlerts(parsed.alerts).slice(0, 10));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SOS_EMERGENCY_STORAGE_KEY,
        JSON.stringify({ contacts: emergencyContacts, alerts: familyAlerts }),
      );
    } catch {
      // ignore
    }
  }, [emergencyContacts, familyAlerts]);

  const startLocationTracking = (alertId) => {
    if (!navigator.geolocation) return;
    if (locationWatchRef.current != null) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: "gps",
          resolvedFrom: "browser_gps",
          label: "GPS live",
          timestamp: new Date().toISOString(),
        };
        setLocation(nextLocation);
        void apiClient
          .patch(`/api/sos/alert/${alertId}/location`, { location: nextLocation })
          .catch(() => {
            socketRef.current?.emit("sos-location-update", {
              alertId,
              location: nextLocation,
            });
          });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    locationWatchRef.current = watchId;
    window.sosLocationWatch = watchId;
  };

  const confirmSOS = async () => {
    setShowConfirmModal(false);
    setSosActive(true);
    setSosCountdown(3);
    setSosDeliveryState("idle");
    countdownRef.current = setInterval(() => {
      setSosCountdown((current) => {
        if (current <= 1) {
          clearInterval(countdownRef.current);
          void sendSOSAlert();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const cancelSOS = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    setSosActive(false);
    setSosCountdown(3);
    setShowConfirmModal(false);
    setSosDeliveryState("idle");
  };

  const sendSOSAlert = async () => {
    setIsSending(true);
    try {
      const resolvedLocation = await getBestSOSLocation({ timeoutMs: 3000 });
      const currentLocation = resolvedLocation.ok ? resolvedLocation.location : null;
      setLocation(currentLocation);
      setSosLocationState({
        location: currentLocation,
        warning: resolvedLocation.warning || "",
        reason: resolvedLocation.reason || resolvedLocation.fallbackReason || "",
      });

      const alertData = {
        type: "SOS",
        message: alertMessage || t("sos.messages.defaultAlert"),
        location: currentLocation,
        contacts: emergencyContacts
          .filter((contact) => contact.type === "family")
          .map((contact) => ({
            name: contact.name,
            phone: contact.number,
            relationship: contact.relationship || "family",
            notifyMethod: contact.notifyMethod || "",
          })),
        contactsNotified: emergencyContacts
          .filter((contact) => contact.type === "family")
          .map((contact) => contact.name),
      };

      if (isOffline || isOfflineReady) {
        setActiveAlert(null);
        setActiveAlertId("");
        setSosDeliveryState("failed");
        setAlertMessage(
          resolvedLocation.warning || t("sos.messages.liveRequiresConnection"),
        );
        if (navigator.vibrate) {
          navigator.vibrate([500, 200, 500]);
        }
        return;
      }

      const response = await apiClient.post("/api/sos/alert", alertData);
      const createdAlert = response.data?.alert || {};
      const createdAlertId = normalizeAlertId(createdAlert?._id || createdAlert?.id);
      const nextAlert = {
        id: createdAlertId || `sos-${Date.now()}`,
        type: "SOS",
        message: alertData.message,
        location: createdAlert.lastKnownLocation || currentLocation,
        lastKnownLocation: createdAlert.lastKnownLocation || currentLocation,
        timestamp: createdAlert?.createdAt || new Date().toISOString(),
        status: createdAlert.status || "active",
        incidentId: response.data?.incident?.id || response.data?.incident?._id || null,
      };

      setFamilyAlerts((current) => upsertAlert(current, nextAlert));
      setActiveAlert({ ...createdAlert, ...nextAlert, contacts: createdAlert.contacts || [] });
      setLinkedIncident(response.data?.incident || null);
      setActiveAlertId(nextAlert.id);
      const nextCopilotSessionId = String(response.data?.copilotSessionId || "").trim();
      setCopilotSessionId(nextCopilotSessionId);
      const initialRecommendation = String(response.data?.initialRecommendation || "").trim();
      const initialChecklist = Array.isArray(response.data?.initialActionChecklist)
        ? response.data.initialActionChecklist
        : [];
      if (initialRecommendation) {
        const checklistText = initialChecklist.length
          ? `\n\nChecklist initial:\n- ${initialChecklist
              .map((entry) => String(entry.title || "").trim())
              .filter(Boolean)
              .join("\n- ")}`
          : "";
        setCopilotMessages([
          {
            role: "assistant",
            text: `${initialRecommendation}${checklistText}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        setCopilotMessages([]);
      }
      setCopilotError("");
      setSosDeliveryState("live");
      setAlertMessage(t("sos.messages.sentAndConverted"));

      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }

      startLocationTracking(nextAlert.id);
    } catch (error) {
      setSosDeliveryState("failed");
      setAlertMessage(error.response?.data?.error || t("sos.messages.sendError"));
    } finally {
      setIsSending(false);
    }
  };

  const stopSOS = async () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    if (locationWatchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
      window.sosLocationWatch = null;
    }
    if (activeAlertId) {
      try {
        const response = await apiClient.patch(`/api/sos/alert/${activeAlertId}/resolve`, {
          status: "resolved",
          notes: t("sos.messages.stoppedNote"),
        });
        setFamilyAlerts((current) =>
          current.map((alert) =>
            normalizeAlertId(alert.id) === normalizeAlertId(activeAlertId)
              ? { ...alert, status: "resolved" }
              : alert,
          ),
        );
        setActiveAlert(response.data?.alert || null);
        setLinkedIncident(null);
      } catch {
        setAlertMessage(t("sos.messages.localStopped"));
      }
    }
    setSosActive(false);
    setSosCountdown(3);
    setActiveAlertId("");
    setCopilotSessionId("");
    setCopilotMessages([]);
    setCopilotInput("");
    setCopilotError("");
    setSosDeliveryState("idle");
  };

  const sendCopilotMessage = async () => {
    const message = String(copilotInput || "").trim();
    if (!message || !copilotSessionId || copilotBusy) return;
    setCopilotBusy(true);
    setCopilotError("");
    setCopilotMessages((current) => [
      ...current,
      { role: "user", text: message, createdAt: new Date().toISOString() },
    ]);
    setCopilotInput("");
    try {
      const response = await apiClient.post(`/api/emergency/copilot/sessions/${copilotSessionId}/messages`, {
        message,
        location,
      });
      const answer = String(response.data?.response?.answer || "").trim();
      const askNext = String(response.data?.response?.askNext || "").trim();
      const checklist = Array.isArray(response.data?.response?.actionChecklist)
        ? response.data.response.actionChecklist
        : [];
      const escalateNow = Boolean(response.data?.response?.escalateNow);
      const checklistText = checklist.length
        ? `\n\nChecklist:\n- ${checklist
            .map((entry) => String(entry.title || "").trim())
            .filter(Boolean)
            .join("\n- ")}`
        : "";
      const escalationText = escalateNow ? `\n\n${t("sos.messages.immediateAction")}` : "";
      const followUpText = askNext ? `\n\n${t("sos.messages.nextQuestion", { question: askNext })}` : "";
      setCopilotMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `${answer}${escalationText}${checklistText}${followUpText}`.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      setCopilotError(error?.response?.data?.error || t("sos.messages.copilotError"));
    } finally {
      setCopilotBusy(false);
    }
  };

  const removeEmergencyContact = (contactId) => {
    setEmergencyContacts((current) => current.filter((contact) => contact.id !== contactId));
  };

  const sendTestAlert = async () => {
    const testAlert = {
      id: `test-${Date.now()}`,
      type: "TEST",
      message: t("sos.messages.testAlert"),
      location,
      timestamp: new Date().toISOString(),
      status: "test",
    };
    try {
      await apiClient.post("/api/family/alert", testAlert);
      setFamilyAlerts((current) => upsertAlert(current, testAlert));
    } catch {
      // ignore
    }
  };

  const visibleFamilyAlerts = dedupeAlerts(familyAlerts).slice(0, 5);

  return (
    <section className="page-shell sos-emergency-page mobile-shell">
      <header className="sos-header mobile-card mobile-section-head">
        <div>
          <h1>{t("sos.labels.title")}</h1>
          <p>{t("sos.labels.subtitle")}</p>
        </div>
        <div className="sos-status">
          {sosActive ? (
            <span className="status-badge active">
              <span className="pulse" />
              {t("sos.states.active")}
            </span>
          ) : (
            <span className="status-badge inactive">{t("sos.states.standby")}</span>
          )}
        </div>
      </header>

      <div className={`sos-local-status ${isOffline || isOfflineReady ? "is-offline" : "is-live"}`}>
        <strong>{isOffline || isOfflineReady ? t("sos.states.localEmergency") : t("sos.states.liveAvailable")}</strong>
        <span>
          {isOffline || isOfflineReady
            ? t("sos.messages.liveRequiresConnection")
            : t("sos.messages.localContacts")}
        </span>
      </div>

      <div className={`sos-location-status ${sosLocationState.location ? "has-location" : "is-missing"}`}>
        <strong>{getSosLocationLabel(sosLocationState, t)}</strong>
        {sosLocationState.warning ? <span>{sosLocationState.warning}</span> : null}
      </div>

      <div className="sos-main-section">
        <div className={`sos-button-container ${sosActive ? "active" : ""}`} data-tutorial="sos-trigger">
          {sosActive ? (
            <div className="sos-active-display">
              <div className="sos-countdown-ring">
                <div className="sos-countdown-text">{sosCountdown > 0 ? sosCountdown : "SOS"}</div>
              </div>
              <p className="sos-active-message">
                {sosCountdown > 0
                  ? t("sos.states.sending")
                  : sosDeliveryState === "failed"
                      ? t("sos.states.liveFailed")
                      : t("sos.states.sent")}
              </p>
              {sosCountdown === 0 && (
                <button className="stop-sos-btn" onClick={() => void stopSOS()}>
                  {t("sos.actions.stop")}
                </button>
              )}
            </div>
          ) : (
            <button className="sos-big-button" onClick={() => setShowConfirmModal(true)}>
              <span className="sos-text">SOS</span>
              <span className="sos-subtext">{t("sos.actions.pressForEmergency")}</span>
            </button>
          )}
        </div>

        {!sosActive && (
          <div className="sos-message-input" data-tutorial="sos-message">
            <label htmlFor="sos-message">{t("sos.labels.messageLabel")}</label>
            <textarea
              id="sos-message"
              value={alertMessage}
              onChange={(event) => setAlertMessage(event.target.value)}
              placeholder={t("sos.labels.messagePlaceholder")}
              rows={3}
              disabled={isSending}
            />
          </div>
        )}
      </div>

      {activeAlert && (
        <div className="sos-section sos-lifecycle-panel">
          <div className="sos-section-header">
            <h2>{t("sos.labels.activeSos")}</h2>
            <span className={`status-badge ${activeAlert.status === "resolved" ? "inactive" : "active"}`}>
              {formatAlertStatus(activeAlert.status)}
            </span>
          </div>
          <div className="sos-lifecycle-grid">
            <div>
              <span className="sos-lifecycle-label">{t("sos.labels.location")}</span>
              <strong>{formatLocationTime(activeAlert.lastKnownLocation || activeAlert.location, locale, t)}</strong>
            </div>
            <div>
              <span className="sos-lifecycle-label">{t("sos.labels.incident")}</span>
              <strong>{activeAlert.incidentId || linkedIncident?.id || linkedIncident?._id || t("sos.labels.pendingIncident")}</strong>
            </div>
          </div>
          <div className="sos-contact-status-list">
            {(activeAlert.contacts || []).map((contact, index) => (
              <div key={`${contact.name || "contact"}-${index}`} className="sos-contact-status-row">
                <span>{contact.name || contact.phone || "Contact"}</span>
                <strong>{String(contact.notifiedStatus || "not_available").replaceAll("_", " ")}</strong>
                {contact.error ? <small>{contact.error}</small> : null}
              </div>
            ))}
            {!(activeAlert.contacts || []).length && (
              <p className="no-alerts">{t("sos.states.noExternalContacts")}</p>
            )}
          </div>
        </div>
      )}

      {linkedIncident && (
        <div className="sos-section">
          <div className="sos-section-header">
            <h2>{t("sos.labels.autoIncident")}</h2>
            <button className="test-alert-btn" onClick={() => navigate(`/incidents/${linkedIncident.id || linkedIncident._id}`)}>
              {t("sos.actions.openIncident")}
            </button>
          </div>
          <p className="alert-message">{linkedIncident.title}</p>
        </div>
      )}

      {copilotSessionId && (
        <div className="sos-section">
          <div className="sos-section-header">
            <h2>{t("sos.labels.emergencyCopilot")}</h2>
            <span className="status-badge active">LIVE</span>
          </div>
          <div className="family-alerts-list">
            {copilotMessages.map((entry, index) => (
              <div key={`${entry.role}-${index}-${entry.createdAt || ""}`} className="family-alert-item">
                <span className="alert-icon">{entry.role === "assistant" ? "AI" : t("sos.labels.you")}</span>
                <div className="alert-content">
                  <span className="alert-text" style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
                  <span className="alert-meta">
                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString(locale) : ""}
                  </span>
                </div>
              </div>
            ))}
            {!copilotMessages.length && <p className="no-alerts">{t("sos.states.copilotLoading")}</p>}
          </div>
          <div className="sos-message-input" style={{ marginTop: "0.75rem" }}>
            <label htmlFor="copilot-message">{t("sos.labels.askCopilot")}</label>
            <textarea
              id="copilot-message"
              value={copilotInput}
              onChange={(event) => setCopilotInput(event.target.value)}
              placeholder={t("sos.labels.copilotPlaceholder")}
              rows={3}
              disabled={copilotBusy}
            />
            <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
              <button className="confirm-btn" onClick={() => void sendCopilotMessage()} disabled={copilotBusy || !copilotInput.trim()}>
                {copilotBusy ? t("sos.states.processing") : t("common.actions.send")}
              </button>
            </div>
            {copilotError ? <p className="no-alerts">{copilotError}</p> : null}
          </div>
        </div>
      )}

      <div className="sos-section" data-tutorial="sos-contacts">
        <div className="sos-section-header">
          <h2>{t("sos.labels.emergencyContacts")}</h2>
          <button className="add-contact-btn" onClick={() => navigate("/profile-settings")}>
            {t("sos.actions.manageProfile")}
          </button>
        </div>
        <div className="emergency-contacts-grid">
          {emergencyContacts.map((contact) => (
            <div key={contact.id} className={`contact-card ${contact.type}`}>
              <span className="contact-icon">{contact.icon}</span>
              <div className="contact-info">
                <span className="contact-name">{contact.name}</span>
                <span className="contact-number">{contact.number}</span>
              </div>
              <a href={`tel:${contact.number}`} className="call-btn" title={t("sos.actions.callContact", { name: contact.name })}>
                {t("sos.actions.call")}
              </a>
              {contact.type === "family" && (
                <button className="remove-contact-btn" onClick={() => removeEmergencyContact(contact.id)} title={t("sos.actions.removeContact")}>
                  X
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sos-section" data-tutorial="sos-alerts">
        <div className="sos-section-header">
          <h2>{t("sos.labels.familyAlerts")}</h2>
          <button className="test-alert-btn" onClick={sendTestAlert}>
            {t("sos.actions.sendTest")}
          </button>
        </div>
        <div className="family-alerts-list">
          {visibleFamilyAlerts.map((alert) => (
            <div key={alert.id} className="family-alert-item">
              <span className="alert-icon">{alert.type}</span>
              <div className="alert-content">
                <span className="alert-text">{alert.message}</span>
                <span className="alert-meta">
                  {alert.timestamp ? new Date(alert.timestamp).toLocaleString(locale) : ""}
                </span>
              </div>
            </div>
          ))}
          {!visibleFamilyAlerts.length && <p className="no-alerts">{t("sos.states.noRecentAlerts")}</p>}
        </div>
      </div>

      {showConfirmModal && (
        <div className="modal-overlay" onClick={cancelSOS}>
          <div className="sos-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{t("sos.confirm.title")}</h3>
            <p>{t("sos.confirm.body")}</p>
            <p className="modal-warning">{t("sos.confirm.warning")}</p>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={cancelSOS}>
                {t("common.actions.cancel")}
              </button>
              <button className="confirm-btn" onClick={confirmSOS}>
                {t("sos.actions.confirmSend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default SOSEmergencyPage;
