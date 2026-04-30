import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import dashboardData from "../data/dashboardData";
import useReveal from "../hooks/useReveal";
import useMediaQuery from "../hooks/useMediaQuery";
import useDocumentScrollLock from "../hooks/useDocumentScrollLock";
import { useCrisisMode } from "../context/CrisisModeContext";
import { useLanguage } from "../i18n/LanguageContext";
import NewsCard, { NewsCardSkeleton } from "../components/common/NewsCard";
import NewsDetailsModal from "../components/common/NewsDetailsModal";
import {
  normalizeLegacyNewsItem,
  normalizeNewsItem,
} from "../utils/newsPresentation";
import { OFFLINE_GUIDE_INDEX_KEY, readJsonStorage } from "../utils/crisisMode";
import "../styles/pages/DashboardPage.css";

const PREPAREDNESS_STORAGE_KEY = "dashboardPreparednessState";
const MAP_LOCATION_LOCAL_KEY = "mapSavedLocation";

function formatTimestamp(value, locale = "en-US", fallback = "Unknown") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function riskLevelTone(level) {
  switch (String(level || "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "elevated":
      return "elevated";
    default:
      return "guarded";
  }
}

function getSavedLocationLabel(t) {
  const saved = readJsonStorage(MAP_LOCATION_LOCAL_KEY, null);
  return saved?.name || saved?.raw || t("dashboard.fallback.noSavedLocation");
}

function countCachedGuides() {
  const cached = readJsonStorage(OFFLINE_GUIDE_INDEX_KEY, []);
  if (!Array.isArray(cached)) return 0;
  return cached.reduce((total, category) => {
    const situations = Array.isArray(category?.situations) ? category.situations : [];
    return total + situations.reduce((sum, situation) => {
      const subcategories = Array.isArray(situation?.subcategories) ? situation.subcategories : [];
      return sum + subcategories.length;
    }, 0);
  }, 0);
}

function scoreTone(score) {
  if (score >= 76) return "critical";
  if (score >= 56) return "high";
  if (score >= 36) return "elevated";
  return "guarded";
}

function directionLabel(direction, t) {
  if (direction === "up") return t("dashboard.direction.escalating");
  if (direction === "down") return t("dashboard.direction.decreasing");
  return t("dashboard.direction.stable");
}

function progressStyle(score) {
  return {
    "--progress-target": `${Math.max(6, Math.min(100, score))}%`,
  };
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncPreference);
      return () => mediaQuery.removeEventListener("change", syncPreference);
    }

    mediaQuery.addListener(syncPreference);
    return () => mediaQuery.removeListener(syncPreference);
  }, []);

  return prefersReducedMotion;
}

function useCountUp(target, options = {}) {
  const { duration = 950, startWhen = true, disabled = false } = options;
  const finalValue = Number(target) || 0;
  const [value, setValue] = useState(finalValue);

  useEffect(() => {
    if (!startWhen || disabled) return undefined;

    let rafId = 0;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(finalValue * eased));
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [disabled, duration, finalValue, startWhen]);

  return !startWhen || disabled ? finalValue : value;
}

function normalizeSituationPayload(payload, t) {
  const raw = payload && typeof payload === "object" ? payload : {};
  const liveRiskFactors = Array.isArray(raw.liveRiskFactors)
    ? raw.liveRiskFactors
        .map((item) => ({
          id: String(item.id || ""),
          category: String(item.category || "").trim() || t("dashboard.fallback.unknown"),
          score: Number(item.score) || 0,
          status: String(item.status || t("dashboard.fallback.low")).trim() || t("dashboard.fallback.low"),
          detail: String(item.detail || "").trim() || t("dashboard.fallback.noDetails"),
          scope: String(item.scope || "").trim(),
          contributors: Array.isArray(item.contributors)
            ? item.contributors
                .slice(0, 3)
                .map((contributor) => ({
                  signalId: String(contributor.signalId || contributor.id || ""),
                  summary: String(contributor.summary || contributor.detail || "").trim(),
                  source: String(contributor.source || "").trim(),
                  score: Number(contributor.score) || 0,
                }))
                .filter((contributor) =>
                  contributor.summary &&
                  !/classified as|average evidence strength|web:[^\s]+ contributes/i.test(contributor.summary),
                )
            : [],
        }))
        .filter((item) => item.id)
    : [];

  const nearby = raw.nearby && typeof raw.nearby === "object"
    ? {
        currentLocation: String(raw.nearby.currentLocation || "").trim() || t("dashboard.fallback.unknownLocation"),
        heatZones: String(raw.nearby.heatZones || "").trim() || t("dashboard.fallback.noHeatZoneDetails"),
        incidents: Array.isArray(raw.nearby.incidents)
          ? raw.nearby.incidents
              .map((item) => ({
                id: String(item.id || ""),
                title: String(item.title || "").trim() || t("dashboard.fallback.untitledIncident"),
                distance: String(item.distance || "").trim() || t("dashboard.fallback.unknown"),
                severity: String(item.severity || "").trim() || t("dashboard.fallback.low"),
              }))
              .filter((item) => item.id)
          : [],
      }
    : null;

  const citizenStats = Array.isArray(raw.citizenStats)
    ? raw.citizenStats
        .map((item) => ({
          id: String(item.id || ""),
          label: String(item.label || "").trim() || t("dashboard.fallback.metric"),
          value: String(item.value || "").trim() || t("dashboard.fallback.notAvailable"),
          context: String(item.context || "").trim() || t("dashboard.fallback.noContext"),
          direction: String(item.direction || "steady").trim() || "steady",
        }))
        .filter((item) => item.id)
    : [];

  return {
    liveRiskFactors,
    nearby,
    citizenStats,
  };
}

