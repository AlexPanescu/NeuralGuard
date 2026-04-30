import { useEffect } from "react";
import "../styles/pages/Home.css";

const Home = () => {
  useEffect(() => {
    const currentUser = localStorage.getItem("currentUser");
    const hasSeenModal = localStorage.getItem("hasSeenSignUpModal");

    if (!currentUser && !hasSeenModal) {
      window.dispatchEvent(new Event("openSignUpModal"));
      localStorage.setItem("hasSeenSignUpModal", "true");
    }
  }, []);

  return (
    <section className="page-shell home-page">
      <div className="surface-card">
        <h1>Bine ai venit in NeuralGuard</h1>
        <p>Exploreaza meniul din stanga pentru toate functionalitatile disponibile.</p>
        <p className="home-intro">Autentificarea este activa, iar datele tale sunt incarcate local.</p>

        <div className="home-highlight">
          <p>Administreaza rapid alertele, resursele si recomandarile de siguranta dintr-un singur loc.</p>
        </div>
      </div>
    </section>
  );
};

export default Home;
