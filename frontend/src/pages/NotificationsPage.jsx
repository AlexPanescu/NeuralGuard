import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/OperationsPages.css";
import "../styles/pages/NotificationsPage.css";

const buildFilters = (t) => [
  { id: "all", label: t("notifications.filters.all") },
  { id: "critical", label: t("notifications.filters.critical") },
  { id: "action", label: t("notifications.filters.action") },
];

function getNotificationTone(type) {
  const normalized = String(type || "").toLowerCase();
  if (
    [
      "critical",
      "sos",
      "incident_created",
      "incident_updated",
      "incident_deleted",
      "security",
    ].includes(normalized)
  ) {
    return "critical";
  }
  if (["warning", "assignment", "guide", "news"].includes(normalized)) {
    return "action";
  }
  if (["success", "resolved"].includes(normalized)) {
    return "success";
  }
  return "info";
}

function formatRelativeTime(value, t) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.states.now");
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return t("notifications.time.minutesAgo", { count: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return t("notifications.time.hoursAgo", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t("notifications.time.daysAgo", { count: diffDays });
}

const NotificationsPage = () => {
  const { t, locale } = useLanguage();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const filters = useMemo(() => buildFilters(t), [t]);

  useEffect(() => {
    const loadNotifications = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get("/api/notifications");
        setNotifications(Array.isArray(response.data) ? response.data : []);
      } catch {
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const normalizedNotifications = notifications
    .map((item, index) => {
      const tone = getNotificationTone(item.type);
      return {
        ...item,
        id: item.id || item._id || `notification-${index}`,
        tone,
        typeLabel: String(item.type || "info").replaceAll("_", " "),
      };
    })
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });

  const criticalCount = normalizedNotifications.filter((item) => item.tone === "critical").length;
  const actionCount = normalizedNotifications.filter((item) => item.tone === "action").length;

  const filteredNotifications = normalizedNotifications.filter((item) => {
    if (activeFilter === "critical") return item.tone === "critical";
    if (activeFilter === "action") return item.tone === "action" || item.tone === "critical";
    return true;
  });

  return (
    <section className="page-shell notifications-page mobile-shell">
      <header className="notification-card notifications-hero mobile-card mobile-section-head" data-tutorial="notifications-summary">
        <span className="mobile-kicker">{t("notifications.eyebrow")}</span>
        <h1>{t("notifications.title")}</h1>
        <p className="incident-meta">
          {t("notifications.description")}
        </p>
        <div className="notifications-kpi-grid">
          <div className="notifications-kpi">
            <span>{t("common.labels.total")}</span>
            <strong>{normalizedNotifications.length}</strong>
          </div>
          <div className="notifications-kpi critical">
            <span>{t("common.labels.critical")}</span>
            <strong>{criticalCount}</strong>
          </div>
          <div className="notifications-kpi action">
            <span>{t("notifications.labels.needsAction")}</span>
            <strong>{actionCount}</strong>
          </div>
        </div>
      </header>

      <div className="notification-card notifications-toolbar mobile-card" role="tablist" aria-label={t("notifications.aria.filters")}>
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={activeFilter === filter.id}
            className={`notifications-filter-btn ${activeFilter === filter.id ? "is-active" : ""}`}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="notification-card notification-list-card mobile-card" data-tutorial="notifications-list">
        <div className="notification-list">
          {loading ? (
            <div className="notification-item notification-item-empty">
              <strong>{t("notifications.states.loading")}</strong>
              <p className="incident-meta">{t("notifications.states.checking")}</p>
            </div>
          ) : null}

          {!loading && filteredNotifications.map((notification) => (
            <article key={notification.id} className={`notification-item tone-${notification.tone}`}>
              <div className="notification-topline">
                <strong>{notification.title}</strong>
                <span className={`pill tone-${notification.tone}`}>{notification.typeLabel}</span>
              </div>
              <p className="incident-meta">{notification.message}</p>
              <div className="incident-meta notification-time-row">
                <span className="notification-relative">{formatRelativeTime(notification.createdAt, t)}</span>
                {notification.createdAt
                  ? new Date(notification.createdAt).toLocaleString(locale)
                  : ""}
              </div>
              {notification.link && (
                <Link className="pill-btn" to={notification.link}>
                  {t("notifications.labels.open")}
                </Link>
              )}
            </article>
          ))}
          {!loading && !filteredNotifications.length && (
            <div className="notification-item notification-item-empty">
              <strong>{t("notifications.states.emptyFilter")}</strong>
              <p className="incident-meta">{t("notifications.states.emptyBody")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default NotificationsPage;
