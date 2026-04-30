import { useEffect, useState } from "react";
import "../../styles/overlays/toast.css";

const ToastHost = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (event) => {
      const detail = event?.detail || {};
      const message = typeof detail.message === "string" ? detail.message : "";
      if (!message) return;

      const toast = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message,
        tone: detail.tone || "info",
      };

      setToasts((current) => [...current, toast]);

      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 3200);
    };

    window.addEventListener("app-toast", handleToast);
    return () => window.removeEventListener("app-toast", handleToast);
  }, []);

  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
};

export default ToastHost;
