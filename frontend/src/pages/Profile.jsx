import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";

const Profile = () => {
  const { t, locale } = useLanguage();
  const [user] = useState(() => {
    try {
      const currentUser = localStorage.getItem("currentUser");
      return currentUser ? JSON.parse(currentUser) : null;
    } catch {
      return null;
    }
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate("/");
    }
  }, [navigate, user]);

  if (!user) {
    return <h2 style={{ padding: "20px" }}>{t("profile.states.loading")}</h2>;
  }

  return (
    <section style={{ maxWidth: "840px", margin: "0 auto", padding: "24px" }}>
      <h1 style={{ marginBottom: "12px" }}>{t("profile.title")}</h1>
      <p style={{ marginBottom: "18px" }}>
        {t("profile.description")}
      </p>

      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <p>
          <strong>Email:</strong> {user.email}
        </p>
        <p>
          <strong>{t("profile.labels.userId")}:</strong> {user.id}
        </p>
        <p>
          <strong>{t("profile.labels.registeredAt")}:</strong> {new Date(user.createdAt).toLocaleString(locale)}
        </p>
      </div>
    </section>
  );
};

export default Profile;