function buildQuickLinks(t) {
  return [
    { label: t("dashboard.quickLinks.map"), route: "/map" },
    { label: t("dashboard.quickLinks.safety"), route: "/safety" },
    { label: t("dashboard.quickLinks.communication"), route: "/communication" },
  ];
}

function buildPreparednessPlaybook(t) {
  return [
  {
    id: "inventory",
    rank: "01",
    window: t("dashboard.preparedness.inventoryWindow"),
    title: t("dashboard.preparedness.inventoryTitle"),
    intro: t("dashboard.preparedness.inventoryIntro"),
    checklist: [
      {
        label: t("dashboard.preparedness.waterLabel"),
        detail: t("dashboard.preparedness.waterDetail"),
      },
      {
        label: t("dashboard.preparedness.foodLabel"),
        detail: t("dashboard.preparedness.foodDetail"),
      },
      {
        label: t("dashboard.preparedness.lightLabel"),
        detail: t("dashboard.preparedness.lightDetail"),
      },
    ],
  },
  {
    id: "essentials",
    rank: "02",
    window: t("dashboard.preparedness.essentialsWindow"),
    title: t("dashboard.preparedness.essentialsTitle"),
    checklist: [
      {
        label: t("dashboard.preparedness.medicationLabel"),
        detail: t("dashboard.preparedness.medicationDetail"),
      },
      {
        label: t("dashboard.preparedness.hygieneLabel"),
        detail: t("dashboard.preparedness.hygieneDetail"),
      },
      {
        label: t("dashboard.preparedness.firstAidLabel"),
        detail: t("dashboard.preparedness.firstAidDetail"),
      },
    ],
  },
  {
    id: "information",
    rank: "03",
    window: t("dashboard.preparedness.informationWindow"),
    title: t("dashboard.preparedness.informationTitle"),
    checklist: [
      {
        label: t("dashboard.preparedness.digitalCopiesLabel"),
        detail: t("dashboard.preparedness.digitalCopiesDetail"),
      },
      {
        label: t("dashboard.preparedness.paperBackupLabel"),
        detail: t("dashboard.preparedness.paperBackupDetail"),
      },
      {
        label: t("dashboard.preparedness.cashLabel"),
        detail: t("dashboard.preparedness.cashDetail"),
      },
    ],
  },
  {
    id: "communication",
    rank: "04",
    window: t("dashboard.preparedness.communicationWindow"),
    title: t("dashboard.preparedness.communicationTitle"),
    checklist: [
      {
        label: t("dashboard.preparedness.chargeLabel"),
        detail: t("dashboard.preparedness.chargeDetail"),
      },
      {
        label: t("dashboard.preparedness.meetingPointLabel"),
        detail: t("dashboard.preparedness.meetingPointDetail"),
      },
      {
        label: t("dashboard.preparedness.goldenRuleLabel"),
        detail: t("dashboard.preparedness.goldenRuleDetail"),
      },
    ],
  },
  ];
}

function buildDriverFallback(t) {
  return {
    locationReady: true,
    riskStatus: {
      ...dashboardData.riskStatus,
      summary: t("dashboard.fallbackData.riskSummary"),
      locationLabel: t("dashboard.fallbackData.locationLabel"),
      confidence: t("dashboard.fallbackData.confidence"),
      trend: t("dashboard.fallbackData.trend"),
    },
    riskDrivers: [
      {
        ...dashboardData.riskDrivers[0],
        label: t("dashboard.fallbackData.driverPolitical"),
        explanation: t("dashboard.fallbackData.driverPoliticalText"),
      },
      {
        ...dashboardData.riskDrivers[1],
        label: t("dashboard.fallbackData.driverMobility"),
        explanation: t("dashboard.fallbackData.driverMobilityText"),
      },
      {
        ...dashboardData.riskDrivers[2],
        label: t("dashboard.fallbackData.driverSafety"),
        explanation: t("dashboard.fallbackData.driverSafetyText"),
      },
      {
        ...dashboardData.riskDrivers[3],
        label: t("dashboard.fallbackData.driverWeather"),
        explanation: t("dashboard.fallbackData.driverWeatherText"),
      },
    ],
    riskExplanation: null,
    scoringMeta: {
      incidentsUsed: 0,
      newsUsed: 0,
      lastComputedAt: dashboardData.riskStatus.lastUpdated,
    },
  };
}

