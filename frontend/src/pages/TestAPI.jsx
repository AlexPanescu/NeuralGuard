import { useApi } from "../hooks/useApi";
import { API_URL } from "../api/client";

  const TestAPI = () => {
  const { data: rawData, loading, error, refetch } = useApi("/api");
  const rawMessage =
    rawData && typeof rawData === "object" && "message" in rawData
      ? /** @type {Record<string, unknown>} */ (rawData)["message"]
      : undefined;

  const backendMessage = typeof rawMessage === "string" ? rawMessage : "Fara mesaj";

  return (
    <div
      style={{
        padding: "60px 40px",
        textAlign: "center",
        minHeight: "70vh",
        color: "var(--text-primary)",
        backgroundColor: "var(--bg-primary)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: "2.8rem",
          marginBottom: "40px",
          color: "var(--text-primary)",
          fontWeight: "600",
        }}
      >
        Test Conexiune Backend
      </h1>

      {loading && (
        <p style={{ fontSize: "1.3rem", color: "var(--text-secondary)" }}>
          Se incarca... Conectam la backend...
        </p>
      )}

      {error && (
        <div
          style={{
            background: "#f8d7da",
            color: "#721c24",
            padding: "20px",
            borderRadius: "8px",
            maxWidth: "600px",
            margin: "30px auto",
            fontSize: "1.2rem",
          }}
        >
          <strong>Eroare:</strong> {error}
          <button
            onClick={refetch}
            style={{
              marginLeft: "15px",
              padding: "8px 16px",
              background: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Incearca din nou
          </button>
        </div>
      )}

      {rawData && (
        <div
          style={{
            background: "#67e284",
            color: "#155724",
            padding: "30px",
            borderRadius: "12px",
            maxWidth: "700px",
            margin: "40px auto",
            fontSize: "1.3rem",
            boxShadow: "0 4px 15px rgba(0,0,0,0.05)",
          }}
        >
          <strong style={{ fontSize: "1.5rem" }}>Conexiune reusita!</strong>
          <br />
          <br />
          <strong>Mesaj de la backend:</strong> {backendMessage}
          <br />
          <br />
          <small style={{ color: "#155724" }}>
            URL backend: {API_URL}
          </small>
        </div>
      )}

      <button
        onClick={refetch}
        disabled={loading}
        style={{
          padding: "14px 30px",
          background: "#28a745",
          color: "white",
          border: "none",
          borderRadius: "8px",
          fontSize: "1.2rem",
          cursor: loading ? "not-allowed" : "pointer",
          marginTop: "20px",
        }}
      >
        {loading ? "Se incarca..." : "Reincarca testul"}
      </button>
    </div>
  );
};

export default TestAPI;
