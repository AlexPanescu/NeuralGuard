import EmergencyCopilotPanel from "../components/emergency/EmergencyCopilotPanel";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/CommunicationPage.css";
import "../styles/pages/SafetyPage.css";

const SafetyPage = () => {
  const { t } = useLanguage();
  return (
    <section className="page-shell safety-page ai-assist-page mobile-shell">
      <header className="safety-header ai-assist-header mobile-card mobile-section-head">
        <div>
          <h1>{t("safety.title")}</h1>
          <p>{t("safety.description")}</p>
        </div>
      </header>

      <EmergencyCopilotPanel className="ai-assist-panel" compact />
    </section>
  );
};

export default SafetyPage;
