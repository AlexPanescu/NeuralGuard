import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import apiClient from "../../api/client";
import { getRealtimeSocket } from "../../lib/realtimeSocket";
import { useLanguage } from "../../i18n/LanguageContext";
import LanguageSelector from "../common/LanguageSelector";
import NavigationCard from "./NavigationCard";
import { clearAuthSession, getAccessToken } from "../../utils/authSession";
import "../../styles/layout/MobileSidebar.css";

const NAV_ITEMS = [
  { labelKey: "nav.routes.dashboard", to: "/dashboard", icon: "dashboard", themeKey: "dashboard" },
  { labelKey: "nav.routes.map", to: "/map", icon: "map", themeKey: "map" },
  { labelKey: "nav.routes.communication", to: "/communication", icon: "communication", themeKey: "communication" },
  { labelKey: "nav.routes.guide", to: "/guide", icon: "guide", themeKey: "guide" },
  { labelKey: "nav.routes.safety", to: "/safety", icon: "communication", themeKey: "communication" },
  { labelKey: "nav.routes.sos", to: "/sos", icon: "sos", themeKey: "sos" },
  { labelKey: "nav.routes.profileSettings", to: "/profile-settings", icon: "profile", themeKey: "profile" },
];

const getNotificationIdentity = (notification) => {
  const relatedAlertId = String(notification?.relatedAlertId || "").trim();
  if (relatedAlertId) return `alert:${relatedAlertId}`;
  const relatedIncidentId = String(notification?.relatedIncidentId || "").trim();
  if (relatedIncidentId) return `incident:${relatedIncidentId}:${String(notification?.type || "")}`;
  const link = String(notification?.link || "").trim();
  const type = String(notification?.type || "info").trim();
  const title = String(notification?.title || "").trim().toLowerCase();
  const message = String(notification?.message || "").trim().toLowerCase();
  return `${type}:${link}:${title}:${message}`;
};

const mergeNotificationList = (current, nextItem) => {
  const nextId = String(nextItem.id || "");
  const nextIdentity = getNotificationIdentity(nextItem);
  const deduped = current.filter((item) => {
    const sameId = nextId && String(item.id || "") === nextId;
    const sameIdentity = getNotificationIdentity(item) === nextIdentity;
    return !sameId && !sameIdentity;
  });
  if (String(nextItem.status || "active") === "archived") {
    return deduped.slice(0, 20);
  }
  return [nextItem, ...deduped].slice(0, 20);
};

const dedupeNotificationList = (items) =>
  (Array.isArray(items) ? items : []).reduce(
    (list, item) => mergeNotificationList(list, item),
    [],
  ).reverse().slice(0, 20);

/**
 * @param {{
 *  onLoginClick?: () => void,
 *  onSignUpClick?: () => void,
 *  theme?: "light" | "dark",
 *  onToggleTheme?: (nextTheme: "light" | "dark") => void,
 *  onOpenTutorial?: () => void
 * }} props
 */
