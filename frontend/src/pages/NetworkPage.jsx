import { useEffect, useMemo, useState } from "react";
import apiClient from "../api/client";
import "../styles/pages/NetworkPage.css";

const STATUS_LABELS = {
  active: "Active",
  idle: "Idle",
  dnd: "DND",
  offline: "Offline",
};

function NetworkPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const loadNetworkUsers = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiClient.get("/api/network/users");
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      const serverError = err?.response?.data?.error;
      setError(serverError || "Nu am putut incarca lista de useri");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNetworkUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return users;

    return users.filter((user) => {
      const email = typeof user.email === "string" ? user.email.toLowerCase() : "";
      const username = typeof user.username === "string" ? user.username.toLowerCase() : "";
      return email.includes(normalizedQuery) || username.includes(normalizedQuery);
    });
  }, [query, users]);

  return (
    <div className="page-shell network-page-shell">
      <section className="surface-card network-card">
        <div className="network-head">
          <div>
            <h1>Network</h1>
            <p>Lista tuturor utilizatorilor si statusul lor curent.</p>
          </div>
          <div className="network-tools">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by email or username"
              className="network-search"
            />
            <button type="button" className="network-refresh" onClick={loadNetworkUsers}>
              Refresh
            </button>
          </div>
        </div>

        {loading && <p className="network-state">Loading users...</p>}
        {!loading && error && <p className="network-state network-error">{error}</p>}

        {!loading && !error && (
          <div className="network-grid">
            {filteredUsers.map((user) => {
              const status = STATUS_LABELS[user.presenceStatus] ? user.presenceStatus : "active";
              const label = STATUS_LABELS[status];
              const notificationsLabel = user.notificationsEnabled ? "Notifications ON" : "Notifications OFF";
              const rawRole =
                typeof user.role === "string"
                  ? user.role
                  : typeof user.user_role === "string"
                    ? user.user_role
                    : "";
              const roleLabel = rawRole
                ? rawRole.trim().charAt(0).toUpperCase() + rawRole.trim().slice(1)
                : "Customer";
              const avatarSrc = user.profilePicture
                ? user.profilePicture
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    user.email || user.username || "User",
                  )}&background=3b82f6&color=fff&bold=true&size=128`;

              return (
                <article key={user.id || user.email} className="network-user-card">
                  <div className="network-user-head">
                    <div className="network-avatar-wrap">
                      <img src={avatarSrc} alt="Avatar" className="network-avatar" />
                      <span className={`network-status-dot network-status-dot-${status}`} />
                    </div>
                    <div className="network-user-meta">
                      <h2>{user.username || "User"}</h2>
                      <p className="network-user-role">{roleLabel}</p>
                      <p>{user.email || "No email"}</p>
                    </div>
                  </div>

                  <div className="network-user-tags">
                    <span className={`network-tag network-tag-${status}`}>{label}</span>
                    <span className="network-tag network-tag-neutral">{notificationsLabel}</span>
                    <span className="network-tag network-tag-neutral">
                      Theme: {user.theme === "dark" ? "Dark" : "Light"}
                    </span>
                  </div>
                </article>
              );
            })}
            {!filteredUsers.length && <p className="network-state">No users found for this filter.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

export default NetworkPage;
