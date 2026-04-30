import { useEffect } from "react";
import "../../styles/overlays/notifications.css";

const Notifications = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="notifications-backdrop"
        onClick={onClose}
        aria-label="Inchide notificari"
      />
      <div className="notifications-popup" role="dialog" aria-modal="true" aria-label="Notificari">
        <div className="notifications-header">
          <div>
            <p className="notifications-kicker">Centru alerte</p>
            <h3>Notificari</h3>
          </div>
          <span className="notifications-pill">Actual</span>
        </div>
        <div className="notifications-empty">
          <span className="notifications-icon" aria-hidden="true">
            {"\u{1F514}"}
          </span>
          <p>Nu ai notificari noi.</p>
        </div>
        <button type="button" className="notifications-close" onClick={onClose}>
          Am inteles
        </button>
      </div>
    </>
  );
};

export default Notifications;