function MobileSidebar({
  onLoginClick = () => {},
  onSignUpClick = () => {},
  theme = "light",
  onToggleTheme = /** @type {(nextTheme: "light" | "dark") => void} */ (() => {}),
  onOpenTutorial = () => {},
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale } = useLanguage();
  const scrollLockSnapshotRef = useRef(
    /** @type {{ bodyOverflow: string, bodyTouchAction: string, rootOverflow: string } | null} */ (null),
  );
  const drawerTouchStartXRef = useRef(0);
  const drawerTouchStartYRef = useRef(0);
  const edgeSwipeStartXRef = useRef(0);
  const edgeSwipeStartYRef = useRef(0);
  const edgeSwipeArmedRef = useRef(false);
  const layerRef = useRef(null);
  const triggerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem("currentUser");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const closeDrawer = useCallback(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      layerRef.current instanceof HTMLElement &&
      layerRef.current.contains(activeElement)
    ) {
      activeElement.blur();
      triggerRef.current?.focus?.({ preventScroll: true });
    }
    setIsOpen(false);
    setMenuOpen(false);
    setNotifOpen(false);
  }, []);

  const openDrawer = useCallback(() => {
    setIsOpen(true);
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const response = await apiClient.get("/api/notifications", {
        params: { limit: 20 },
      });
      setNotifications(dedupeNotificationList(response?.data));
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleConnectivity = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", handleConnectivity);
    window.addEventListener("offline", handleConnectivity);
    return () => {
      window.removeEventListener("online", handleConnectivity);
      window.removeEventListener("offline", handleConnectivity);
    };
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const handleNotification = (payload) => {
      if (!payload || typeof payload !== "object") return;
      setNotifications((current) => {
        const nextItem = {
          id: payload.id || `notif-${Date.now()}`,
          title: typeof payload.title === "string" ? payload.title : "Notification",
          message: typeof payload.message === "string" ? payload.message : "",
          type: typeof payload.type === "string" ? payload.type : "info",
          link: typeof payload.link === "string" ? payload.link : "",
          relatedAlertId: payload.relatedAlertId || null,
          relatedIncidentId: payload.relatedIncidentId || null,
          status: typeof payload.status === "string" ? payload.status : "active",
          createdAt: payload.createdAt || new Date().toISOString(),
        };
        return mergeNotificationList(current, nextItem);
      });
    };

    socket.on("notification:new", handleNotification);
    return () => {
      socket.off("notification:new", handleNotification);
    };
  }, []);

  useEffect(() => {
    if (notifOpen) {
      loadNotifications();
    }
  }, [loadNotifications, notifOpen]);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const stored = localStorage.getItem("currentUser");
        const parsed = stored ? JSON.parse(stored) : null;
        setCurrentUser(parsed);
        const token = getAccessToken();
        if (!token) return;

        const response = await apiClient.get("/api/me");

        const freshUser = response?.data?.user;
        if (freshUser && typeof freshUser === "object") {
          localStorage.setItem("currentUser", JSON.stringify(freshUser));
          setCurrentUser(freshUser);
        }
      } catch {
        try {
          const stored = localStorage.getItem("currentUser");
          setCurrentUser(stored ? JSON.parse(stored) : null);
        } catch {
          setCurrentUser(null);
        }
      }
    };

    loadCurrentUser();
    window.addEventListener("storage", loadCurrentUser);
    window.addEventListener("loginSuccess", loadCurrentUser);
    window.addEventListener("logoutSuccess", loadCurrentUser);
    window.addEventListener("profilePictureUpdated", loadCurrentUser);

    return () => {
      window.removeEventListener("storage", loadCurrentUser);
      window.removeEventListener("loginSuccess", loadCurrentUser);
      window.removeEventListener("logoutSuccess", loadCurrentUser);
      window.removeEventListener("profilePictureUpdated", loadCurrentUser);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(closeDrawer);
    return () => window.cancelAnimationFrame(frame);
  }, [closeDrawer, location.pathname]);

  useEffect(() => {
    if (!isOpen && !menuOpen && !notifOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeDrawer, isOpen, menuOpen, notifOpen]);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;

    const restoreScroll = () => {
      if (!scrollLockSnapshotRef.current) return;
      body.style.overflow = scrollLockSnapshotRef.current.bodyOverflow;
      body.style.touchAction = scrollLockSnapshotRef.current.bodyTouchAction;
      root.style.overflow = scrollLockSnapshotRef.current.rootOverflow;
      scrollLockSnapshotRef.current = null;
    };

    if (!isOpen) {
      restoreScroll();
      return undefined;
    }

    if (!scrollLockSnapshotRef.current) {
      scrollLockSnapshotRef.current = {
        bodyOverflow: body.style.overflow,
        bodyTouchAction: body.style.touchAction,
        rootOverflow: root.style.overflow,
      };
    }

    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    root.style.overflow = "hidden";

    return () => restoreScroll();
  }, [isOpen]);

  useEffect(() => {
    const resetEdgeSwipe = () => {
      edgeSwipeArmedRef.current = false;
      edgeSwipeStartXRef.current = 0;
      edgeSwipeStartYRef.current = 0;
    };

    /** @param {TouchEvent} event */
    const handleTouchStart = (event) => {
      if (isOpen || menuOpen || notifOpen) {
        resetEdgeSwipe();
        return;
      }

      const point = event.touches?.[0];
      if (!point) return;
      edgeSwipeStartXRef.current = point.clientX;
      edgeSwipeStartYRef.current = point.clientY;
      edgeSwipeArmedRef.current = point.clientX <= 28;
    };

    /** @param {TouchEvent} event */
    const handleTouchMove = (event) => {
      if (isOpen || menuOpen || notifOpen || !edgeSwipeArmedRef.current) return;
      const point = event.touches?.[0];
      if (!point) return;

      const deltaX = point.clientX - edgeSwipeStartXRef.current;
      const deltaY = Math.abs(point.clientY - edgeSwipeStartYRef.current);

      if (deltaX > 64 && deltaY < 36) {
        setIsOpen(true);
        resetEdgeSwipe();
        return;
      }

      if (deltaY > 42 || deltaX < -24) {
        resetEdgeSwipe();
      }
    };

    const handleTouchEnd = () => resetEdgeSwipe();

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isOpen, menuOpen, notifOpen]);

  const isLoggedIn = Boolean(currentUser && typeof currentUser === "object");

  const userName = useMemo(() => {
    if (!isLoggedIn) return t("common.labels.guest");
    const rawName =
      currentUser.name ||
      currentUser.username ||
      currentUser.fullName ||
      currentUser.email;
    return typeof rawName === "string" && rawName.trim() ? rawName : t("common.labels.guest");
  }, [currentUser, isLoggedIn, t]);

  const userEmail = useMemo(() => {
    if (!isLoggedIn) return t("account.guestModeActive");
    const rawEmail = currentUser.email || currentUser.contactEmail || currentUser.username;
    return typeof rawEmail === "string" && rawEmail.trim()
      ? rawEmail
      : t("account.signedInSynced");
  }, [currentUser, isLoggedIn, t]);

  const userAvatar = useMemo(() => {
    if (!isLoggedIn) return "";
    const rawAvatar =
      currentUser.profilePicture || currentUser.avatar || currentUser.photo || "";
    return typeof rawAvatar === "string" ? rawAvatar : "";
  }, [currentUser, isLoggedIn]);

  const userInitials = useMemo(() => {
    const parts = String(userName).trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "U";
  }, [userName]);

  const hasUnreadNotifications = notifications.length > 0;

  const handleDrawerTouchStart = (event) => {
    const point = event.touches?.[0];
    if (!point) return;
    drawerTouchStartXRef.current = point.clientX;
    drawerTouchStartYRef.current = point.clientY;
  };

  const handleDrawerTouchMove = (event) => {
    if (!isOpen) return;
    const point = event.touches?.[0];
    if (!point) return;
    const deltaX = point.clientX - drawerTouchStartXRef.current;
    const deltaY = Math.abs(point.clientY - drawerTouchStartYRef.current);

    if (deltaX < -54 && deltaY < 36) {
      closeDrawer();
    }
  };

  const handleNotificationsToggle = () => {
    setNotifOpen((current) => {
      const next = !current;
      if (next) setMenuOpen(false);
      return next;
    });
  };

  const handleProfileToggle = () => {
    setMenuOpen((current) => {
      const next = !current;
      if (next) setNotifOpen(false);
      return next;
    });
  };

  const handleOpenTutorial = () => {
    closeDrawer();
    onOpenTutorial();
  };

  const handleAccountSettings = () => {
    closeDrawer();
    navigate("/profile-settings");
  };

  const handleThemeToggle = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    onToggleTheme(nextTheme);
  };

  const handleLogin = () => {
    closeDrawer();
    onLoginClick();
  };

  const handleSignUp = () => {
    closeDrawer();
    onSignUpClick();
  };

  const handleLogout = () => {
    clearAuthSession({ reason: "manual_logout" });
    closeDrawer();
  };

  const handleViewAllNotifications = () => {
    closeDrawer();
    navigate("/notifications");
  };

  const handleNotificationSelect = (notification) => {
    closeDrawer();
    navigate(notification.link || "/notifications");
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`mobile-sidebar-trigger ${isOpen ? "is-hidden" : ""}`.trim()}
        onClick={openDrawer}
        aria-label={t("nav.drawer.open")}
        aria-expanded={isOpen}
      >
        <span className="mobile-sidebar-trigger__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path className="mobile-sidebar-trigger__rail mobile-sidebar-trigger__rail--top" d="M5 7h14" />
            <path className="mobile-sidebar-trigger__rail mobile-sidebar-trigger__rail--middle" d="M4 12h16" />
            <path className="mobile-sidebar-trigger__rail mobile-sidebar-trigger__rail--bottom" d="M7 17h12" />
          </svg>
        </span>
      </button>

      <div ref={layerRef} className={`mobile-sidebar-layer ${isOpen ? "is-open" : ""}`.trim()} aria-hidden={!isOpen}>
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label={t("nav.drawer.close")}
          onClick={closeDrawer}
          tabIndex={isOpen ? 0 : -1}
        />

        <aside
          className={`mobile-sidebar-drawer ${menuOpen ? "menu-open" : ""} ${notifOpen ? "notif-open" : ""}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation drawer"
          onTouchStart={handleDrawerTouchStart}
          onTouchMove={handleDrawerTouchMove}
        >
          <div className="mobile-sidebar-scroll">
            <div className="mobile-sidebar-branding">
              <span className="mobile-sidebar-kicker">{t("nav.drawer.hub").toUpperCase()}</span>
              <h2 className="mobile-sidebar-title">NeuralGuard</h2>
              <p className="mobile-sidebar-status">
                {isOnline ? t("nav.drawer.liveSync") : t("nav.drawer.offlineMode")}
              </p>
            </div>

            <div className="mobile-sidebar-utility">
              <button
                type="button"
                className="mobile-sidebar-profile"
                onClick={handleProfileToggle}
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
              >
                <span className="mobile-sidebar-profile__avatar">
                  {userAvatar ? <img src={userAvatar} alt="" /> : <span>{userInitials}</span>}
                </span>
                <span className="mobile-sidebar-profile__copy">
                  <strong>{userName}</strong>
                  <span>{userEmail}</span>
                </span>
                <span className="mobile-sidebar-profile__chevron" aria-hidden="true">
                  {"\u203A"}
                </span>
              </button>

              <button
                type="button"
                className="mobile-sidebar-notify"
                onClick={handleNotificationsToggle}
                aria-expanded={notifOpen}
                aria-haspopup="dialog"
              >
                <span className="mobile-sidebar-notify__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M12 4a5 5 0 0 1 5 5v2.2c0 .7.2 1.4.6 2l1.1 1.7A1.2 1.2 0 0 1 17.7 18H6.3a1.2 1.2 0 0 1-1-1.9l1.1-1.7c.4-.6.6-1.3.6-2V9a5 5 0 0 1 5-5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9.5 18.5a2.5 2.5 0 0 0 5 0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="mobile-sidebar-notify__copy">
                  <strong>{t("common.labels.notifications")}</strong>
                  <span>
                    {hasUnreadNotifications
                      ? t("nav.notifications.active", { count: Math.min(notifications.length, 99) })
                      : t("nav.notifications.allClear")}
                  </span>
                </span>
                {hasUnreadNotifications ? (
                  <span className="mobile-sidebar-notify__badge" aria-label={t("nav.notifications.unread", { count: Math.min(notifications.length, 99) })}>
                    {Math.min(notifications.length, 99)}
                  </span>
                ) : null}
              </button>
            </div>

            <button
              type="button"
              className="mobile-sidebar-tutorial"
              onClick={handleOpenTutorial}
            >
              {t("nav.drawer.openTutorial")}
            </button>

            <div
              className="mobile-sidebar-nav-section"
              data-tutorial="header-nav"
              onClickCapture={(event) => {
                if (!(event.target instanceof Element)) return;
                if (event.target.closest("a")) {
                  closeDrawer();
                }
              }}
            >
              <span className="mobile-sidebar-section-label">{t("nav.drawer.main").toUpperCase()}</span>
              <nav className="mobile-sidebar-nav" aria-label={t("nav.header.primaryNavigation")}>
                {NAV_ITEMS.map((item) => (
                  <NavigationCard
                    key={item.to}
                    to={item.to}
                    label={t(item.labelKey)}
                    icon={item.icon}
                    themeKey={item.themeKey}
                    isActive={location.pathname === item.to || (item.to === "/dashboard" && location.pathname === "/")}
                  />
                ))}
              </nav>
            </div>
          </div>

          <div className={`mobile-sidebar-sheet ${menuOpen ? "is-visible" : ""}`.trim()}>
            <div className="mobile-sidebar-sheet__scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div className="mobile-sidebar-sheet__panel" role="dialog" aria-modal="true" aria-label={t("account.account")}>
              <div className="mobile-sidebar-sheet__head">
                <div>
                  <span className="mobile-sidebar-sheet__kicker">{t("account.account").toUpperCase()}</span>
                  <strong>{userName}</strong>
                </div>
                <button
                  type="button"
                  className="mobile-sidebar-sheet__close"
                  onClick={() => setMenuOpen(false)}
                  aria-label={t("nav.header.closeAccountMenu")}
                >
                  {"\u2715"}
                </button>
              </div>

              <div className="mobile-sidebar-sheet__profile">
                <span className="mobile-sidebar-sheet__avatar">
                  {userAvatar ? <img src={userAvatar} alt="" /> : <span>{userInitials}</span>}
                </span>
                <div className="mobile-sidebar-sheet__identity">
                  <strong>{userName}</strong>
                  <span>{userEmail}</span>
                </div>
              </div>

              <div className="mobile-sidebar-sheet__actions">
                <button type="button" className="mobile-sidebar-action" onClick={handleAccountSettings}>
                  <span>{t("account.settings")}</span>
                  <span aria-hidden="true">{"\u203A"}</span>
                </button>
                <button type="button" className="mobile-sidebar-action" onClick={handleThemeToggle}>
                  <span>{theme === "dark" ? t("account.switchLight") : t("account.switchDark")}</span>
                  <span aria-hidden="true">{"\u203A"}</span>
                </button>
                <LanguageSelector className="mobile-sidebar-language-selector" />
                <button type="button" className="mobile-sidebar-action" onClick={handleLogin}>
                  <span>{isLoggedIn ? t("account.signInAnother") : t("account.signIn")}</span>
                  <span aria-hidden="true">{"\u203A"}</span>
                </button>
                <button type="button" className="mobile-sidebar-action" onClick={handleSignUp}>
                  <span>{t("account.createAccount")}</span>
                  <span aria-hidden="true">{"\u203A"}</span>
                </button>
              </div>

              {isLoggedIn ? (
                <div className="mobile-sidebar-sheet__bottom">
                  <button type="button" className="mobile-sidebar-action danger" onClick={handleLogout}>
                    {t("account.signOut")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className={`mobile-sidebar-sheet ${notifOpen ? "is-visible" : ""}`.trim()}>
            <div className="mobile-sidebar-sheet__scrim" onClick={() => setNotifOpen(false)} aria-hidden="true" />
            <div className="mobile-sidebar-sheet__panel" role="dialog" aria-modal="true" aria-label={t("common.labels.notifications")}>
              <div className="mobile-sidebar-sheet__head">
                <div>
                  <span className="mobile-sidebar-sheet__kicker">{t("nav.header.alertCenter").toUpperCase()}</span>
                  <strong>{t("common.labels.notifications")}</strong>
                  <span className="mobile-sidebar-sheet__meta">
                    {hasUnreadNotifications
                      ? t("nav.notifications.recentAlerts", { count: Math.min(notifications.length, 99) })
                      : t("nav.notifications.noUrgentAlerts")}
                  </span>
                </div>
                <button
                  type="button"
                  className="mobile-sidebar-sheet__close"
                  onClick={() => setNotifOpen(false)}
                  aria-label={t("common.actions.close")}
                >
                  {"\u2715"}
                </button>
              </div>

              {notificationsLoading ? (
                <div className="mobile-sidebar-empty-state">
                  <strong>{t("nav.notifications.loading")}</strong>
                  <p>{t("nav.notifications.latestRecords")}</p>
                </div>
              ) : notifications.length ? (
                <div className="mobile-sidebar-notification-list">
                  {notifications.slice(0, 5).map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className="mobile-sidebar-notification-entry"
                      onClick={() => handleNotificationSelect(notification)}
                    >
                      <span className={`mobile-sidebar-notification-pill type-${notification.type || "info"}`}>
                        {String(notification.type || "info").replace(/_/g, " ")}
                      </span>
                      <span className="mobile-sidebar-notification-copy">
                        <strong>{notification.title}</strong>
                        <span>{notification.message}</span>
                        <small>
                          {notification.createdAt
                            ? new Date(notification.createdAt).toLocaleString(locale)
                            : t("common.states.now")}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mobile-sidebar-empty-state">
                  <strong>{t("nav.notifications.noActive")}</strong>
                  <p>{t("nav.notifications.appearHere")}</p>
                </div>
              )}

              <button type="button" className="mobile-sidebar-sheet__footer" onClick={handleViewAllNotifications}>
                {t("nav.notifications.viewAll")}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default MobileSidebar;
