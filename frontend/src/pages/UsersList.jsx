// src/pages/UsersList.jsx
import { useEffect, useState } from "react";
import { API_URL } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";

const UsersList = () => {
  const { t, locale } = useLanguage();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/users`)
      .then((res) => res.json())
      .then((data) => {
        setUsers(data);
        setLoading(false);
      })
      .catch(() => {
        alert(t("legacy.users.loadError"));
        setLoading(false);
      });
  }, [t]);

  if (loading) return <h2>{t("legacy.users.loading")}</h2>;

  return (
    <div>
      <h1>{t("legacy.users.title", { count: users.length })}</h1>
      {users.length === 0 ? (
        <p>{t("legacy.users.empty")}</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr style={{ background: "#f1f1f1" }}>
              <th
                style={{
                  padding: "12px",
                  border: "1px solid #ccc",
                  textAlign: "left",
                }}
              >
                ID
              </th>
              <th
                style={{
                  padding: "12px",
                  border: "1px solid #ccc",
                  textAlign: "left",
                }}
              >
                Email
              </th>
              <th
                style={{
                  padding: "12px",
                  border: "1px solid #ccc",
                  textAlign: "left",
                }}
              >
                {t("legacy.users.registeredAt")}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={{ padding: "12px", border: "1px solid #ccc" }}>
                  {user.id}
                </td>
                <td style={{ padding: "12px", border: "1px solid #ccc" }}>
                  {user.email}
                </td>
                <td style={{ padding: "12px", border: "1px solid #ccc" }}>
                  {new Date(user.createdAt).toLocaleString(locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default UsersList;