function buildSituationFallback(t) {
  return {
    liveRiskFactors: [
      {
        ...dashboardData.riskFactors[0],
        category: t("dashboard.fallbackData.factorPolitical"),
        status: t("dashboard.fallbackData.factorPoliticalStatus"),
        detail: t("dashboard.fallbackData.factorPoliticalDetail"),
      },
      {
        ...dashboardData.riskFactors[1],
        category: t("dashboard.fallbackData.factorEconomy"),
        status: t("dashboard.fallbackData.factorEconomyStatus"),
        detail: t("dashboard.fallbackData.factorEconomyDetail"),
      },
      {
        ...dashboardData.riskFactors[2],
        category: t("dashboard.fallbackData.factorConflict"),
        status: t("dashboard.fallbackData.factorConflictStatus"),
        detail: t("dashboard.fallbackData.factorConflictDetail"),
      },
      {
        ...dashboardData.riskFactors[3],
        category: t("dashboard.fallbackData.factorInfrastructure"),
        status: t("dashboard.fallbackData.factorInfrastructureStatus"),
        detail: t("dashboard.fallbackData.factorInfrastructureDetail"),
      },
      {
        ...dashboardData.riskFactors[4],
        category: t("dashboard.fallbackData.factorSystem"),
        status: t("dashboard.fallbackData.factorSystemStatus"),
        detail: t("dashboard.fallbackData.factorSystemDetail"),
      },
    ],
    nearby: {
      ...dashboardData.nearby,
      currentLocation: t("dashboard.fallbackData.nearbyLocation"),
      heatZones: t("dashboard.fallbackData.heatZones"),
      incidents: [
        { ...dashboardData.nearby.incidents[0], title: t("dashboard.fallbackData.nearbyCrowd") },
        { ...dashboardData.nearby.incidents[1], title: t("dashboard.fallbackData.nearbyCheckpoint") },
        { ...dashboardData.nearby.incidents[2], title: t("dashboard.fallbackData.nearbyTransit") },
      ],
    },
    citizenStats: [
      {
        ...dashboardData.citizenStats[0],
        label: t("dashboard.fallbackData.crowdDensity"),
        value: t("dashboard.fallbackData.crowdDensityValue"),
        context: t("dashboard.fallbackData.crowdDensityContext"),
      },
      {
        ...dashboardData.citizenStats[1],
        label: t("dashboard.fallbackData.policePresence"),
        value: t("dashboard.fallbackData.policePresenceValue"),
        context: t("dashboard.fallbackData.policePresenceContext"),
      },
      {
        ...dashboardData.citizenStats[2],
        label: t("dashboard.fallbackData.networkResilience"),
        value: t("dashboard.fallbackData.networkResilienceValue"),
        context: t("dashboard.fallbackData.networkResilienceContext"),
      },
      {
        ...dashboardData.citizenStats[3],
        label: t("dashboard.fallbackData.economicPulse"),
        value: t("dashboard.fallbackData.economicPulseValue"),
        context: t("dashboard.fallbackData.economicPulseContext"),
      },
    ],
  };
}

const DASHBOARD_NEWS_FALLBACK = (Array.isArray(dashboardData.news) ? dashboardData.news : [])
  .map((item) => normalizeLegacyNewsItem({ ...item, isFallback: true }))
  .filter(Boolean)
  .filter((item) => item.id);

const RevealBlock = ({
  as = "div",
  className = "",
  delay = 0,
  reducedMotion = false,
  threshold,
  children,
  style,
  ...rest
}) => {
  const { ref, isVisible } = useReveal({
    disabled: reducedMotion,
    threshold: threshold ?? 0.16,
  });
  const Component = as;
  const revealStyle = {
    ...style,
    "--reveal-delay": `${delay}ms`,
  };

  return (
    <Component
      ref={ref}
      className={`reveal-block ${isVisible ? "is-visible" : ""} ${className}`.trim()}
      style={revealStyle}
      {...rest}
    >
      {children}
    </Component>
  );
};

