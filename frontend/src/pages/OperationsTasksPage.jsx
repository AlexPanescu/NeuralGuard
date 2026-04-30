import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/OperationsPages.css";

const TASK_STATUSES = ["todo", "in_progress", "done"];

const OperationsTasksPage = () => {
  const { t } = useLanguage();
  const [incidents, setIncidents] = useState([]);

  const loadIncidents = useCallback(async () => {
    try {
      const response = await apiClient.get("/api/incidents");
      setIncidents(Array.isArray(response.data) ? response.data : []);
    } catch {
      setIncidents([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadIncidents();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadIncidents]);

  const tasks = useMemo(
    () =>
      incidents.flatMap((incident) =>
        (incident.tasks || []).map((task) => ({
          ...task,
          incidentId: incident.id || incident._id,
          incidentTitle: incident.title,
        })),
      ),
    [incidents],
  );

  const updateTask = async (task, nextStatus) => {
    try {
      await apiClient.patch(`/api/incidents/${task.incidentId}/tasks/${task.id || task._id}`, {
        status: nextStatus,
      });
      await loadIncidents();
    } catch {
      // silent refresh fallback
    }
  };

  return (
    <section className="page-shell operations-page">
      <div className="operations-hero" data-tutorial="operations-tasks-summary">
        <div>
          <h1>{t("operations.title")}</h1>
          <p>{t("operations.description")}</p>
        </div>
        <div className="ops-kpis">
          <div className="ops-kpi">
            <span>{t("operations.kpis.total")}</span>
            <strong>{tasks.length}</strong>
          </div>
          <div className="ops-kpi">
            <span>{t("operations.kpis.inProgress")}</span>
            <strong>{tasks.filter((task) => task.status === "in_progress").length}</strong>
          </div>
          <div className="ops-kpi">
            <span>{t("operations.kpis.done")}</span>
            <strong>{tasks.filter((task) => task.status === "done").length}</strong>
          </div>
        </div>
      </div>

      <div className="ops-card" data-tutorial="operations-tasks-list">
        <div className="task-list">
          {tasks.map((task) => (
            <div key={`${task.incidentId}-${task.id || task._id}`} className="task-item">
              <div className="task-topline">
                <strong>{task.title}</strong>
                <span className={`pill task-${task.status}`}>{task.status}</span>
              </div>
              <p className="incident-meta">
                {t("operations.labels.incident")}: <Link to={`/incidents/${task.incidentId}`}>{task.incidentTitle}</Link> •{" "}
                {t("operations.labels.owner")}: {task.owner || t("operations.labels.unassigned")} •{" "}
                {t("operations.labels.priority")}: {task.priority}
              </p>
              <div className="pill-row">
                {TASK_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="pill-btn"
                    onClick={() => updateTask(task, status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!tasks.length && (
            <div className="task-item">
              <strong>{t("operations.states.emptyTitle")}</strong>
              <p className="incident-meta">{t("operations.states.emptyBody")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default OperationsTasksPage;
