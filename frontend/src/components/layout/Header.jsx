import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import apiClient from "../../api/client";
import { getRealtimeSocket } from "../../lib/realtimeSocket";
import { useLanguage } from "../../i18n/LanguageContext";
import LanguageSelector from "../common/LanguageSelector";
import { clearAuthSession, getAccessToken } from "../../utils/authSession";
import "../../styles/layout/Header.css";

/** @type {Record<string, string>} */
const PAGE_LABEL_KEYS = {
  "/": "nav.routes.dashboard",
  "/dashboard": "nav.routes.dashboard",
  "/map": "nav.routes.map",
  "/communication": "nav.routes.communication",
  "/guide": "nav.routes.guide",
  "/safety": "nav.routes.safety",
  "/sos": "nav.routes.sos",
  "/profile-settings": "nav.routes.profileSettings",
};

const NAV_ITEMS = [
  { labelKey: "nav.routes.dashboard", path: "/dashboard", icon: "dashboard", themeKey: "dashboard", featured: true },
  { labelKey: "nav.routes.map", path: "/map", icon: "map", themeKey: "map" },
  { labelKey: "nav.routes.communication", path: "/communication", icon: "communication", themeKey: "communication" },
  { labelKey: "nav.routes.guide", path: "/guide", icon: "guide", themeKey: "guide" },
  { labelKey: "nav.routes.safety", path: "/safety", icon: "communication", themeKey: "communication" },
  { labelKey: "nav.routes.sos", path: "/sos", icon: "sos", themeKey: "sos", featured: true },
  { labelKey: "nav.routes.profileSettings", path: "/profile-settings", icon: "profile", themeKey: "profile" },
];

const BRAND_LOGO_SRC = "/logo.png";

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
 * @param {{ name: string }} props
 */