const DashboardPage = () => {
  const navigate = useNavigate();
  const { t, locale, language } = useLanguage();
  const reducedMotion = usePrefersReducedMotion();
  const isCompactMobile = useMediaQuery("(max-width: 860px)");
  const { isLowData, isOffline, isOfflineReady, markCriticalSync } = useCrisisMode();
  const driverFallback = useMemo(() => buildDriverFallback(t), [t]);
  const situationFallback = useMemo(() => buildSituationFallback(t), [t]);
  const quickLinks = useMemo(() => buildQuickLinks(t), [t]);
  const preparednessPlaybook = useMemo(() => buildPreparednessPlaybook(t), [t]);
  const [driverData, setDriverData] = useState(driverFallback);
  const [situationData, setSituationData] = useState(() =>
    normalizeSituationPayload(situationFallback, t),
  );
  const [riskLoading, setRiskLoading] = useState(true);
  const [newsItems, setNewsItems] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");
  const [newsUsingFallback, setNewsUsingFallback] = useState(false);
  const [riskDataState, setRiskDataState] = useState("fallback");
  const [situationDataState, setSituationDataState] = useState("fallback");
  const [newsReloadKey, setNewsReloadKey] = useState(0);
  const [selectedNews, setSelectedNews] = useState(null);
  const [newsDetailLoading, setNewsDetailLoading] = useState(false);
  const [activePreparednessIndex, setActivePreparednessIndex] = useState(0);
  const [preparednessChecks, setPreparednessChecks] = useState({});
  const [preparednessHydrated, setPreparednessHydrated] = useState(false);
  const [scoreCanAnimate, setScoreCanAnimate] = useState(false);
  const savedLocationLabel = useMemo(() => getSavedLocationLabel(t), [t]);
  const [offlineGuideCount] = useState(countCachedGuides);

  useDocumentScrollLock(Boolean(selectedNews));

  useEffect(() => {
    let mounted = true;

    const loadRisk = async () => {
      try {
        const response = await apiClient.get("/api/dashboard/personal-risk");
        if (!mounted) return;
        const payload = response.data || {};
        setDriverData({
          locationReady: Boolean(payload.locationReady),
          riskStatus: payload.riskStatus || driverFallback.riskStatus,
          riskDrivers: Array.isArray(payload.riskDrivers) && payload.riskDrivers.length
            ? payload.riskDrivers
            : driverFallback.riskDrivers,
          riskExplanation: payload.riskExplanation || null,
          scoringMeta: payload.scoringMeta || driverFallback.scoringMeta,
        });
        setRiskDataState("live");
        markCriticalSync();
      } catch {
        if (!mounted) return;
        setDriverData(driverFallback);
        setRiskDataState(isOffline ? "offline" : "fallback");
      } finally {
        if (mounted) setRiskLoading(false);
      }
    };

    loadRisk();
    return () => {
      mounted = false;
    };
  }, [driverFallback, isOffline, markCriticalSync]);

  useEffect(() => {
    let mounted = true;
    const loadSituation = async () => {
      try {
        const response = await apiClient.get("/api/dashboard/situation");
        if (!mounted) return;
        const parsed = normalizeSituationPayload(response.data, t);
        const hasLiveData =
          parsed.liveRiskFactors.length > 0 &&
          parsed.nearby &&
          parsed.citizenStats.length > 0;
        if (hasLiveData) {
          setSituationData(parsed);
          setSituationDataState("live");
          markCriticalSync();
        } else {
          setSituationData(
            normalizeSituationPayload({
              ...situationFallback,
            }, t),
          );
          setSituationDataState("fallback");
        }
      } catch {
        if (!mounted) return;
        setSituationData(
          normalizeSituationPayload({
          ...situationFallback,
        }, t),
        );
        setSituationDataState(isOffline ? "offline" : "fallback");
      }
    };

    loadSituation();
    return () => {
      mounted = false;
    };
  }, [isOffline, markCriticalSync, situationFallback, t]);

  useEffect(() => {
    if (riskDataState !== "live") {
      setDriverData(driverFallback);
    }
    if (situationDataState !== "live") {
      setSituationData(normalizeSituationPayload(situationFallback, t));
    }
  }, [driverFallback, riskDataState, situationDataState, situationFallback, t]);

  useEffect(() => {
    let mounted = true;

    const loadNews = async () => {
      setNewsLoading(true);
      setNewsError("");
      setNewsUsingFallback(false);
      try {
        const response = await apiClient.get("/api/dashboard/news", {
          params: { limit: 24, lang: language },
        });
        if (!mounted) return;
        const rows = Array.isArray(response.data) ? response.data : [];
        const parsed = rows.map(normalizeNewsItem).filter(Boolean).filter((item) => item.id);
        if (parsed.length) {
          setNewsItems(parsed);
          setNewsUsingFallback(false);
          markCriticalSync();
        } else {
          setNewsItems(DASHBOARD_NEWS_FALLBACK);
          setNewsUsingFallback(true);
        }
      } catch (error) {
        if (!mounted) return;
        const status = error?.response?.status;
        if (status === 404) {
          try {
            const fallbackResponse = await apiClient.get("/api/dashboard/intelligence", {
              params: { limit: 24 },
            });
            if (!mounted) return;
            const fallbackRows = Array.isArray(fallbackResponse.data?.news)
              ? fallbackResponse.data.news
              : [];
            const fallbackParsed = fallbackRows
              .map(normalizeLegacyNewsItem)
              .filter(Boolean)
              .filter((item) => item.id);
            if (fallbackParsed.length) {
              setNewsItems(fallbackParsed);
              setNewsUsingFallback(false);
              markCriticalSync();
            } else {
              setNewsItems(DASHBOARD_NEWS_FALLBACK);
              setNewsUsingFallback(true);
            }
            setNewsError("");
          } catch {
            if (!mounted) return;
            setNewsItems(DASHBOARD_NEWS_FALLBACK);
            setNewsUsingFallback(true);
            setNewsError("");
          }
        } else {
          setNewsItems(DASHBOARD_NEWS_FALLBACK);
          setNewsUsingFallback(true);
          setNewsError("");
        }
      } finally {
        if (mounted) setNewsLoading(false);
      }
    };

    loadNews();
    return () => {
      mounted = false;
    };
  }, [language, markCriticalSync, newsReloadKey]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREPAREDNESS_STORAGE_KEY);
      if (!stored) {
        setPreparednessHydrated(true);
        return;
      }
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        if (parsed.checks && typeof parsed.checks === "object" && !Array.isArray(parsed.checks)) {
          const normalizedChecks = Object.fromEntries(
            Object.entries(parsed.checks).map(([key, value]) => [String(key), Boolean(value)]),
          );
          setPreparednessChecks(normalizedChecks);
        }
        if (Number.isInteger(parsed.activeIndex) && parsed.activeIndex >= 0 && parsed.activeIndex < preparednessPlaybook.length) {
          setActivePreparednessIndex(parsed.activeIndex);
        }
      }
    } catch {
      // ignore malformed local state
    } finally {
      setPreparednessHydrated(true);
    }
  }, [preparednessPlaybook.length]);

  useEffect(() => {
    if (!preparednessHydrated) return;
    try {
      localStorage.setItem(
        PREPAREDNESS_STORAGE_KEY,
        JSON.stringify({
          activeIndex: activePreparednessIndex,
          checks: preparednessChecks,
        }),
      );
    } catch {
      // ignore storage errors
    }
  }, [activePreparednessIndex, preparednessChecks, preparednessHydrated]);

  const isRiskPending = riskLoading;
  const isRiskUnavailable = !riskLoading && riskDataState !== "live";
  const shouldMaskRiskStatus = isRiskPending || isRiskUnavailable;
  const riskStatus = driverData.riskStatus || driverFallback.riskStatus;
  const displayedRiskStatus = shouldMaskRiskStatus
    ? {
        ...riskStatus,
        level: isRiskPending ? t("dashboard.hero.loadingLevel") : t("dashboard.hero.unavailableLevel"),
        score: 0,
        trend: isRiskPending ? t("dashboard.hero.loadingTrend") : t("dashboard.hero.unavailableTrend"),
        summary: isRiskPending ? t("dashboard.hero.loadingSummary") : t("dashboard.hero.unavailableSummary"),
        lastUpdated: null,
        locationLabel: isRiskPending ? t("dashboard.hero.loadingLocation") : t("dashboard.hero.unavailableLocation"),
        confidence: isRiskPending ? t("dashboard.hero.loadingConfidence") : t("dashboard.hero.unavailableConfidence"),
      }
    : riskStatus;
  const riskDrivers = driverData.riskDrivers || driverFallback.riskDrivers;
  const riskExplanation = driverData.riskExplanation || null;
  const explanationReasons = Array.isArray(riskExplanation?.mainReasons)
    ? riskExplanation.mainReasons
    : [];
  const riskFactors = situationData.liveRiskFactors || [];
  const liveRiskScore = useCountUp(displayedRiskStatus.score, {
    startWhen: scoreCanAnimate && !isRiskPending,
    disabled: reducedMotion,
  });

  const heroStats = useMemo(
    () => [
      {
        label: t("dashboard.hero.riskScore"),
        value: shouldMaskRiskStatus
          ? (isRiskPending ? t("dashboard.hero.loadingScore") : t("dashboard.hero.unavailableScore"))
          : `${displayedRiskStatus.score}/100`,
      },
      { label: t("dashboard.hero.trend"), value: displayedRiskStatus.trend },
      { label: t("dashboard.hero.confidence"), value: displayedRiskStatus.confidence },
      {
        label: t("dashboard.hero.updated"),
        value: shouldMaskRiskStatus
          ? (isRiskPending ? t("dashboard.hero.loadingUpdated") : t("dashboard.hero.unavailableUpdated"))
          : formatTimestamp(displayedRiskStatus.lastUpdated, locale, t("dashboard.fallback.unknown")),
        isLive: true,
      },
    ],
    [displayedRiskStatus, isRiskPending, locale, shouldMaskRiskStatus, t],
  );

  useEffect(() => {
    if (riskLoading || scoreCanAnimate) return;
    setScoreCanAnimate(true);
  }, [riskLoading, scoreCanAnimate]);

  const openNewsModal = async (item) => {
    setSelectedNews(item);
    setNewsDetailLoading(true);
    try {
      const response = await apiClient.get(`/api/dashboard/news/${item.id}`, {
        params: { lang: language },
      });
      const detail = normalizeNewsItem(response.data);
      if (!detail) return;
      setSelectedNews(detail);
    } catch {
      setSelectedNews((prev) => ({
        ...(prev || item),
        content: prev?.content || "",
      }));
    } finally {
      setNewsDetailLoading(false);
    }
  };

  const closeNewsModal = () => {
    setSelectedNews(null);
    setNewsDetailLoading(false);
  };

  const activePreparedness = preparednessPlaybook[activePreparednessIndex] || preparednessPlaybook[0];
  const offlineEssentialActions = preparednessPlaybook.flatMap((step) => step.checklist).slice(0, 3);
  const dashboardUsesFallback =
    riskDataState !== "live" || situationDataState !== "live" || newsUsingFallback || isOffline || isOfflineReady;
  const heroSummary = useMemo(() => {
    const rawSummary = String(displayedRiskStatus.summary || "").trim();
    if (!isCompactMobile || !rawSummary) return rawSummary;

    const compactChunks = rawSummary
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (compactChunks.length <= 1) return rawSummary;
    return compactChunks.slice(0, 2).join(" ");
  }, [displayedRiskStatus.summary, isCompactMobile]);
  const hasRenderableNews = !newsLoading && newsItems.length > 0;

  const setPreparednessItemChecked = (stepId, itemLabel, checked) => {
    const key = `${stepId}:${itemLabel}`;
    setPreparednessChecks((prev) => ({
      ...prev,
      [key]: Boolean(checked),
    }));
  };

  return (
    <section className="page-shell dashboard-page dashboard-wow fade-in mobile-shell">
      <RevealBlock as="section" className="dashboard-hero dashboard-hero-reveal" threshold={0.05} reducedMotion={reducedMotion} data-tutorial="dashboard-hero">
        <div className="dashboard-cinema-layers" aria-hidden="true">
          <span className="dashboard-cinema-orb cinema-orb-a" />
          <span className="dashboard-cinema-sweep" />
        </div>
        <div className="dashboard-hero-copy reveal-stagger" data-tutorial="dashboard-hero-overview">
          <span className="dashboard-eyebrow hero-reveal-item" style={{ "--stagger-index": 0 }}>{t("dashboard.hero.eyebrow")}</span>
          <h1 className="hero-reveal-item" style={{ "--stagger-index": 1 }}>{t("dashboard.hero.title")}</h1>
          <p className="dashboard-hero-summary hero-reveal-item" style={{ "--stagger-index": 2 }}>{heroSummary}</p>

          <div className="dashboard-hero-actions hero-reveal-item" style={{ "--stagger-index": 3 }}>
            <button type="button" className="dashboard-primary-btn" onClick={() => navigate("/map")}>
              {t("dashboard.hero.viewMap")}
            </button>
            <button type="button" className="dashboard-secondary-btn" onClick={() => navigate("/guide")}>
              {t("dashboard.hero.openGuide")}
            </button>
          </div>

          <div className="dashboard-quick-links hero-reveal-item" style={{ "--stagger-index": 4 }} aria-label={t("dashboard.hero.quickLinks")}>
            {quickLinks.map((item) => (
              <button key={item.label} type="button" className="dashboard-quick-link" onClick={() => navigate(item.route)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="risk-status-card hero-reveal-item" style={{ "--stagger-index": 5 }} data-tutorial="dashboard-risk-card">
          <div className="risk-status-topline">
            <span className="dashboard-eyebrow">{t("dashboard.hero.mySituation")}</span>
            <span className={`status-pill live-pill ${riskLevelTone(displayedRiskStatus.level)}`}>{displayedRiskStatus.level}</span>
          </div>

          <h2>
            {shouldMaskRiskStatus
              ? (isRiskPending ? t("dashboard.hero.loadingTitle") : t("dashboard.hero.unavailableTitle"))
              : t("dashboard.hero.riskLevel", { level: displayedRiskStatus.level })}
          </h2>
          <p>{displayedRiskStatus.locationLabel || t("dashboard.hero.noLocation")}</p>

          <div className="risk-score-ring">
            <div className={`risk-score-core ${scoreTone(displayedRiskStatus.score)} ${shouldMaskRiskStatus ? "is-loading" : ""}`.trim()}>
              <strong>
                {shouldMaskRiskStatus
                  ? (isRiskPending ? t("dashboard.hero.loadingScore") : t("dashboard.hero.unavailableScore"))
                  : liveRiskScore}
              </strong>
              <span>{t("dashboard.hero.overall")}</span>
            </div>
          </div>

          <div className="hero-stats-grid">
            {heroStats.map((item) => (
              <div key={item.label} className={`hero-stat-card ${item.isLive ? "hero-stat-live" : ""}`}>
                <span>{item.label}</span>
                <strong className={item.isLive ? "live-timestamp" : ""}>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </RevealBlock>

      {!driverData.locationReady && !riskLoading ? (
        <RevealBlock as="section" className="dashboard-card dashboard-banner-card" reducedMotion={reducedMotion}>
          <div className="section-heading">
            <div>
              <span className="dashboard-eyebrow">{t("dashboard.locationBanner.eyebrow")}</span>
              <h2>{t("dashboard.locationBanner.title")}</h2>
            </div>
            <button type="button" className="inline-cta" onClick={() => navigate("/map")}>
              {t("dashboard.locationBanner.action")}
            </button>
          </div>
          <p className="dashboard-banner-copy">
            {t("dashboard.locationBanner.body")}
          </p>
        </RevealBlock>
      ) : null}

      <RevealBlock
        as="section"
        className="dashboard-card offline-essentials-card"
        reducedMotion={reducedMotion}
        data-tutorial="dashboard-offline-essentials"
      >
        <div className="section-heading">
          <div>
            <span className="dashboard-eyebrow">{t("dashboard.offline.eyebrow")}</span>
            <h2>{t("dashboard.offline.title")}</h2>
          </div>
          <button type="button" className="inline-cta" onClick={() => navigate("/sos")}>
            SOS
          </button>
        </div>
        <div className="offline-essentials-grid">
          <div>
            <span>{t("dashboard.offline.savedLocation")}</span>
            <strong>{savedLocationLabel}</strong>
          </div>
          <div>
            <span>{t("dashboard.offline.guideCache")}</span>
            <strong>{offlineGuideCount ? t("dashboard.offline.localTopics", { count: offlineGuideCount }) : t("dashboard.offline.fallbackReady")}</strong>
          </div>
          <div>
            <span>{t("dashboard.offline.dataState")}</span>
            <strong>{dashboardUsesFallback ? t("dashboard.offline.fallbackVisible") : t("dashboard.offline.live")}</strong>
          </div>
        </div>
        <ul className="offline-essentials-list">
          {offlineEssentialActions.map((item) => (
            <li key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
        <div className="offline-essentials-actions">
          <button type="button" onClick={() => navigate("/map")}>{t("dashboard.offline.openMap")}</button>
          <button type="button" onClick={() => navigate("/guide")}>{t("dashboard.offline.openGuide")}</button>
        </div>
      </RevealBlock>

      <section className="dashboard-grid dashboard-top-grid">
        <RevealBlock as="article" className="dashboard-card actions-card top-fold-card cinematic-card" reducedMotion={reducedMotion} data-tutorial="dashboard-preparedness">
          <div className="section-heading">
            <div>
              <span className="dashboard-eyebrow">{t("dashboard.actions.eyebrow")}</span>
              <h2>{t("dashboard.actions.title")}</h2>
            </div>
          </div>

          <div className="preparedness-tabs" role="tablist" aria-label={t("dashboard.actions.aria")}>
            {preparednessPlaybook.map((step, index) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={index === activePreparednessIndex}
                aria-pressed={index === activePreparednessIndex}
                className={`preparedness-tab ${index === activePreparednessIndex ? "is-active" : ""}`}
                onClick={() => setActivePreparednessIndex(index)}
              >
                {step.rank}
              </button>
            ))}
          </div>

          <div className="preparedness-stage">
            <div
              key={activePreparedness.id}
              className={`action-card preparedness-card preparedness-active-card preparedness-${activePreparedness.id}`}
            >
              <div className="preparedness-scroll">
                <div className="action-rank">{activePreparedness.rank}</div>
                <div className="action-copy">
                  <span>{activePreparedness.window}</span>
                  <strong>{activePreparedness.title}</strong>
                  {activePreparedness.intro ? <p>{activePreparedness.intro}</p> : null}
                  <ul className="preparedness-list">
                    {activePreparedness.checklist.map((item, index) => (
                      <li key={`${activePreparedness.id}-${item.label}`} style={{ "--stagger-index": index }}>
                        <label className="preparedness-checkline">
                          <input
                            type="checkbox"
                            className="preparedness-checkbox"
                            checked={Boolean(preparednessChecks[`${activePreparedness.id}:${item.label}`])}
                            onChange={(event) =>
                              setPreparednessItemChecked(activePreparedness.id, item.label, event.target.checked)
                            }
                          />
                          <span>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </RevealBlock>

        <RevealBlock
          as="article"
          className={`dashboard-card news-card top-fold-card cinematic-card ${!newsLoading && !newsItems.length ? "is-empty" : ""}`.trim()}
          reducedMotion={reducedMotion}
          data-tutorial="dashboard-news"
        >
          <div className="section-heading">
            <div>
              <span className="dashboard-eyebrow">{t("dashboard.news.eyebrow")}</span>
              <h2>{t("dashboard.news.title")}</h2>
            </div>
          </div>

          {newsUsingFallback ? (
            <p className="news-inline-status" aria-live="polite">
              {t("dashboard.news.fallback")}
            </p>
          ) : null}

          {newsLoading ? (
            <div className="news-grid">
              {[1, 2, 3].map((key) => (
                <NewsCardSkeleton key={key} />
              ))}
            </div>
          ) : null}

          {!newsLoading && newsError ? (
            <div className="news-empty-state">
              <p>{newsError}</p>
              <button type="button" className="inline-cta" onClick={() => setNewsReloadKey((value) => value + 1)}>
                {t("dashboard.news.retry")}
              </button>
            </div>
          ) : null}

          {!newsLoading && !newsError && !newsItems.length ? (
            <div className="news-empty-state">
              <p>{t("dashboard.news.empty")}</p>
            </div>
          ) : null}

          {!newsLoading && !newsError && hasRenderableNews ? (
            <div className="news-grid">
              {newsItems.map((item, index) => (
                <NewsCard
                  key={item.id}
                  item={item}
                  onOpen={openNewsModal}
                  style={{ "--stagger-index": index }}
                  lowData={isLowData}
                />
              ))}
            </div>
          ) : null}
        </RevealBlock>
      </section>

      <RevealBlock as="section" className="dashboard-card drivers-card drivers-card-wide" reducedMotion={reducedMotion} data-tutorial="dashboard-drivers">
        <div className="section-heading">
          <div>
            <span className="dashboard-eyebrow">{t("dashboard.risk.eyebrow")}</span>
            <h2>{t("dashboard.risk.title")}</h2>
          </div>
        </div>

        {shouldMaskRiskStatus ? (
          <div className="risk-loading-state" aria-live="polite">
            <div className="risk-loading-line risk-loading-line-wide" />
            <div className="risk-loading-line" />
            <p>{isRiskPending ? t("dashboard.risk.loading") : t("dashboard.risk.unavailable")}</p>
          </div>
        ) : riskExplanation ? (
          <div className="risk-evidence-panel">
            <p className="risk-evidence-summary">{riskExplanation.plainSummary}</p>
            {riskExplanation.capExplanation ? (
              <p className="risk-evidence-cap">{riskExplanation.capExplanation}</p>
            ) : null}
            {explanationReasons.length ? (
              <div className="driver-stack">
                {explanationReasons.map((reason, index) => (
                  <RevealBlock
                    key={reason.signalId || `${reason.title}-${index}`}
                    className="driver-card evidence-driver-card"
                    delay={index * 60}
                    threshold={0.1}
                    reducedMotion={reducedMotion}
                  >
                    <div className="driver-head">
                      <div>
                        <strong>{reason.title}</strong>
                        <p>{reason.explanation}</p>
                      </div>
                      <div className="driver-meta">
                        <span className={`status-pill ${scoreTone(reason.scoreContribution)}`}>
                          {Math.round(reason.scoreContribution)}
                        </span>
                        <small>{t("dashboard.risk.contribution")}</small>
                      </div>
                    </div>
                    <div className="risk-evidence-tags" aria-label={t("dashboard.risk.evidenceAria")}>
                      <span>{reason.evidence?.status || t("dashboard.risk.unknownStatus")}</span>
                      <span>{reason.evidence?.recency || t("dashboard.risk.unknownRecency")}</span>
                      {reason.evidence?.proximity ? <span>{reason.evidence.proximity}</span> : null}
                      <span>
                        {Number.isFinite(reason.evidence?.distanceKm)
                          ? t("dashboard.risk.distanceAway", { distance: reason.evidence.distanceKm.toFixed(reason.evidence.distanceKm < 1 ? 2 : 1) })
                          : t("dashboard.risk.distanceUnknown")}
                      </span>
                    </div>
                    <div className="progress-track" aria-hidden="true">
                      <span className={`progress-fill ${scoreTone(reason.scoreContribution)}`} style={progressStyle(reason.scoreContribution)} />
                    </div>
                  </RevealBlock>
                ))}
              </div>
            ) : (
              <p className="risk-evidence-empty">{riskExplanation.headline}</p>
            )}

          </div>
        ) : (
          <div className="driver-stack">
            {riskDrivers.map((driver, index) => (
              <RevealBlock
                key={driver.id}
                className="driver-card"
                delay={index * 60}
                threshold={0.1}
                reducedMotion={reducedMotion}
              >
                <div className="driver-head">
                  <div>
                    <strong>{driver.label}</strong>
                    <p>{driver.explanation}</p>
                  </div>
                  <div className="driver-meta">
                    <span className={`status-pill ${scoreTone(driver.score)}`}>{driver.score}</span>
                    <small>{directionLabel(driver.direction, t)}</small>
                  </div>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <span className={`progress-fill ${scoreTone(driver.score)}`} style={progressStyle(driver.score)} />
                </div>
              </RevealBlock>
            ))}
          </div>
        )}
      </RevealBlock>

      <section className="dashboard-grid dashboard-bottom-grid">
        <RevealBlock
          as="article"
          className="dashboard-card factors-card"
          reducedMotion={reducedMotion}
          data-tutorial="dashboard-regional-factors"
        >
          <div className="section-heading">
            <div>
              <span className="dashboard-eyebrow">{t("dashboard.regional.eyebrow")}</span>
              <h2>{t("dashboard.regional.title")}</h2>
            </div>
          </div>

          <div className="factor-list">
            {riskFactors.map((factor, index) => {
              const tone = scoreTone(factor.score);
              const hasSignal = tone === "critical" || tone === "high";
              return (
              <RevealBlock key={factor.id} className="factor-row" delay={index * 45} threshold={0.12} reducedMotion={reducedMotion}>
                <div className="factor-copy">
                  <div className="factor-heading">
                    <strong className="factor-label">
                      {factor.category}
                      {hasSignal ? <span className={`signal-dot ${tone}`} aria-hidden="true" /> : null}
                    </strong>
                    <span className={`status-pill ${tone}`}>{factor.status}</span>
                  </div>
                  <p>{factor.detail}</p>
                  {factor.contributors?.length ? (
                    <div className="factor-evidence-chips" aria-label={`${factor.category} ${t("dashboard.regional.evidence")}`}>
                      <span>{t("dashboard.regional.evidence")}</span>
                      {factor.contributors.slice(0, 2).map((contributor, contributorIndex) => (
                        <small key={contributor.signalId || `${factor.id}-contributor-${contributorIndex}`}>
                          {contributor.summary}
                        </small>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="factor-score">
                  <strong>{factor.score}</strong>
                  <span>/100</span>
                </div>
              </RevealBlock>
            );
            })}
          </div>
        </RevealBlock>

      </section>

      {selectedNews ? (
        <NewsDetailsModal news={selectedNews} loading={newsDetailLoading} onClose={closeNewsModal} />
      ) : null}
    </section>
  );
};

export default DashboardPage;
