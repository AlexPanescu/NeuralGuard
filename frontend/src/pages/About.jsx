const About = () => {
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
          marginBottom: "30px",
          color: "var(--text-primary)",
          fontWeight: "600",
        }}
      >
        Despre NeuralGuard
      </h1>

      <p
        style={{
          fontSize: "1.3rem",
          maxWidth: "800px",
          margin: "0 auto 30px",
          lineHeight: "1.8",
          color: "var(--text-secondary)",
        }}
      >
        Aceasta este o aplicatie full-stack moderna construita cu:
      </p>

      <ul
        style={{
          fontSize: "1.2rem",
          lineHeight: "2",
          color: "var(--text-primary)",
          maxWidth: "700px",
          margin: "0 auto 40px",
          textAlign: "left",
        }}
      >
        <li>
          <strong>Frontend:</strong> React 19 + Vite
        </li>
        <li>
          <strong>Backend:</strong> Express.js (Node.js)
        </li>
        <li>
          <strong>Autentificare:</strong> Sign Up / Sign In cu stocare in JSON
        </li>
        <li>
          <strong>Stiluri:</strong> CSS modern, responsive
        </li>
        <li>
          <strong>Functionalitati:</strong> Sidebar, Header, Modale, Hover Tabs
        </li>
      </ul>

      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          padding: "40px",
          borderRadius: "12px",
          maxWidth: "800px",
          margin: "0 auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
        }}
      >
        <p style={{ fontSize: "1.2rem", color: "var(--text-primary)", margin: 0 }}>
          NeuralGuard centralizeaza alertele, resursele si instrumentele de
          asistenta pentru utilizatorii autentificati.
        </p>
      </div>
    </div>
  );
};

export default About;
