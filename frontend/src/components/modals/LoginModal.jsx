// src/components/LoginModal.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import apiClient from "../../api/client";
import useDocumentScrollLock from "../../hooks/useDocumentScrollLock";
import { useLanguage } from "../../i18n/LanguageContext";
import { saveAuthSession } from "../../utils/authSession";
import "../../styles/modals/LoginModal.css";

const LoginModal = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useDocumentScrollLock(isOpen);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError(t("auth.errors.requiredFields"));
      return;
    }

    try {
      const res = await apiClient.post("/api/login", { email, password });
      const data = res?.data || {};
      if (data?.accessToken && data?.user) {
        saveAuthSession({ accessToken: data.accessToken, user: data.user });
        onClose();
        navigate("/profile-settings");
      } else {
        setError(t("auth.errors.invalidCredentials"));
      }
    } catch (error) {
      setError(error?.response?.data?.error || t("auth.errors.server"));
    }
  };

  return createPortal(
    <div
      className="modal-overlay login-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal-content login-modal-content mobile-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
      >
        <div className="modal-header">
          <h1 id="login-modal-title">{t("auth.login.title")}</h1>
          <button type="button" className="close-btn" onClick={onClose} aria-label={t("auth.login.close")}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p>{t("auth.login.welcome")}</p>

          {error && <div className="error-message">{error}</div>}

          <form className="login-form" onSubmit={handleSubmit}>
            <label>{t("auth.form.email")}</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label>{t("auth.form.password")}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {/* Already correct class */}
            <button className="signin-btn" type="submit">{t("auth.actions.signIn")}</button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LoginModal;

