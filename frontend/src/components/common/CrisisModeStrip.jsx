import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useCrisisMode } from "../../context/CrisisModeContext";
import {
  CRISIS_MODE_OPTIONS,
  QUEUED_CRISIS_MESSAGES_CHANGED_EVENT,
  formatSyncTime,
  getUnsentQueuedMessageCount,
} from "../../utils/crisisMode";
import { useLanguage } from "../../i18n/LanguageContext";
import "../../styles/components/CrisisModeStrip.css";

const CrisisModeStrip = () => {
  const { t, locale } = useLanguage();
  const [queuedCount, setQueuedCount] = useState(getUnsentQueuedMessageCount);
  const {
    preference,
    setPreference,
    connectionProfile,
    effectiveMode,
    isLowData,
    isOffline,
    lastSync,
  } = useCrisisMode();

  const modeLabels = {
    auto: t("app.crisisMode.modes.auto"),
    "low-data": t("app.crisisMode.modes.lowData"),
    "offline-ready": t("app.crisisMode.modes.offlineReady"),
  };
  const connectionLabel = isOffline ? t("common.states.offline") : t("common.states.online");
  const detailLabel = isLowData
    ? t("app.crisisMode.reducedVisuals")
    : connectionProfile.effectiveType !== "unknown"
      ? connectionProfile.effectiveType
      : t("app.crisisMode.standardData");

  useEffect(() => {
    const updateQueuedCount = () => setQueuedCount(getUnsentQueuedMessageCount());
    window.addEventListener("storage", updateQueuedCount);
    window.addEventListener(QUEUED_CRISIS_MESSAGES_CHANGED_EVENT, updateQueuedCount);
    return () => {
      window.removeEventListener("storage", updateQueuedCount);
      window.removeEventListener(QUEUED_CRISIS_MESSAGES_CHANGED_EVENT, updateQueuedCount);
    };
  }, []);

  return (
    <aside className="crisis-mode-strip" aria-label={t("app.crisisMode.aria")}>
      <div className="crisis-strip-status">
        <span className={`crisis-dot ${isOffline ? "is-offline" : "is-online"}`} aria-hidden="true" />
        <span>{connectionLabel}</span>
        <span className="crisis-strip-muted">{detailLabel}</span>
      </div>

      <div className="crisis-strip-meta">
        <span>{t("app.crisisMode.mode", { mode: modeLabels[effectiveMode] })}</span>
        <span>
          {t("app.crisisMode.lastSync", {
            time: formatSyncTime(
              lastSync,
              locale,
              t("app.crisisMode.noSync"),
              t("app.crisisMode.unknownSync"),
            ),
          })}
        </span>
      </div>

      <label className="crisis-strip-select">
        <span className="sr-only">{t("app.crisisMode.selectLabel")}</span>
        <select value={preference} onChange={(event) => setPreference(event.target.value)}>
          {CRISIS_MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {modeLabels[mode]}
            </option>
          ))}
        </select>
      </label>

      <nav className="crisis-strip-links" aria-label={t("app.crisisMode.shortcuts")}>
        {queuedCount > 0 ? (
          <Link className="crisis-queued-link" to="/communication">{t("app.crisisMode.queued", { count: queuedCount })}</Link>
        ) : null}
        <Link to="/map">{t("nav.routes.map")}</Link>
        <Link to="/sos">SOS</Link>
        <Link to="/guide">{t("nav.routes.guide")}</Link>
      </nav>
    </aside>
  );
};

export default CrisisModeStrip;
