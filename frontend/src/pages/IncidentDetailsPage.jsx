import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import apiClient from "../api/client";
import { isOperatorRole, readCurrentUserRole } from "../utils/currentUser";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/OperationsPages.css";

const wasAutoClosedSos = (incident) =>
  String(incident?.source || "").toLowerCase() === "sos" &&
  Array.isArray(incident?.timeline) &&
  incident.timeline.some((entry) =>
    String(entry?.kind || "").toLowerCase() === "resolved" &&
    String(entry?.actorRole || "").toLowerCase() === "system" &&
    String(entry?.message || "").toLowerCase().includes("expir"),
  );

const IncidentDetailsPage = () => {
  const { t, locale } = useLanguage();
  const { incidentId } = useParams();
  const [incident, setIncident] = useState(null);
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("high");
  const [dangerScore, setDangerScore] = useState(72);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [assignmentName, setAssignmentName] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", owner: "", priority: "medium" });
  const [message, setMessage] = useState({ text: "", tone: "info" });
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const canOperate = isOperatorRole(readCurrentUserRole());

  const loadIncident = useCallback(async () => {
    try {
      const response = await apiClient.get(`/api/incidents/${incidentId}`);
      setIncident(response.data);
      setStatus(response.data?.status || "active");
      setSeverity(response.data?.severity || "high");
      setDangerScore(Number(response.data?.dangerScore || 72));
      setRadiusKm(Number(response.data?.location?.radiusKm || 1.5));
    } catch {
      setIncident(null);
    }
  }, [incidentId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadIncident();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadIncident]);

  const handleStatusSave = async () => {
    if (!incidentId) {
      setMessage({ text: t("incidentDetails.messages.invalidIncident"), tone: "error" });
      return;
    }
    setIsSavingStatus(true);
    try {
      const response = await apiClient.patch(`/api/incidents/${incidentId}`, {
        status,
        severity,
        dangerScore: Number(dangerScore),
        location: { radiusKm: Number(radiusKm) },
        note: "Status operational actualizat din Incident Details.",
      });
      if (response.data) {
        setIncident(response.data);
        setStatus(response.data?.status || status);
        setSeverity(response.data?.severity || severity);
        setDangerScore(Number(response.data?.dangerScore || dangerScore));
        setRadiusKm(Number(response.data?.location?.radiusKm || radiusKm));
      } else {
        await loadIncident();
      }
      setMessage({ text: t("incidentDetails.messages.statusSaved"), tone: "success" });
    } catch (error) {
      setMessage({
        text: error.response?.data?.error || t("incidentDetails.messages.statusError"),
        tone: "error",
      });
    } finally {
      setIsSavingStatus(false);
    }
  };

  const handleAssign = async () => {
    if (!assignmentName.trim()) return;
    try {
      await apiClient.post(`/api/incidents/${incidentId}/assign`, {
        assigneeName: assignmentName.trim(),
      });
      setAssignmentName("");
      setMessage({ text: t("incidentDetails.messages.assignmentSaved"), tone: "success" });
      await loadIncident();
    } catch (error) {
      setMessage({
        text: error.response?.data?.error || t("incidentDetails.messages.assignmentError"),
        tone: "error",
      });
    }
  };

  const handleCreateTask = async (event) => {
    event.preventDefault();
    try {
      await apiClient.post(`/api/incidents/${incidentId}/tasks`, taskForm);
      setTaskForm({ title: "", owner: "", priority: "medium" });
      setMessage({ text: t("incidentDetails.messages.taskAdded"), tone: "success" });
      await loadIncident();
    } catch (error) {
      setMessage({
        text: error.response?.data?.error || t("incidentDetails.messages.taskCreateError"),
        tone: "error",
      });
    }
  };

  const handleTaskStatus = async (taskId, nextStatus) => {
    try {
      await apiClient.patch(`/api/incidents/${incidentId}/tasks/${taskId}`, {
        status: nextStatus,
      });
      setMessage({ text: t("incidentDetails.messages.taskUpdated"), tone: "success" });
      await loadIncident();
    } catch {
      setMessage({ text: t("incidentDetails.messages.taskUpdateError"), tone: "error" });
    }
  };

  if (!incident) {
    return (
      <section className="page-shell incident-page">
        <div className="incident-shell">
          <h1>{t("incidentDetails.states.notFoundTitle")}</h1>
          <p>{t("incidentDetails.states.notFoundDescription")}</p>
          <Link className="ops-button" to="/map">
            {t("incidentDetails.actions.backToMap")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell incident-page">
      <div className="incident-shell" data-tutorial="incident-details-overview">
        <div className="incident-topline">
          <div>
            <h1>{incident.title}</h1>
            <p>{incident.summary || t("incidentDetails.states.noSummary")}</p>
          </div>
          <div className="pill-row">
            <span className={`pill severity-${incident.severity}`}>{incident.severity}</span>
            <span className={`pill status-${incident.status}`}>{incident.status}</span>
            {wasAutoClosedSos(incident) ? (
              <span className="pill pill-auto-closed">{t("incidentDetails.states.autoClosed")}</span>
            ) : null}
            <span className="pill">{incident.type}</span>
            <span className="pill">{t("incidentDetails.labels.danger")} {Number(incident.dangerScore || 0)}/100</span>
            <span className="pill">{t("incidentDetails.labels.radius")} {Number(incident.location?.radiusKm || 0).toFixed(1)} km</span>
          </div>
        </div>
      </div>

      <div className="incident-grid">
        <div className="incident-card ops-card" data-tutorial="incident-details-tasks">
          <h2>{t("incidentDetails.sections.tasks")}</h2>
          <div className="task-list">
            {(incident.tasks || []).map((task) => (
              <div key={task.id || task._id} className="task-item">
                <div className="task-topline">
                  <strong>{task.title}</strong>
                  <span className={`pill task-${task.status}`}>{task.status}</span>
                </div>
                <p className="incident-meta">
                  {t("incidentDetails.labels.owner")}: {task.owner || t("incidentDetails.states.unassigned")} • {t("incidentDetails.labels.priority")}: {task.priority}
                </p>
                <div className="pill-row">
                  {["todo", "in_progress", "done"].map((nextStatus) => (
                    <button
                      key={nextStatus}
                      type="button"
                      className="pill-btn"
                      onClick={() => handleTaskStatus(task.id || task._id, nextStatus)}
                    >
                      {nextStatus}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!incident.tasks?.length && (
              <div className="task-item">
                <strong>{t("incidentDetails.states.noTasks")}</strong>
                <p className="incident-meta">{t("incidentDetails.states.noTasksHelp")}</p>
              </div>
            )}
          </div>

          {canOperate && (
            <>
              <div style={{ height: 16 }} />
              <form className="inline-form" onSubmit={handleCreateTask}>
                <input
                  type="text"
                  placeholder={t("incidentDetails.placeholders.newTask")}
                  value={taskForm.title}
                  onChange={(event) =>
                    setTaskForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
                <div className="split-2">
                  <input
                    type="text"
                    placeholder={t("incidentDetails.placeholders.owner")}
                    value={taskForm.owner}
                    onChange={(event) =>
                      setTaskForm((current) => ({ ...current, owner: event.target.value }))
                    }
                  />
                  <select
                    value={taskForm.priority}
                    onChange={(event) =>
                      setTaskForm((current) => ({ ...current, priority: event.target.value }))
                    }
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
                <button type="submit">{t("incidentDetails.actions.addTask")}</button>
              </form>
            </>
          )}
        </div>

        <div className="incident-card ops-card" data-tutorial="incident-details-command">
          <h2>{t("incidentDetails.sections.command")}</h2>
          <div className="stack-form">
            <div className="split-2">
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="open">open</option>
                <option value="monitoring">monitoring</option>
                <option value="active">active</option>
                <option value="contained">contained</option>
                <option value="resolved">resolved</option>
              </select>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <div className="split-2">
              <input
                type="number"
                min="0"
                max="100"
                value={dangerScore}
                onChange={(event) => setDangerScore(event.target.value)}
                placeholder={t("incidentDetails.placeholders.dangerScore")}
              />
              <input
                type="number"
                min="0.1"
                max="500"
                step="0.1"
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                placeholder={t("incidentDetails.placeholders.radiusKm")}
              />
            </div>
            <button
              type="button"
              className="ops-primary-btn"
              onClick={handleStatusSave}
              disabled={isSavingStatus}
            >
              {isSavingStatus ? t("incidentDetails.actions.saving") : t("incidentDetails.actions.saveStatus")}
            </button>
            {message.text && (
              <p className={`ops-feedback ${message.tone === "error" ? "is-error" : "is-success"}`}>
                {message.text}
              </p>
            )}
          </div>

          <div style={{ height: 14 }} />
          <h2>{t("incidentDetails.sections.assignments")}</h2>
          <div className="guide-assignment-list">
            {(incident.assignedUsers || []).map((user, index) => (
              <div key={`${user.userId || user.name}-${index}`} className="guide-assignment-item">
                <div>
                  <strong>{user.name || user.userId}</strong>
                  <div className="incident-meta">{user.role || "operator"} • {user.status || "active"}</div>
                </div>
              </div>
            ))}
            {!incident.assignedUsers?.length && (
              <div className="guide-assignment-item">
                <div>
                  <strong>{t("incidentDetails.states.noAssignments")}</strong>
                  <div className="incident-meta">{t("incidentDetails.states.assignmentHelp")}</div>
                </div>
              </div>
            )}
          </div>

          {canOperate && (
            <div className="inline-form" style={{ marginTop: 12 }}>
              <input
                type="text"
                placeholder={t("incidentDetails.placeholders.operatorName")}
                value={assignmentName}
                onChange={(event) => setAssignmentName(event.target.value)}
              />
              <button type="button" onClick={handleAssign}>
                {t("incidentDetails.actions.updateAssignment")}
              </button>
            </div>
          )}

          <div style={{ height: 14 }} />
          <div data-tutorial="incident-details-guides">
            <h2>{t("incidentDetails.sections.guides")}</h2>
            <div className="guide-assignment-list">
            {(incident.guides || []).map((guide) => (
              <div key={guide.id || guide._id} className="guide-assignment-item">
                <div>
                  <strong>{guide.title || guide.subcategoryTitle}</strong>
                  <div className="incident-meta">{guide.category} / {guide.situation}</div>
                </div>
                <Link className="pill-btn" to="/guide">
                  {t("incidentDetails.actions.open")}
                </Link>
              </div>
            ))}
              {!incident.guides?.length && (
                <div className="guide-assignment-item">
                  <div>
                    <strong>{t("incidentDetails.states.noGuides")}</strong>
                    <div className="incident-meta">{t("incidentDetails.states.guidesHelp")}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="incident-card ops-card" data-tutorial="incident-details-timeline">
        <h2>{t("incidentDetails.sections.timeline")}</h2>
        <div className="incident-timeline">
          {(incident.timeline || []).slice().reverse().map((item, index) => (
            <div key={`${item.at}-${index}`} className="timeline-item">
              <strong>{item.message}</strong>
              <div className="incident-meta">
                {item.actorName || "System"} • {item.actorRole || "system"} •{" "}
                {item.at ? new Date(item.at).toLocaleString(locale) : ""}
              </div>
              {String(item.actorRole || "").toLowerCase() === "system" &&
              String(item.kind || "").toLowerCase() === "resolved" &&
              String(item.message || "").toLowerCase().includes("expir") ? (
                <div className="incident-meta incident-meta-accent">
                  {t("incidentDetails.states.autoClosed")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default IncidentDetailsPage;
