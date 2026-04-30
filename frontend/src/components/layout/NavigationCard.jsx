import { NavLink } from "react-router-dom";

function NavigationIcon({ icon }) {
  switch (icon) {
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
 *   to: string,
 *   label: string,
 *   icon: string,
 *   themeKey: string,
 *   isActive: boolean
 * }} props
 */
function NavigationCard({ to, label, icon, themeKey, isActive }) {
  return (
    <NavLink
      to={to}
      className={`mobile-nav-card ${isActive ? "is-active" : ""}`.trim()}
      data-nav-theme={themeKey}
      aria-label={label}
      title={label}
    >
      <span className="mobile-nav-card__icon" aria-hidden="true">
        <NavigationIcon icon={icon} />
      </span>
      <span className="mobile-nav-card__label">{label}</span>
      <span className="mobile-nav-card__chevron" aria-hidden="true">
        {"\u203A"}
      </span>
    </NavLink>
  );
}

export default NavigationCard;