function SidebarIcon({ name }) {
  switch (name) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="8" height="16" rx="3" />
          <rect x="13" y="4" width="8" height="16" rx="3" />
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
          <path
            d="M6 9.5v5.2c0 .6.3 1.1.8 1.4 1.6.9 3.3 1.4 5.2 1.4 1.8 0 3.6-.5 5.2-1.4.5-.3.8-.8.8-1.4V9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
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
          <path
            d="M9.5 12.5 11.5 14.5 15 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "incident":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 3.5 18h17L12 3Z" />
          <path
            d="M12 9v4.5m0 2h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "sos":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 8v4m0 4h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 12h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path
            d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
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

/**
 * @param {{
 *  onLoginClick?: () => void,
 *  onSignUpClick?: () => void,
 *  theme?: "light" | "dark",
 *  onToggleTheme?: (nextTheme: "light" | "dark") => void,
 *  isMobileView?: boolean,
 *  onOpenTutorial?: () => void
 * }} props
 */
function Header({
  onLoginClick = () => {},
  onSignUpClick = () => {},
  theme = "light",
  onToggleTheme = /** @type {(nextTheme: "light" | "dark") => void} */ (() => {}),
  isMobileView = false,
  onOpenTutorial = () => {},
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, locale } = useLanguage();
  const headerRef = useRef(/** @type {HTMLElement | null} */ (null));
  const menuRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const navRef = useRef(/** @type {HTMLElement | null} */ (null));
  const navToggleRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const navListRef = useRef(/** @type {HTMLUListElement | null} */ (null));
  const notifRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const menuPanelRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const notifPanelRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const navTouchStartXRef = useRef(0);
  const navTouchStartYRef = useRef(0);
  const edgeSwipeStartXRef = useRef(0);
  const edgeSwipeStartYRef = useRef(0);
  const edgeSwipeArmedRef = useRef(false);
  const scrollLockSnapshotRef = useRef(
    /** @type {{ bodyOverflow: string, bodyTouchAction: string, rootOverflow: string } | null} */ (null),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const effectiveNavOpen = isMobileView ? navOpen : false;
  const mobileUtilityOpen = isMobileView && (menuOpen || notifOpen);
  const mobileOverlayOpen = effectiveNavOpen || mobileUtilityOpen;
  const utilityOpen = menuOpen || notifOpen;
  const showDesktopNav = !isMobileView;
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeNotifications = useCallback(() => setNotifOpen(false), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const closeAllMobileLayers = useCallback(() => {
    setMenuOpen(false);
    setNotifOpen(false);
    setNavOpen(false);
  }, []);

  const handleNavToggle = useCallback(() => {
    setNavOpen((current) => {
      const next = !current;
      if (next) {
        setMenuOpen(false);
        setNotifOpen(false);
      }
      return next;
    });
  }, []);

  const handleNotificationsToggle = useCallback(() => {
    setNotifOpen((current) => {
      const next = !current;
      if (next) {
        setMenuOpen(false);
        setNavOpen(false);
      }
      return next;
    });
  }, []);

  const handleProfileToggle = useCallback(() => {
    setMenuOpen((current) => {
      const next = !current;
      if (next) {
        setNotifOpen(false);
        setNavOpen(false);
      }
      return next;
    });
  }, []);

  const pageTitle = PAGE_LABEL_KEYS[location.pathname] ? t(PAGE_LABEL_KEYS[location.pathname]) : "NeuralGuard";
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem("currentUser");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleConnectivity = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", handleConnectivity);
    window.addEventListener("offline", handleConnectivity);
    return () => {
      window.removeEventListener("online", handleConnectivity);
      window.removeEventListener("offline", handleConnectivity);
    };
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
        // keep local fallback; only clear when local is invalid JSON
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
    /** @param {MouseEvent} e */
    const close = (e) => {
      const target = e.target;
      const insideTrigger = target instanceof Node && menuRef.current?.contains(target);
      const insidePanel = target instanceof Node && menuPanelRef.current?.contains(target);
      if (target instanceof Node && !insideTrigger && !insidePanel) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    /** @param {MouseEvent} e */
    const close = (e) => {
      const target = e.target;
      const insideTrigger = target instanceof Node && notifRef.current?.contains(target);
      const insidePanel = target instanceof Node && notifPanelRef.current?.contains(target);
      if (target instanceof Node && !insideTrigger && !insidePanel) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    /** @param {MouseEvent} e */
    const closeNav = (e) => {
      if (!effectiveNavOpen) return;
      const target = e.target;
      if (target instanceof Node && navRef.current && !navRef.current.contains(target)) {
        setNavOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeNav);
    return () => document.removeEventListener("pointerdown", closeNav);
  }, [effectiveNavOpen]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        closeAllMobileLayers();
      }
    };

    if (!mobileOverlayOpen) return undefined;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeAllMobileLayers, mobileOverlayOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(closeAllMobileLayers);
    return () => window.cancelAnimationFrame(frame);
  }, [closeAllMobileLayers, location.pathname]);

  useEffect(() => {
    if (!isMobileView) return undefined;

    const resetEdgeSwipe = () => {
      edgeSwipeArmedRef.current = false;
      edgeSwipeStartXRef.current = 0;
      edgeSwipeStartYRef.current = 0;
    };

    /** @param {TouchEvent} event */
    const handleTouchStart = (event) => {
      if (mobileOverlayOpen) {
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
      if (mobileOverlayOpen || !edgeSwipeArmedRef.current) return;
      const point = event.touches?.[0];
      if (!point) return;

      const deltaX = point.clientX - edgeSwipeStartXRef.current;
      const deltaY = Math.abs(point.clientY - edgeSwipeStartYRef.current);

      if (deltaX > 64 && deltaY < 36) {
        setNavOpen(true);
        setMenuOpen(false);
        setNotifOpen(false);
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
  }, [isMobileView, mobileOverlayOpen]);

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

    if (!isMobileView || !effectiveNavOpen) {
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
  }, [effectiveNavOpen, isMobileView]);

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;

    let frame = 0;
    const updateHeaderHeightVar = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = Math.ceil(headerEl.getBoundingClientRect().height || 0);
        if (height > 0) {
          document.documentElement.style.setProperty("--header-height", `${height}px`);
        }
      });
    };

    updateHeaderHeightVar();

    /** @type {ResizeObserver | null} */
    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateHeaderHeightVar);
      resizeObserver.observe(headerEl);
    }

    window.addEventListener("resize", updateHeaderHeightVar);
    return () => {
      window.removeEventListener("resize", updateHeaderHeightVar);
      if (resizeObserver) resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [effectiveNavOpen, menuOpen, notifOpen, pageTitle]);

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

  const goSettings = () => {
    closeMenu();
    navigate("/profile-settings");
  };

  const handleLogout = () => {
    clearAuthSession({ reason: "manual_logout" });
    closeMenu();
  };

  /** @param {import("react").KeyboardEvent<HTMLUListElement>} event */
  const handleNavKeyDown = (event) => {
    if (event.key === "Escape") {
      setNavOpen(false);
      return;
    }
    if (!isMobileView) return;
    if (event.key !== "Tab") return;
    const list = navListRef.current;
    if (!list) return;
    const focusables = /** @type {NodeListOf<HTMLElement>} */ (
      list.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /** @param {import("react").TouchEvent<HTMLUListElement>} event */
  const handleNavTouchStart = (event) => {
    const point = event.touches?.[0];
    if (!point) return;
    navTouchStartXRef.current = point.clientX;
    navTouchStartYRef.current = point.clientY;
  };

  /** @param {import("react").TouchEvent<HTMLUListElement>} event */
  const handleNavTouchMove = (event) => {
    if (!effectiveNavOpen) return;
    const point = event.touches?.[0];
    if (!point) return;
    const deltaX = point.clientX - navTouchStartXRef.current;
    const deltaY = Math.abs(point.clientY - navTouchStartYRef.current);

    if (deltaX < -54 && deltaY < 36) {
      setNavOpen(false);
    }
  };

  const notificationsDropdown = notifOpen ? (
    <div
      ref={notifPanelRef}
      className={`notif-dropdown ${isMobileView ? "mobile-sheet-panel mobile-enter" : ""}`}
      role="menu"
    >
      {isMobileView ? (
        <div className="mobile-sheet-topline">
          <div className="mobile-sheet-title">
            <span className="mobile-sheet-kicker">{t("nav.header.alertCenter")}</span>
            <strong className="notif-title">{t("common.labels.notifications")}</strong>
          </div>
          <button
            type="button"
            className="mobile-sheet-close"
            onClick={closeNotifications}
            aria-label={t("common.actions.close")}
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      ) : (
        <div className="notif-title">{t("common.labels.notifications")}</div>
      )}
      {notificationsLoading ? (
        <div className="notif-empty-state">{t("nav.notifications.loading")}</div>
      ) : notifications.length ? (
        <>
          {notifications.slice(0, 5).map((notification) => (
            <button
              key={notification.id}
              type="button"
              className="dropdown-item notif-entry"
              role="menuitem"
              onClick={() => {
                closeNotifications();
                navigate(notification.link || "/notifications");
              }}
            >
              <span className={`notif-type-pill notif-type-${notification.type || "info"}`}>
                {String(notification.type || "info").replace(/_/g, " ")}
              </span>
              <span className="notif-entry-copy">
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
          <button
            type="button"
            className="dropdown-item notif-view-all"
            role="menuitem"
            onClick={() => {
              closeNotifications();
              navigate("/notifications");
            }}
          >
            {t("nav.notifications.viewAll")}
          </button>
        </>
      ) : (
        <div className="notif-empty-state">{t("nav.notifications.empty")}</div>
      )}
    </div>
  ) : null;

  const userDropdown = menuOpen ? (
    <div
      ref={menuPanelRef}
      className={`user-dropdown ${isMobileView ? "mobile-sheet-panel mobile-enter" : ""}`}
      role="menu"
    >
      {isMobileView ? (
        <div className="mobile-sheet-topline">
          <div className="mobile-sheet-title">
            <span className="mobile-sheet-kicker">{t("account.account")}</span>
            <strong className="notif-title">{userName}</strong>
            <span className="header-sheet-meta">
              {isLoggedIn ? t("account.signedInReady") : t("account.guestMode")}
            </span>
          </div>
          <button
            type="button"
            className="mobile-sheet-close"
            onClick={closeMenu}
            aria-label={t("nav.header.closeAccountMenu")}
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      ) : null}
      <button type="button" className="dropdown-item" role="menuitem" onClick={goSettings}>
        {t("account.settings")}
      </button>
      <button
        type="button"
        className="dropdown-item"
        role="menuitem"
        onClick={() => {
          closeMenu();
          onToggleTheme(theme === "dark" ? "light" : "dark");
        }}
      >
        {theme === "dark" ? t("account.lightMode") : t("account.darkMode")}
      </button>
      <LanguageSelector className="account-language-selector" />
      <div className="dropdown-divider" />
      <button
        type="button"
        className="dropdown-item"
        role="menuitem"
        onClick={() => {
          closeMenu();
          onLoginClick();
        }}
      >
        {isLoggedIn ? t("account.signInAnother") : t("account.signIn")}
      </button>
      <button
        type="button"
        className="dropdown-item"
        role="menuitem"
        onClick={() => {
          closeMenu();
          onSignUpClick();
        }}
      >
        {t("account.createAccount")}
      </button>
      {isLoggedIn && (
        <button
          type="button"
          className="dropdown-item danger"
          role="menuitem"
          onClick={handleLogout}
        >
          {t("account.signOut")}
        </button>
      )}
    </div>
  ) : null;

  return (
    <header
      className={`header crisis-header ${effectiveNavOpen ? "drawer-open" : ""} ${utilityOpen ? "utility-open" : ""}`.trim()}
      ref={headerRef}
    >
      <div className="header-top">
        <div className="header-left">
          <div className="brand-wrap">
            <span className="brand-mark" aria-hidden="true">
              <img
                src={BRAND_LOGO_SRC}
                alt=""
                className="brand-logo-img"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </span>
          </div>

          <div className="page-title">
            <span className="page-title-label">{pageTitle}</span>
            <span className="page-title-meta">{t("nav.header.subtitle")}</span>
          </div>
        </div>

        <nav className="header-nav" aria-label={t("nav.header.primaryNavigation")} ref={navRef}>
          <button
            ref={navToggleRef}
            className={`nav-toggle ${effectiveNavOpen ? "is-open" : ""}`}
            type="button"
            aria-label={effectiveNavOpen ? t("nav.header.closePrimaryNavigation") : t("nav.header.openPrimaryNavigation")}
            aria-expanded={effectiveNavOpen}
            aria-controls="primary-navigation"
            aria-haspopup="menu"
            onClick={handleNavToggle}
          >
            <span className="nav-toggle-icon" aria-hidden="true">
              {effectiveNavOpen ? "\u2715" : "\u2630"}
            </span>
            <span className="nav-toggle-label">{effectiveNavOpen ? t("common.actions.close") : t("common.labels.menu")}</span>
          </button>
          <ul
            id="primary-navigation"
            ref={navListRef}
            className={`nav-list ${effectiveNavOpen ? "open" : ""} ${isMobileView ? "drawer" : ""}`}
            aria-hidden={!showDesktopNav && !effectiveNavOpen}
            role="list"
            onKeyDown={handleNavKeyDown}
            onTouchStart={handleNavTouchStart}
            onTouchMove={handleNavTouchMove}
            data-tutorial="header-nav"
          >
            {isMobileView ? (
              <li className="mobile-drawer-head">
                <div className="mobile-drawer-head-copy">
                  <span className="mobile-drawer-kicker">{t("nav.drawer.hub")}</span>
                  <strong className="mobile-drawer-title">NeuralGuard</strong>
                  <span className="mobile-drawer-status">
                    {isOnline ? t("nav.drawer.liveSync") : t("nav.drawer.offlineMode")}
                  </span>
                </div>
              </li>
            ) : null}
            {isMobileView && !isLoggedIn ? (
              <li className="mobile-drawer-auth">
                <button
                  type="button"
                  className="drawer-auth-btn login"
                  onClick={() => {
                    closeNav();
                    onLoginClick();
                  }}
                >
                  {t("auth.actions.signIn")}
                </button>
                <button
                  type="button"
                  className="drawer-auth-btn signup"
                  onClick={() => {
                    closeNav();
                    onSignUpClick();
                  }}
                >
                  {t("auth.actions.signUp")}
                </button>
              </li>
            ) : null}
            {isMobileView ? (
              <li className="mobile-drawer-utility">
                <button
                  type="button"
                  className="drawer-utility-btn"
                  onClick={() => {
                    closeNav();
                    onOpenTutorial();
                  }}
                >
                  {t("nav.drawer.openTutorial")}
                </button>
              </li>
            ) : null}
            {isMobileView ? <li className="mobile-drawer-section-label">{t("nav.drawer.main")}</li> : null}
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `top-nav-link ${item.featured ? "featured" : ""} ${isActive ? "active" : ""}`
                  }
                  data-nav-theme={item.themeKey}
                  onClick={closeAllMobileLayers}
                  aria-label={t(item.labelKey)}
                  title={t(item.labelKey)}
                >
                  <span className="nav-icon">
                    <SidebarIcon name={item.icon} />
                  </span>
                  <span className="nav-text">{t(item.labelKey)}</span>
                  {isMobileView ? (
                    <span className="nav-item-chevron" aria-hidden="true">
                      {"\u203A"}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="header-right">
          <div className="header-help">
            <button
              className="help-button"
              type="button"
              onClick={onOpenTutorial}
              aria-label={t("nav.header.openPageTutorial")}
              data-tutorial="header-help"
            >
              <span className="help-icon" aria-hidden="true">
                ?
              </span>
            </button>
          </div>
          <div className="header-notifications" ref={notifRef}>
            <button
              className="notif-button"
              type="button"
              aria-haspopup="true"
              aria-expanded={notifOpen}
              aria-label={t("common.labels.notifications")}
              onClick={handleNotificationsToggle}
              data-tutorial="header-notifications"
            >
              <span className="notif-icon" aria-hidden="true">
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
              {notifications.length ? (
                <span
                  className="notif-badge"
                  aria-label={t("nav.notifications.unread", { count: Math.min(notifications.length, 99) })}
                >
                  {Math.min(notifications.length, 99)}
                </span>
              ) : null}
            </button>
            {!isMobileView ? notificationsDropdown : null}
          </div>
          <div className="header-user-menu" ref={menuRef}>
            <button
              className="profile-chip"
              type="button"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={handleProfileToggle}
              aria-label={t("nav.header.accountMenu")}
              data-tutorial="header-profile"
            >
              <span className="profile-avatar">
                {userAvatar ? (
                  <img src={userAvatar} alt="" />
                ) : (
                  <span className="profile-initials">{userInitials}</span>
                )}
              </span>
              <span className="profile-meta">
                <span className="profile-name">
                  {userName}
                  <span
                    className={`profile-status ${isOnline ? "online" : "offline"}`}
                    aria-hidden="true"
                  />
                </span>
                <span className="profile-role">{isLoggedIn ? t("account.activeAccount") : t("account.notSignedIn")}</span>
              </span>
              <span className="profile-chevron" aria-hidden="true">
                {"\u25BE"}
              </span>
            </button>

            {!isMobileView ? userDropdown : null}
          </div>
        </div>
      </div>
      {effectiveNavOpen && (
        <button
          className="nav-backdrop"
          type="button"
          aria-label={t("nav.header.closeMobilePanels")}
          onClick={closeAllMobileLayers}
        />
      )}
      {isMobileView && notifOpen ? createPortal(notificationsDropdown, document.body) : null}
      {isMobileView && menuOpen ? createPortal(userDropdown, document.body) : null}
    </header>
  );
}

export default Header;
