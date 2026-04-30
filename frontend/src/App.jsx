import { Suspense, lazy, useState, useEffect, useCallback, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./App.css";

import SignUpModal from "./components/modals/SignUpModal";
import LoginModal from "./components/modals/LoginModal";
import Header from "./components/layout/Header";
import MobileSidebar from "./components/layout/MobileSidebar";
import CrisisModeStrip from "./components/common/CrisisModeStrip";
import ToastHost from "./components/feedback/ToastHost";
import TutorialOverlay from "./components/tutorial/TutorialOverlay";
import { CrisisModeProvider } from "./context/CrisisModeContext";
import { AccessibilityProvider } from "./context/AccessibilityContext";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { resolveTutorialDefinition } from "./data/tutorials";
import useMediaQuery from "./hooks/useMediaQuery";
import useViewportTokens from "./hooks/useViewportTokens";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const CommunicationPage = lazy(() => import("./pages/CommunicationPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const SafetyPage = lazy(() => import("./pages/SafetyPage"));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage"));
const SOSEmergencyPage = lazy(() => import("./pages/SOSEmergencyPage"));
const IncidentDetailsPage = lazy(() => import("./pages/IncidentDetailsPage"));
const OperationsTasksPage = lazy(() => import("./pages/OperationsTasksPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const TrainingHistoryPage = lazy(() => import("./pages/TrainingHistoryPage"));

function RouteFallback() {
  const { t } = useLanguage();
  return (
    <section className="page-shell route-loading fade-in" aria-live="polite" aria-busy="true">
      <div className="route-loading-card glass">
        <span className="route-loading-pill">NeuralGuard</span>
        <h1>{t("app.routeLoading.title")}</h1>
        <p>{t("app.routeLoading.body")}</p>
      </div>
    </section>
  );
}

function AppContent() {
  const location = useLocation();
  const [showLogin, setShowLogin] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const isMobileView = useMediaQuery("(max-width: 1024px)");
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [tutorialPath, setTutorialPath] = useState("");
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useViewportTokens();

  useEffect(() => {
    const openSignUp = () => setShowSignUp(true);
    const openLogin = () => setShowLogin(true);

    window.addEventListener("openSignUpModal", openSignUp);
    window.addEventListener("openLoginModal", openLogin);

    return () => {
      window.removeEventListener("openSignUpModal", openSignUp);
      window.removeEventListener("openLoginModal", openLogin);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isMobileView) {
      document.documentElement.style.removeProperty("--header-height");
      return undefined;
    }

    document.documentElement.style.setProperty("--header-height", "0px");
    return () => {
      document.documentElement.style.removeProperty("--header-height");
    };
  }, [isMobileView]);

  const toggleTheme = useCallback((nextTheme) => {
    if (nextTheme === "light" || nextTheme === "dark") {
      setTheme(nextTheme);
      return;
    }
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  const tutorialDefinition = useMemo(
    () => resolveTutorialDefinition(location.pathname),
    [location.pathname],
  );

  const handleOpenTutorial = useCallback(() => {
    setTutorialStepIndex(0);
    setTutorialPath(location.pathname);
    setIsTutorialOpen(true);
  }, [location.pathname]);

  const isTutorialVisible = isTutorialOpen && tutorialPath === location.pathname;

  return (
    <LanguageProvider>
      <AccessibilityProvider>
        <CrisisModeProvider>
          <div className="main-content">
          {isMobileView ? (
            <MobileSidebar
              onLoginClick={() => setShowLogin(true)}
              onSignUpClick={() => setShowSignUp(true)}
              theme={theme}
              onToggleTheme={toggleTheme}
              onOpenTutorial={handleOpenTutorial}
            />
          ) : (
            <Header
              onLoginClick={() => setShowLogin(true)}
              onSignUpClick={() => setShowSignUp(true)}
              theme={theme}
              onToggleTheme={toggleTheme}
              isMobileView={isMobileView}
              onOpenTutorial={handleOpenTutorial}
            />
          )}

          <main className="page-content">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/communication" element={<CommunicationPage />} />
                <Route path="/guide" element={<GuidePage />} />
                <Route path="/incidents" element={<Navigate to="/map" replace />} />
                <Route path="/incidents/:incidentId" element={<IncidentDetailsPage />} />
                <Route path="/operations/tasks" element={<OperationsTasksPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/training" element={<TrainingHistoryPage />} />
                <Route path="/safety" element={<SafetyPage />} />
                <Route path="/sos" element={<SOSEmergencyPage />} />
                <Route path="/profile-settings" element={<ProfileSettingsPage />} />
              </Routes>
            </Suspense>
          </main>

          <CrisisModeStrip />
          </div>

          <TutorialOverlay
            isOpen={isTutorialVisible}
            tutorial={tutorialDefinition}
            stepIndex={tutorialStepIndex}
            onStepChange={setTutorialStepIndex}
            onClose={() => setIsTutorialOpen(false)}
          />

          <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
          <SignUpModal isOpen={showSignUp} onClose={() => setShowSignUp(false)} />
          <ToastHost />
        </CrisisModeProvider>
      </AccessibilityProvider>
    </LanguageProvider>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
