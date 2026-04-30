import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useLanguage } from "../../i18n/LanguageContext";
import "../../styles/layout/Sidebar.css";

function SidebarIcon({ name }) {
  switch (name) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="8" height="16" rx="3" />
          <rect x="13" y="4" width="8" height="16" rx="3" />
        </svg>
      );
    case "assets":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4 4 8l8 4 8-4-8-4Z" />
          <path d="M4 12l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 16l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "map":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 19 4 17V5l5 2 6-2 5 2v12l-5-2-6 2Z" />
          <path d="M9 7v12M15 5v12" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "communication":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v6A3.5 3.5 0 0 1 15.5 16H11l-4.5 4v-4H8.5A3.5 3.5 0 0 1 5 12.5v-6Z" />
          <path d="M8.5 9.5h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8.5 12.5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "education":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6 12 3l9 3-9 3-9-3Z" />
          <path d="M6 9.5v5.2c0 .6.3 1.1.8 1.4 1.6.9 3.3 1.4 5.2 1.4 1.8 0 3.6-.5 5.2-1.4.5-.3.8-.8.8-1.4V9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "guide":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4h9a3 3 0 0 1 3 3v11a1 1 0 0 1-1.5.9L12 17l-4.5 2.9A1 1 0 0 1 6 19V4Z" />
          <path d="M9 8h6M9 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "safety":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 4 6v6c0 4.4 3 7.9 8 9 5-1.1 8-4.6 8-9V6l-8-3Z" />
          <path d="M9.5 12.5 11.5 14.5 15 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "incident":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 3.5 18h17L12 3Z" />
          <path d="M12 9v4.5m0 2h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "sos":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
          <path d="M12 8v4m0 4h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M8 12h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "providers":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="5" rx="2" />
          <rect x="3" y="14" width="18" height="5" rx="2" />
          <circle cx="8" cy="7.5" r="1" fill="#0b1020" />
          <circle cx="8" cy="16.5" r="1" fill="#0b1020" />
        </svg>
      );
    case "calculator":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="8" r="3.5" />
          <circle cx="16.5" cy="7.5" r="2.5" />
          <rect x="4" y="13" width="8" height="7" rx="2" />
          <rect x="13.5" y="11.5" width="7" height="8.5" rx="2" />
        </svg>
      );
    case "data-api":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4 4 8v8l8 4 8-4V8l-8-4Z" />
          <path
            d="M14 10h5m0 0-2.5-2.5M19 10l-2.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "liquid":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="4" />
          <path
            d="M8 13c.7-1 1.3-1 2 0s1.3 1 2 0 1.3-1 2 0 1.3 1 2 0"
            fill="none"
            stroke="#0b1020"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      );
    case "network":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <path d="M8.5 8.2 10.8 14M15.5 8.2 13.2 14M9 6h6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "products":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path
            d="M8 11h8M8 15h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5H11l-4.5 4v-4H8.5A3.5 3.5 0 0 1 5 12.5v-6Z" />
          <circle cx="9" cy="9.5" r="1" fill="#0b1020" />
          <circle cx="12" cy="9.5" r="1" fill="#0b1020" />
          <circle cx="15" cy="9.5" r="1" fill="#0b1020" />
        </svg>
      );
    case "wishlist":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20s-7-4.4-7-9.2C5 8 6.6 6.5 8.6 6.5c1.4 0 2.7.7 3.4 1.8.7-1.1 2-1.8 3.4-1.8 2 0 3.6 1.5 3.6 4.3C19 15.6 12 20 12 20Z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="6.5" rx="7.5" ry="3.2" />
          <path d="M4.5 6.5v4c0 1.8 3.4 3.2 7.5 3.2s7.5-1.5 7.5-3.2v-4" />
          <path d="M4.5 10.5v4c0 1.8 3.4 3.2 7.5 3.2s7.5-1.5 7.5-3.2v-4" />
        </svg>
      );
  }
}

function Sidebar() {
  /** @type {{ isCollapsed: boolean, onToggleCollapse: () => void }} */
  const props = arguments[0];
  const { isCollapsed, onToggleCollapse } = props;
  const { t } = useLanguage();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSidebarAnimationEnabled, setIsSidebarAnimationEnabled] = useState(() => {
    const stored = localStorage.getItem("sidebarAnimationEnabled");
    return stored !== "false";
  });
  const menuItems = [
    { label: t("nav.routes.dashboard"), path: "/dashboard", icon: "dashboard", featured: true },
    { label: t("nav.routes.map"), path: "/map", icon: "map" },
    { label: t("nav.routes.communication"), path: "/communication", icon: "communication" },
    { label: t("nav.routes.guide"), path: "/guide", icon: "guide" },
    { label: t("nav.routes.safety"), path: "/safety", icon: "communication" },
    { label: t("nav.routes.sos"), path: "/sos", icon: "sos", featured: true },
    { label: t("nav.routes.profileSettings"), path: "/profile-settings", icon: "profile" },
  ];

  useEffect(() => {
    let isMounted = true;

    const handleConnectivity = () => {
      if (isMounted) setIsOnline(navigator.onLine);
    };

    const loadSidebarSetting = () => {
      try {
        const stored = localStorage.getItem("sidebarAnimationEnabled");
        if (isMounted) setIsSidebarAnimationEnabled(stored !== "false");
      } catch {
        if (isMounted) setIsSidebarAnimationEnabled(true);
      }
    };

    handleConnectivity();
    loadSidebarSetting();

    window.addEventListener("online", handleConnectivity);
    window.addEventListener("offline", handleConnectivity);
    window.addEventListener("storage", loadSidebarSetting);
    window.addEventListener("sidebarAnimationToggle", loadSidebarSetting);

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleConnectivity);
      window.removeEventListener("offline", handleConnectivity);
      window.removeEventListener("storage", loadSidebarSetting);
      window.removeEventListener("sidebarAnimationToggle", loadSidebarSetting);
    };
  }, []);

  return (
    <div
      className={`sidebar ${isCollapsed ? "collapsed" : ""} ${
        !isSidebarAnimationEnabled ? "sidebar-anim-off" : ""
      }`}
    >
      <div className="sidebar-header">
        <button
          className="logo-icon-btn clickable"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <span className="logo-icon" aria-hidden="true" />
        </button>

        <h1 className="app-title">NeuralGuard</h1>
      </div>

      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  isActive
                    ? `nav-link ${item.featured ? "featured" : ""} active`
                    : `nav-link ${item.featured ? "featured" : ""}`
                }
              >
                <span className="icon">
                  <SidebarIcon name={item.icon} />
                </span>
                <span className="text">{item.label}</span>
                {item.external && !isCollapsed && <span className="link-out">{"\u2197"}</span>}
                {item.badge && !isCollapsed && (
                  <span className={`nav-badge ${item.badge === "Beta" ? "beta" : ""}`}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {!isCollapsed && (
        <div className="sidebar-footer">
          <div className="sidebar-footer-line">
            <span
              className={`sidebar-health-dot ${isOnline ? "online" : "offline"}`}
              aria-hidden="true"
            />
            <span>{isOnline ? t("common.states.online") : t("common.states.offline")}</span>
          </div>
          <div className="sidebar-footer-meta">
            <small>{t("nav.drawer.liveSync")}</small>
            <small>{t("dashboard.hero.updated")}</small>
          </div>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
