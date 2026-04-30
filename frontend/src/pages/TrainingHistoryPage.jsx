import { useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/OperationsPages.css";

const STORAGE_KEY = "neuralguard-training-history";

const buildDrillTemplates = (t) => [
  { key: "earthquake", title: t("training.templates.earthquake.title"), description: t("training.templates.earthquake.description") },
  { key: "fire", title: t("training.templates.fire.title"), description: t("training.templates.fire.description") },
  { key: "flood", title: t("training.templates.flood.title"), description: t("training.templates.flood.description") },
  { key: "medical", title: t("training.templates.medical.title"), description: t("training.templates.medical.description") },
];

const TrainingHistoryPage = () => {
  const { t, locale } = useLanguage();
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const nextIdRef = useRef(history.length + 1);
  const drillTemplates = useMemo(() => buildDrillTemplates(t), [t]);

  const totalCompleted = useMemo(
    () => history.filter((item) => item.status === "completed").length,
    [history],
  );

  const startDrill = (template) => {
    const nextId = nextIdRef.current;
    nextIdRef.current += 1;
    const nextEntry = {
      id: `drill-${nextId}`,
      templateKey: template.key,
      title: template.title,
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: template.description,
    };
    const nextHistory = [nextEntry, ...history].slice(0, 20);
    setHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  };

  return (
    <section className="page-shell training-page">
      <div className="training-card">
        <h1>{t("training.title")}</h1>
        <p className="incident-meta">
          {t("training.description")}
        </p>
      </div>

      <div className="training-grid">
        <div className="training-card" data-tutorial="training-templates">
          <h2>{t("training.templatesTitle")}</h2>
          <div className="drill-history">
            {drillTemplates.map((template) => (
              <div key={template.key} className="drill-item">
                <strong>{template.title}</strong>
                <p className="training-meta">{template.description}</p>
                <button type="button" onClick={() => startDrill(template)}>
                  {t("training.actions.complete")}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="training-card" data-tutorial="training-history">
          <h2>{t("training.historyTitle")}</h2>
          <p className="training-meta">{t("training.completedCount", { count: totalCompleted })}</p>
          <div className="drill-history">
            {history.map((entry) => (
              <div key={entry.id} className="drill-item">
                <strong>{entry.title}</strong>
                <div className="training-meta">
                  {entry.completedAt ? new Date(entry.completedAt).toLocaleString(locale) : ""}
                </div>
                <p className="training-meta">{entry.summary}</p>
              </div>
            ))}
            {!history.length && (
              <div className="drill-item">
                <strong>{t("training.states.emptyTitle")}</strong>
                <p className="training-meta">{t("training.states.emptyBody")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default TrainingHistoryPage;
