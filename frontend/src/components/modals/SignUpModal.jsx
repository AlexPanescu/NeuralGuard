// src/components/SignUpModal.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import "../../styles/modals/SignUpModal.css";
import apiClient from "../../api/client";
import useDocumentScrollLock from "../../hooks/useDocumentScrollLock";
import { useLanguage } from "../../i18n/LanguageContext";
import { saveAuthSession } from "../../utils/authSession";

const SignUpModal = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  useDocumentScrollLock(isOpen);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(e.target);
    const email = formData.get("email");
    const password = formData.get("psw");
    const repeatPassword = formData.get("psw-repeat");

    if (password !== repeatPassword) {
      setError(t("auth.errors.passwordMismatch"));
      setIsSubmitting(false);
      return;
    }

    const usernameRaw = formData.get("username");
    const username =
      typeof usernameRaw === "string" && usernameRaw.trim().length >= 3
        ? usernameRaw.trim().slice(0, 30)
        : undefined;

    try {
      const response = await apiClient.post("/api/signup", {
        email,
        password,
        ...(username ? { username } : {}),
      });

      const data = response.data;
      if (data?.accessToken && data?.user) {
        saveAuthSession({ accessToken: data.accessToken, user: data.user });
      }

      setSuccess(true);

      setTimeout(() => {
        onClose();
        navigate("/profile-settings");
      }, 2000);
    } catch (err) {
      const errorMessage =
        err.response?.data?.error ||
        err.message ||
        t("auth.errors.connection");

      setError(errorMessage);
      console.error("Signup error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay signup-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="modal-content signup-modal-content mobile-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-modal-title"
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label={t("auth.signup.close")}>
          &times;
        </button>
        {!success ? (
          <form className="signup-form" onSubmit={handleSubmit}>
            <div className="container">
              <h1 id="signup-modal-title">{t("auth.signup.title")}</h1>
              <p>{t("auth.signup.intro")}</p>
              <hr />

              {error ? <div className="signup-error">{error}</div> : null}

              <label>{t("auth.form.email")}</label>
              <input
                type="email"
                name="email"
                placeholder={t("auth.form.enterEmail")}
                autoComplete="email"
                required
              />

              <label>{t("auth.form.usernameOptional")}</label>
              <input
                type="text"
                name="username"
                placeholder={t("auth.form.usernamePlaceholder")}
                autoComplete="username"
                maxLength={30}
              />

              <label>{t("auth.form.password")}</label>
              <input
                type="password"
                name="psw"
                placeholder={t("auth.form.enterPassword")}
                autoComplete="new-password"
                required
              />

              <label>{t("auth.form.repeatPassword")}</label>
              <input
                type="password"
                name="psw-repeat"
                placeholder={t("auth.form.repeatPasswordPlaceholder")}
                autoComplete="new-password"
                required
              />

              <div className="clearfix">
                <button type="button" className="cancel-btn" onClick={onClose} disabled={isSubmitting}>
                  {t("common.actions.cancel")}
                </button>
                <button type="submit" className="signup-btn" disabled={isSubmitting}>
                  {isSubmitting ? t("auth.actions.creating") : t("auth.actions.signUp")}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="success-message">
            <h2>{t("auth.signup.successTitle")}</h2>
            <p>{t("auth.signup.successBody")}</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default SignUpModal;

