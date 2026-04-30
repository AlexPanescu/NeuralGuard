import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import apiClient from "../api/client";
import RESOURCE_POINTS from "../data/resourcePoints.json";
import useMediaQuery from "../hooks/useMediaQuery";
import { useCrisisMode } from "../context/CrisisModeContext";
import { useLanguage } from "../i18n/LanguageContext";
import { parseLatLon } from "../utils/parseLatLon";
import { getBrowserLocation } from "../utils/locationFallback";
import { googleMapsUrl, wazeNavigateUrl } from "../utils/navUrls";
import "../styles/pages/MapPage.css";
import "../styles/maps/user-location-marker.css";

function escapeHtml(str) {
  return String(str)
    .split('&')
    .join('&' + 'amp;')
    .split('<')
    .join('&' + 'lt;')
    .split('>')
    .join('&' + 'gt;')
    .split('"')
    .join('&' + 'quot;');
}

function resourcePopupHtml(resource, typeLabel, distanceLabel) {
  const [lon, lat] = resource.coords;
  const g = googleMapsUrl(lat, lon);
  const w = wazeNavigateUrl(lat, lon);
  const name = escapeHtml(resource.name);
  return `<div class="map-popup">
    <strong>${name}</strong>
    <span>${escapeHtml(typeLabel)} - ${escapeHtml(distanceLabel || "")}</span>
    <div class="map-popup-nav">
      <a href="${g}" target="_blank" rel="noopener noreferrer">Google Maps</a>
      <a href="${w}" target="_blank" rel="noopener noreferrer">Waze</a>
    </div>
  </div>`;
}

function isWazeIncidentSource(source) {
  return String(source || "").toLowerCase().startsWith("waze_live_map");
}

function canUseBrowserGeolocation() {
  return Boolean(
    typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator !== "undefined" &&
      navigator.geolocation,
  );
}

function incidentPopupHtml(incident) {
  const severity = String(incident.severity || "medium").toUpperCase();
  const status = String(incident.status || "open").replaceAll("_", " ");
  const title = escapeHtml(incident.title || "Incident");
  const summary = escapeHtml(incident.summary || "Detalii indisponibile.");
  const kind = escapeHtml(incident.kindLabel || "Alerta");
  const kindColor = escapeHtml(incident.markerColor || "#475569");
  const location = escapeHtml(incident.locationLabel || "Locatie aproximativa");
  const source = escapeHtml(incident.sourceLabel || "sursa automata");
  const timeLabel = escapeHtml(incident.timeLabel || "timp necunoscut");
  const precision = incident.hasReliableGeo ? "Geo precis" : "Geo aproximativ";
  const overlapCount = Number(incident.overlapCount || 1);
  const danger = escapeHtml(String(incident.dangerScore || severityDangerFallback(incident.severity)));
  const shouldShowRadius = incident.hasReliableGeo && !isWazeIncidentSource(incident.source);
  const radius = shouldShowRadius ? `${Number(incident.radiusKm || 0.5).toFixed(1)} km` : "";
  const geoLine = shouldShowRadius
    ? `${precision} - perimetru ${escapeHtml(radius)} - danger ${danger}`
    : `${precision} - danger ${danger}`;

  return `<div class="map-popup map-popup--incident">
    <div class="map-popup-incident-top">
      <span class="map-popup-pill map-popup-pill--kind">
        <span class="map-popup-kind-dot" style="background:${kindColor}"></span>${kind}
      </span>
      <span class="map-popup-pill map-popup-pill--severity severity-${String(incident.severity || "medium").toLowerCase()}">${severity}</span>
    </div>
    <strong>${title}</strong>
    <span>${summary}</span>
    <span>Status: ${escapeHtml(status)}</span>
    <span>${location}</span>
    <span>${geoLine}</span>
    ${overlapCount > 1 ? `<span>Grup local: ${overlapCount} incidente apropiate</span>` : ""}
    <span>Actualizat: ${timeLabel}</span>
    <span>Sursa: ${source}</span>
  </div>`;
}

const MAP_LOCATION_LOCAL_KEY = "mapSavedLocation";

function readLocalSavedLocation() {
  try {
    const raw = localStorage.getItem(MAP_LOCATION_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.coordinates?.lat != null &&
      parsed?.coordinates?.lon != null &&
      Number.isFinite(Number(parsed.coordinates.lat)) &&
      Number.isFinite(Number(parsed.coordinates.lon))
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeLocalSavedLocation(location) {
  try {
    localStorage.setItem(MAP_LOCATION_LOCAL_KEY, JSON.stringify(location));
  } catch {
    /* ignore */
  }
}

const buildTypeLabels = (t) => ({
  adapost: t("map.resources.shelter"),
  farmacie: t("map.resources.pharmacy"),
  spital: t("map.resources.hospital"),
});

const EARTH_RADIUS_KM = 6371;
const toRadians = (value) => (value * Math.PI) / 180;
const haversineKm = (from, to) => {
  const lat1 = toRadians(from[1]);
  const lat2 = toRadians(to[1]);
  const deltaLat = toRadians(to[1] - from[1]);
  const deltaLon = toRadians(to[0] - from[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

const formatDistance = (distanceKm) => {
  if (!Number.isFinite(distanceKm)) return "N/A";
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
};

const severityDangerFallback = (severity) => {
  switch (String(severity || "").toLowerCase()) {
    case "critical":
      return 90;
    case "high":
      return 72;
    case "medium":
      return 48;
    default:
      return 28;
  }
};

const getSeverityColor = (severity) => {
  switch (String(severity || "").toLowerCase()) {
    case "critical":
      return "#b91c1c";
    case "high":
      return "#ea580c";
    case "medium":
      return "#f59e0b";
    default:
      return "#2563eb";
  }
};

const INCIDENT_MARKER_STYLES = {
  blocked_road: { bg: "#dc2626", glyph: "⛔" },
  congestion: { bg: "#f97316", glyph: "🚧" },
  police: { bg: "#2563eb", glyph: "👮" },
  medical: { bg: "#0284c7", glyph: "🚑" },
  fire: { bg: "#b91c1c", glyph: "🔥" },
  construction: { bg: "#a16207", glyph: "🏗️" },
  weather: { bg: "#0e7490", glyph: "🌧️" },
  accident: { bg: "#e11d48", glyph: "💥" },
  hazard: { bg: "#d97706", glyph: "⚠️" },
  violence: { bg: "#7c3aed", glyph: "🚨" },
  traffic: { bg: "#ea580c", glyph: "🚦" },
  generic: { bg: "#475569", glyph: "📍" },
};

const INCIDENT_MARKER_ALIASES = {
  blocked_road: "blocked_road",
  road_closed: "blocked_road",
  congestion: "congestion",
  traffic_jam: "congestion",
  police: "police",
  cop: "police",
  medical: "medical",
  fire: "fire",
  construction: "construction",
  weather: "weather",
  accident: "accident",
  crash: "accident",
  hazard: "hazard",
  violence: "violence",
  traffic: "traffic",
  generic: "generic",
};

function resolveMarkerImageName(name) {
  const key = String(name || "").trim().toLowerCase();
  return INCIDENT_MARKER_ALIASES[key] || "";
}

function createIncidentMarkerImageData(markerName, size = 64) {
  if (typeof document === "undefined") return null;
  const style = INCIDENT_MARKER_STYLES[markerName] || INCIDENT_MARKER_STYLES.generic;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const center = size / 2;
  const radius = size * 0.34;
  ctx.clearRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius * 1.6);
  glow.addColorStop(0, "rgba(15,23,42,0.22)");
  glow.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(center, center, radius * 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = style.bg;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(3, Math.round(size * 0.055));
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(center, center, radius - ctx.lineWidth * 0.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(size * 0.34)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(style.glyph || "??"), center, center + 1);

  return ctx.getImageData(0, 0, size, size);
}

function registerIncidentMarkerImages(mapInstance) {
  if (!mapInstance) return;
  Object.keys(INCIDENT_MARKER_STYLES).forEach((name) => {
    const imageData = createIncidentMarkerImageData(name, 64);
    if (!imageData) return;
    try {
      if (mapInstance.hasImage(name)) {
        mapInstance.removeImage(name);
      }
      mapInstance.addImage(name, imageData);
    } catch (error) {
      if (typeof console !== "undefined") {
        console.warn(`[markers] failed to register image ${name}`, error);
      }
    }
  });
}

const getIncidentKind = (incident) => {
  const blob = `${incident?.type || ""} ${incident?.title || ""} ${incident?.summary || ""}`.toLowerCase();
  const type = String(incident?.type || "").toLowerCase();
  if (type.includes("road_closed") || blob.includes("drum inchis") || blob.includes("road closed")) {
    return { label: "Drum inchis", short: "CLS", markerImage: "blocked_road", color: "#c2410c" };
  }
  if (type.includes("traffic_jam") || blob.includes("jam") || blob.includes("ambuteiaj")) {
    return { label: "Ambuteiaj", short: "JAM", markerImage: "congestion", color: "#ea580c" };
  }
  if (type.includes("police") || blob.includes("police") || blob.includes("politi")) {
    return { label: "Politie", short: "POL", markerImage: "police", color: "#1d4ed8" };
  }
  if (type.includes("medical") || blob.includes("medical") || blob.includes("smurd") || blob.includes("ambul")) {
    return { label: "Medical", short: "MED", markerImage: "medical", color: "#2563eb" };
  }
  if (type.includes("fire") || blob.includes("incend")) {
    return { label: "Incendiu", short: "INC", markerImage: "fire", color: "#b91c1c" };
  }
  if (type.includes("construction") || blob.includes("lucr")) {
    return { label: "Lucrari", short: "LCR", markerImage: "construction", color: "#b45309" };
  }
  if (type.includes("weather") || blob.includes("furtuna") || blob.includes("ploi") || blob.includes("viscol") || blob.includes("meteo")) {
    return { label: "Meteo", short: "MET", markerImage: "weather", color: "#0369a1" };
  }
  if (type.includes("accident") || blob.includes("accident")) {
    return { label: "Accident", short: "ACD", markerImage: "accident", color: "#dc2626" };
  }
  if (type.includes("hazard") || blob.includes("hazard") || blob.includes("obstacol") || blob.includes("pericol")) {
    return { label: "Pericol", short: "PRC", markerImage: "hazard", color: "#d97706" };
  }
  if (blob.includes("violent") || blob.includes("lovire") || blob.includes("agres")) {
    return { label: "Violenta", short: "VIO", markerImage: "violence", color: "#7c3aed" };
  }
  if (
    blob.includes("accident")
    || blob.includes("hazard")
    || blob.includes("trafic")
    || blob.includes("centura")
    || blob.includes("a0")
    || blob.includes("a1")
    || blob.includes("a2")
  ) {
    return { label: "Trafic", short: "TRF", markerImage: "traffic", color: "#dc2626" };
  }
  return { label: "Alerta", short: "ALT", markerImage: "generic", color: "#475569" };
};

const getIncidentSourceLabel = (incident) => {
  const source = String(incident?.source || "");
  if (source.startsWith("waze_live_map_import")) return "Waze import (capture)";
  if (source.startsWith("waze_live_map")) return "Waze live map";
  if (source.startsWith("accidenteromania")) return "Accidente Romania";
  return source || "manual";
};

const getIncidentLocationLabel = (incident) => {
  const address = String(incident?.location?.address || "").trim();
  if (address) return address;
  return "Bucuresti";
};

const formatIncidentTime = (value, locale = "en-US", fallback = "time unknown") => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
};

const getIncidentLatLon = (incident) => {
  const latCandidates = [
    incident?.location?.lat,
    incident?.coordinates?.lat,
    incident?.lat,
  ];
  const lonCandidates = [
    incident?.location?.lon,
    incident?.coordinates?.lon,
    incident?.lon,
  ];
  const lat = latCandidates.map(Number).find(Number.isFinite);
  const lon = lonCandidates.map(Number).find(Number.isFinite);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

const getIncidentRadiusKm = (incident) => {
  const radiusCandidates = [
    incident?.location?.radiusKm,
    incident?.location?.radius,
    incident?.radiusKm,
    incident?.radius,
  ];
  const radius = radiusCandidates.map(Number).find(Number.isFinite);
  return Math.max(0.05, Number.isFinite(radius) ? radius : 0.5);
};

const hasReliableIncidentGeo = (incident) => {
  const geoConfidence = Number(incident?.geoConfidence);
  const geoReasons = incident?.ingestionMeta?.geoReasons;
  const address = String(incident?.location?.address || "").trim().toLowerCase();
  const usesFallback =
    Array.isArray(geoReasons) && geoReasons.includes("default_bucharest_fallback");

  if (usesFallback) return false;
  if (address === "bucharest, romania") return false;
  if (Number.isFinite(geoConfidence) && geoConfidence < 60) return false;
  return true;
};

const incidentCircle = (incident, steps = 48) => {
  const coords = Number.isFinite(Number(incident?.displayLat)) && Number.isFinite(Number(incident?.displayLon))
    ? { lat: Number(incident.displayLat), lon: Number(incident.displayLon) }
    : getIncidentLatLon(incident);
  if (!coords) return null;
  if (isWazeIncidentSource(incident?.source)) return null;
  if (!hasReliableIncidentGeo(incident)) return null;
  const { lat, lon } = coords;
  const radiusKm = getIncidentRadiusKm(incident);

  const coordinates = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const latOffset = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI) * Math.cos(bearing);
    const lonOffset =
      ((radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI) * Math.sin(bearing)) / Math.cos(toRadians(lat));
    coordinates.push([lon + lonOffset, lat + latOffset]);
  }

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
    properties: {
      title: incident.title || "Incident",
      severity: incident.severity || "medium",
      status: incident.status || "open",
      radiusKm,
      dangerScore: Number.isFinite(Number(incident?.dangerScore))
        ? Number(incident.dangerScore)
        : severityDangerFallback(incident?.severity),
    },
  };
};

const normalizeIncidentForMap = (incident, locale = "en-US", timeFallback = "time unknown") => {
  const kind = getIncidentKind(incident);
  const hasReliableGeo = hasReliableIncidentGeo(incident);
  const markerImage = resolveMarkerImageName(kind.markerImage) || "generic";
  return {
    ...incident,
    kindLabel: kind.label,
    markerLabel: kind.short,
    markerImage,
    markerColor: kind.color,
    sourceLabel: getIncidentSourceLabel(incident),
    locationLabel: getIncidentLocationLabel(incident),
    timeLabel: formatIncidentTime(incident?.riskUpdatedAt || incident?.updatedAt || incident?.createdAt, locale, timeFallback),
    severityColor: getSeverityColor(incident?.severity),
    hasReliableGeo,
  };
};

const incidentCoordKey = (coords) =>
  `${Number(coords.lat).toFixed(5)}:${Number(coords.lon).toFixed(5)}`;

const offsetCoords = (coords, distanceKm, bearingRad) => {
  const latOffset = (distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI) * Math.cos(bearingRad);
  const lonOffset =
    ((distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI) * Math.sin(bearingRad)) /
    Math.cos(toRadians(coords.lat));
  return {
    lat: coords.lat + latOffset,
    lon: coords.lon + lonOffset,
  };
};

const stableHash = (input) => {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
};

const incidentSeed = (incident, index) =>
  [
    incident?.sourceKey,
    incident?.id,
    incident?._id,
    incident?.sourceUrl,
    incident?.title,
    incident?.publishedAt,
    index,
  ]
    .filter(Boolean)
    .join("|");

const getIncidentListKey = (incident, index) =>
  [
    incident?.id,
    incident?._id,
    incident?.sourceKey,
    incident?.sourceUrl,
    incident?.title,
    incident?.publishedAt,
    incident?.displayLat,
    incident?.displayLon,
    index,
  ]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map((part) => String(part))
    .join("|");

const spreadBySeed = (coords, incident, index, overlapCount, reliableGeo) => {
  const seed = incidentSeed(incident, index);
  const hash = stableHash(seed || `${coords.lat}:${coords.lon}:${index}`);
  const angle = ((hash % 3600) / 3600) * 2 * Math.PI;
  const base = reliableGeo ? 0.02 : 0.16;
  const amplitude = reliableGeo ? 0.08 : 0.42;
  const overlapScale = Math.min(1.7, 1 + overlapCount * 0.08);
  const radial = base + (((hash >>> 8) % 1000) / 1000) * amplitude * overlapScale;
  return offsetCoords(coords, radial, angle);
};

const spreadIncidentMarkers = (incidents) => {
  const groups = new Map();
  for (const incident of incidents) {
    const coords = getIncidentLatLon(incident);
    if (!coords) continue;
    const key = incidentCoordKey(coords);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ incident, coords });
  }

  const result = [];
  for (const [, group] of groups.entries()) {
    if (group.length === 1) {
      const { incident, coords } = group[0];
      result.push({
        ...incident,
        displayLat: coords.lat,
        displayLon: coords.lon,
        overlapCount: 1,
      });
      continue;
    }

    for (let i = 0; i < group.length; i += 1) {
      const { incident, coords } = group[i];
      const spread = spreadBySeed(coords, incident, i, group.length, incident.hasReliableGeo);
      result.push({
        ...incident,
        displayLat: spread.lat,
        displayLon: spread.lon,
        overlapCount: group.length,
      });
    }
  }

  return result;
};

const MapPage = () => {
  const { t, locale } = useLanguage();
  const { isOffline, isOfflineReady, markCriticalSync } = useCrisisMode();
  const typeLabels = useMemo(() => buildTypeLabels(t), [t]);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const hasCenteredRef = useRef(false);
  const autoLocateRequestedRef = useRef(false);
  const userMarkerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressLngLatRef = useRef(null);
  const longPressCleanupRef = useRef(null);
  const saveMapPressLocationRef = useRef(null);
  const [activeFilters, setActiveFilters] = useState({
    adapost: true,
    farmacie: true,
    spital: true,
  });
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [savedLocation, setSavedLocation] = useState(null);
  const [manualName, setManualName] = useState("");
  const [manualRaw, setManualRaw] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [incidents, setIncidents] = useState([]);
  const [incidentDataState, setIncidentDataState] = useState("fallback");
  const [mapReady, setMapReady] = useState(false);
  const isMobilePanelLayout = useMediaQuery("(max-width: 980px)");
  const [mobilePanel, setMobilePanel] = useState("incidents");
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  const loadIncidents = useCallback(async () => {
    if (isOffline || isOfflineReady) {
      setIncidents([]);
      setIncidentDataState(isOffline ? "offline" : "fallback");
      return;
    }

    try {
      const response = await apiClient.get("/api/incidents");
      setIncidents(
        Array.isArray(response.data)
          ? response.data.filter(
              (incident) =>
                getIncidentLatLon(incident) != null
                && incident.status !== "resolved",
            )
          : [],
      );
      setIncidentDataState("live");
      markCriticalSync();
    } catch {
      setIncidents([]);
      setIncidentDataState("fallback");
    }
  }, [isOffline, isOfflineReady, markCriticalSync]);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection",
      features: RESOURCE_POINTS.map((point) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: point.coords,
        },
        properties: {
          name: point.name,
          type: point.type,
          distance: point.distance,
        },
      })),
    }),
    [],
  );

  const displayIncidents = useMemo(
    () =>
      [...incidents]
        .map((incident) => normalizeIncidentForMap(incident, locale, t("map.states.unknownTime")))
        .sort(
          (a, b) =>
            (Number(b?.dangerScore) || severityDangerFallback(b?.severity)) -
            (Number(a?.dangerScore) || severityDangerFallback(a?.severity)),
        ),
    [incidents, locale, t],
  );

  const mapIncidents = useMemo(() => spreadIncidentMarkers(displayIncidents), [displayIncidents]);

  const resourcesWithDistance = useMemo(() => {
    return RESOURCE_POINTS.map((point) => {
      const distanceKm = userLocation ? haversineKm(userLocation, point.coords) : null;
      return {
        ...point,
        distanceKm,
        distanceLabel: formatDistance(distanceKm),
      };
    });
  }, [userLocation]);

  const filteredResources = useMemo(() => {
    if (!userLocation) return resourcesWithDistance;
    return resourcesWithDistance.filter((point) => point.distanceKm <= 50);
  }, [resourcesWithDistance, userLocation]);

  const sortedResources = useMemo(() => {
    if (!userLocation) return filteredResources;
    return [...filteredResources].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }, [filteredResources, userLocation]);

  const searchedResources = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sortedResources;
    return sortedResources.filter((point) => {
      const name = String(point.name || "").toLowerCase();
      const type = String(typeLabels[point.type] || "").toLowerCase();
      return name.includes(term) || type.includes(term);
    });
  }, [sortedResources, searchTerm, typeLabels]);

  useEffect(() => {
    setIsLegendOpen(!isMobilePanelLayout);
  }, [isMobilePanelLayout]);

  useEffect(() => {
    loadIncidents();
    if (isOffline || isOfflineReady) return undefined;
    const id = window.setInterval(loadIncidents, 45000);
    return () => window.clearInterval(id);
  }, [isOffline, isOfflineReady, loadIncidents]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [26.1025, 44.4268],
      zoom: 11,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    if (canUseBrowserGeolocation()) {
      mapRef.current.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right",
      );
    }

    mapRef.current.on("load", () => {
      if (!mapRef.current) return;
      setMapReady(true);

      mapRef.current.addSource("resources", {
        type: "geojson",
        data: geojson,
      });

      mapRef.current.addSource("coverage", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      mapRef.current.addSource("incidents", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      mapRef.current.addSource("incident-radii", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
      registerIncidentMarkerImages(mapRef.current);
      mapRef.current.on("styleimagemissing", (event) => {
        const missingId = String(event?.id || "");
        const normalizedMissingId = missingId.trim().toLowerCase();
        const knownId = Boolean(
          INCIDENT_MARKER_STYLES[normalizedMissingId] || INCIDENT_MARKER_ALIASES[normalizedMissingId],
        );
        if (!knownId) return;
        const resolvedId = resolveMarkerImageName(normalizedMissingId) || "generic";
        if (mapRef.current.hasImage(resolvedId)) return;
        const imageData = createIncidentMarkerImageData(resolvedId, 64);
        if (!imageData) return;
        try {
          mapRef.current.addImage(resolvedId, imageData);
        } catch {
          /* ignore */
        }
      });

      mapRef.current.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: {
          "fill-color": "#f97316",
          "fill-opacity": 0.08,
        },
      });

      mapRef.current.addLayer({
        id: "coverage-outline",
        type: "line",
        source: "coverage",
        paint: {
          "line-color": "#f97316",
          "line-width": 1.6,
          "line-opacity": 0.6,
        },
      });

      mapRef.current.addLayer({
        id: "resource-glow",
        type: "circle",
        source: "resources",
        paint: {
          "circle-radius": 16,
          "circle-color": [
            "match",
            ["get", "type"],
            "adapost",
            "#60a5fa",
            "farmacie",
            "#34d399",
            "spital",
            "#f87171",
            "#cbd5f5",
          ],
          "circle-opacity": 0.2,
        },
      });

      mapRef.current.addLayer({
        id: "resource-points",
        type: "circle",
        source: "resources",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-color": [
            "match",
            ["get", "type"],
            "adapost",
            "#2563eb",
            "farmacie",
            "#16a34a",
            "spital",
            "#dc2626",
            "#64748b",
          ],
          "circle-stroke-color": "#f8fafc",
        },
      });

      const addIncidentMarkersLayer = () => {
        if (!mapRef.current || mapRef.current.getLayer("incident-markers")) return;
        mapRef.current.addLayer({
          id: "incident-markers",
          type: "symbol",
          source: "incidents",
          layout: {
            "icon-image": ["coalesce", ["get", "markerImage"], "generic"],
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              [
                "interpolate",
                ["linear"],
                ["coalesce", ["to-number", ["get", "dangerScore"]], 40],
                25,
                0.34,
                50,
                0.42,
                75,
                0.5,
                95,
                0.58,
              ],
              12,
              [
                "interpolate",
                ["linear"],
                ["coalesce", ["to-number", ["get", "dangerScore"]], 40],
                25,
                0.42,
                50,
                0.5,
                75,
                0.58,
                95,
                0.68,
              ],
              15,
              [
                "interpolate",
                ["linear"],
                ["coalesce", ["to-number", ["get", "dangerScore"]], 40],
                25,
                0.5,
                50,
                0.58,
                75,
                0.68,
                95,
                0.78,
              ],
            ],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      };
      addIncidentMarkersLayer();

      mapRef.current.addLayer({
        id: "incident-radii-fill",
        type: "fill",
        source: "incident-radii",
        paint: {
          "fill-color": "#ef4444",
          "fill-opacity": 0.12,
        },
      });

      mapRef.current.addLayer({
        id: "incident-radii-outline",
        type: "line",
        source: "incident-radii",
        paint: {
          "line-color": "#dc2626",
          "line-width": 1.7,
          "line-opacity": 0.6,
        },
      });

      mapRef.current.addLayer({
        id: "resource-labels",
        type: "symbol",
        source: "resources",
        layout: {
          "text-field": ["get", "name"],
          "text-offset": [0, 1.4],
          "text-size": 12,
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      mapRef.current.addLayer({
        id: "resource-highlight",
        type: "circle",
        source: "resources",
        paint: {
          "circle-radius": 12,
          "circle-color": "#ffffff",
          "circle-opacity": 0.25,
        },
        filter: ["==", ["get", "name"], ""],
      });

      // Ensure user marker appears on top of all other layers
      mapRef.current.on("load", () => {
        // Move user marker to top layer
        const userMarkerElement = document.querySelector(".user-location-marker");
        if (userMarkerElement) {
          userMarkerElement.style.zIndex = "1000";
        }
      });

      mapRef.current.on("mousemove", "resource-points", (event) => {
        if (!event.features?.length) return;
        const feature = event.features[0];
        const name = feature.properties?.name;
        mapRef.current.getCanvas().style.cursor = "pointer";
        mapRef.current.setFilter("resource-highlight", ["==", ["get", "name"], name || ""]);
      });

      mapRef.current.on("mouseleave", "resource-points", () => {
        mapRef.current.getCanvas().style.cursor = "";
        mapRef.current.setFilter("resource-highlight", ["==", ["get", "name"], ""]);
      });

      mapRef.current.on("mousemove", "incident-markers", () => {
        mapRef.current.getCanvas().style.cursor = "pointer";
      });

      mapRef.current.on("mouseleave", "incident-markers", () => {
        mapRef.current.getCanvas().style.cursor = "";
      });

      mapRef.current.on("click", "resource-points", (event) => {
        if (!event.features?.length || !mapRef.current) return;
        const feature = event.features[0];
        const { name, type, distance } = feature.properties || {};
        const coords = feature.geometry?.coordinates;
        if (!Array.isArray(coords)) return;

        if (popupRef.current) {
          popupRef.current.remove();
        }
        popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: false })
          .setLngLat(coords)
          .setHTML(
            resourcePopupHtml(
              { name: name || "Resursa", coords },
              typeLabels[type] || t("map.resources.resource"),
              distance || "",
            ),
          )
          .addTo(mapRef.current);
      });

      mapRef.current.on("click", "incident-markers", (event) => {
        if (!event.features?.length || !mapRef.current) return;
        const feature = event.features[0];
        const coords = feature.geometry?.coordinates;
        if (!Array.isArray(coords)) return;
        const incidentProps = feature.properties || {};

        if (popupRef.current) {
          popupRef.current.remove();
        }
        popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: false })
          .setLngLat(coords)
          .setHTML(incidentPopupHtml(incidentProps))
          .addTo(mapRef.current);
      });

      const clearLongPress = () => {
        if (longPressTimerRef.current) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        longPressLngLatRef.current = null;
      };

      const startLongPress = (lngLat) => {
        clearLongPress();
        longPressLngLatRef.current = lngLat;
        longPressTimerRef.current = window.setTimeout(() => {
          const lngLat = longPressLngLatRef.current;
          clearLongPress();
          if (!lngLat) return;
          saveMapPressLocationRef.current?.(lngLat);
        }, 2000);
      };

      const mapInstance = mapRef.current;
      const mapCanvasContainer = mapInstance.getCanvasContainer();
      const mapCanvasWrapper = mapContainerRef.current?.closest(".map-canvas");

      const handleMapTouchStart = (event) => {
        const touchCount = Array.isArray(event?.points) ? event.points.length : 0;
        if (touchCount > 1) {
          clearLongPress();
          return;
        }
        if (event?.lngLat) {
          startLongPress(event.lngLat);
        }
      };
      const handleMapTouchEnd = () => clearLongPress();

      // Mobile long-press is more reliable through MapLibre touch events.
      mapInstance.on("touchstart", handleMapTouchStart);
      mapInstance.on("touchend", handleMapTouchEnd);
      mapInstance.on("touchcancel", handleMapTouchEnd);
      mapInstance.on("touchmove", clearLongPress);
      mapInstance.on("dragstart", clearLongPress);
      mapInstance.on("movestart", clearLongPress);

      // Desktop fallback for mouse press-and-hold.
      const getLngLatFromMouseEvent = (event) => {
        const point = event;
        if (!point) return null;
        const rect = mapCanvasContainer.getBoundingClientRect();
        const x = point.clientX - rect.left;
        const y = point.clientY - rect.top;
        return mapInstance.unproject([x, y]);
      };
      const handleMouseLongPressStart = (event) => {
        const lngLat = getLngLatFromMouseEvent(event);
        if (lngLat) startLongPress(lngLat);
      };
      const longPressTargets = [mapCanvasContainer, mapCanvasWrapper].filter(Boolean);
      longPressTargets.forEach((target) => {
        target.addEventListener("mousedown", handleMouseLongPressStart);
        target.addEventListener("mouseup", clearLongPress);
        target.addEventListener("mouseleave", clearLongPress);
      });
      if (typeof window !== "undefined") {
        window.__mapLongPressReady = true;
      }
      longPressCleanupRef.current = () => {
        mapInstance.off("touchstart", handleMapTouchStart);
        mapInstance.off("touchend", handleMapTouchEnd);
        mapInstance.off("touchcancel", handleMapTouchEnd);
        mapInstance.off("touchmove", clearLongPress);
        mapInstance.off("dragstart", clearLongPress);
        mapInstance.off("movestart", clearLongPress);
        longPressTargets.forEach((target) => {
          target.removeEventListener("mousedown", handleMouseLongPressStart);
          target.removeEventListener("mouseup", clearLongPress);
          target.removeEventListener("mouseleave", clearLongPress);
        });
      };
    });

    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressCleanupRef.current?.();
      longPressCleanupRef.current = null;
      if (typeof window !== "undefined") {
        window.__mapLongPressReady = false;
      }
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [geojson, t, typeLabels]);

  useEffect(() => {
    if (!mapReady || !mapRef.current?.getSource("incidents")) return;
    const incidentPointFeatures = mapIncidents
      .map((incident) => {
        const coords = Number.isFinite(Number(incident?.displayLat)) && Number.isFinite(Number(incident?.displayLon))
          ? { lat: Number(incident.displayLat), lon: Number(incident.displayLon) }
          : getIncidentLatLon(incident);
        if (!coords) return null;
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [coords.lon, coords.lat],
          },
          properties: {
            id: incident.id || incident._id,
            title: incident.title,
            summary: incident.summary,
            kindLabel: incident.kindLabel,
            markerLabel: incident.markerLabel,
            markerImage: incident.markerImage,
            markerColor: incident.markerColor,
            source: incident.source,
            severity: incident.severity,
            status: incident.status,
            sourceLabel: incident.sourceLabel,
            locationLabel: incident.locationLabel,
            severityColor: incident.severityColor,
            radiusKm: getIncidentRadiusKm(incident),
            hasReliableGeo: Boolean(incident.hasReliableGeo),
            overlapCount: Number(incident.overlapCount || 1),
            dangerScore: Number.isFinite(Number(incident.dangerScore))
              ? Number(incident.dangerScore)
              : severityDangerFallback(incident.severity),
          },
        };
      })
      .filter(Boolean);
    mapRef.current.getSource("incidents").setData({
      type: "FeatureCollection",
      features: incidentPointFeatures,
    });
    if (mapRef.current?.getSource("incident-radii")) {
      mapRef.current.getSource("incident-radii").setData({
        type: "FeatureCollection",
        features: mapIncidents.map((incident) => incidentCircle(incident)).filter(Boolean),
      });
    }
  }, [mapIncidents, mapReady]);

  useEffect(() => {
    let isMounted = true;

    const loadSavedLocation = async () => {
      let location = null;
      let hasLoggedUser = false;
      try {
        const rawUser = localStorage.getItem("currentUser");
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          hasLoggedUser = Boolean(parsed?.id || parsed?._id);
        }
      } catch {
        hasLoggedUser = false;
      }
      try {
        if (hasLoggedUser) {
          const response = await apiClient.get("/api/me/location");
          location = response.data?.location || null;
        }
      } catch {
        location = null;
      }
      if (!location) {
        location = readLocalSavedLocation();
      }
      if (!isMounted) return;
      setSavedLocation(location);
      if (location?.coordinates?.lat != null && location?.coordinates?.lon != null) {
        setManualRaw(location.raw || "");
        setManualName(location.name || "");
        setUserLocation([location.coordinates.lon, location.coordinates.lat]);
      }
    };

    loadSavedLocation();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (autoLocateRequestedRef.current) return;
    if (userLocation) return;
    if (savedLocation?.coordinates?.lat != null && savedLocation?.coordinates?.lon != null) return;
    if (!canUseBrowserGeolocation()) return;

    autoLocateRequestedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = [position.coords.longitude, position.coords.latitude];
        setUserLocation(coords);
      },
      () => {
        // Keep map usable even if geolocation is denied.
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 },
    );
  }, [savedLocation, userLocation]);

  useEffect(() => {
    if (!mapRef.current) return;
    const source = mapRef.current.getSource("resources");
    if (!source) return;

    const data = {
      type: "FeatureCollection",
      features: filteredResources.map((point) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: point.coords,
        },
        properties: {
          name: point.name,
          type: point.type,
          distance: point.distanceLabel,
        },
      })),
    };
    source.setData(data);
  }, [filteredResources]);

  useEffect(() => {
    if (!mapRef.current) return;
    const activeTypes = Object.entries(activeFilters)
      .filter(([, enabled]) => enabled)
      .map(([type]) => type);
    const filter = activeTypes.length
      ? ["in", ["get", "type"], ["literal", activeTypes]]
      : ["==", ["get", "type"], ""];

    const layers = ["resource-glow", "resource-points", "resource-labels"];
    layers.forEach((layer) => {
      if (mapRef.current.getLayer(layer)) {
        mapRef.current.setFilter(layer, filter);
      }
    });
  }, [activeFilters]);

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    const coverageSource = mapRef.current.getSource("coverage");
    if (!coverageSource) return;

    const circle = [];
    const steps = 64;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const dx = (50 / EARTH_RADIUS_KM) * Math.cos(angle);
      const dy = (50 / EARTH_RADIUS_KM) * Math.sin(angle);
      const lat = userLocation[1] + (dy * 180) / Math.PI;
      const lon =
        userLocation[0] +
        ((dx * 180) / Math.PI) / Math.cos((userLocation[1] * Math.PI) / 180);
      circle.push([lon, lat]);
    }

    coverageSource.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [circle] },
        },
      ],
    });

    // User marker stabil
    if (!mapRef.current) return;
    
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "user-location-marker";

      userMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat(userLocation)
        .addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat(userLocation);
    }
  }, [userLocation]);

  useEffect(() => {
    if (!mapRef.current || !userLocation || hasCenteredRef.current) return;
    mapRef.current.flyTo({ center: userLocation, zoom: 10 });
    hasCenteredRef.current = true;
  }, [userLocation]);

  const handleCenterOnUser = () => {
    if (savedLocation?.coordinates?.lat != null && savedLocation?.coordinates?.lon != null) {
      const coords = [savedLocation.coordinates.lon, savedLocation.coordinates.lat];
      setUserLocation(coords);
      setLocationError("");
      if (mapRef.current) {
        mapRef.current.flyTo({ center: coords, zoom: 10 });
      }
      return;
    }

    if (!canUseBrowserGeolocation()) {
      setLocationError(t("map.save.browserHttpsOnly"));
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = [position.coords.longitude, position.coords.latitude];
        setUserLocation(coords);
        if (mapRef.current) {
          mapRef.current.flyTo({ center: coords, zoom: 10 });
        }
        setLocating(false);
      },
      () => {
        setLocationError("Acces locatie refuzat.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const applySavedLocation = useCallback((location, message) => {
    setSavedLocation(location);
    if (location?.coordinates?.lat != null && location?.coordinates?.lon != null) {
      const coords = [location.coordinates.lon, location.coordinates.lat];
      setUserLocation(coords);
      if (mapRef.current) {
        mapRef.current.flyTo({ center: coords, zoom: 10 });
      }
    }
    try {
      const storedUser = localStorage.getItem("currentUser");
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        parsed.location = location;
        localStorage.setItem("currentUser", JSON.stringify(parsed));
      }
    } catch {
      /* ignore */
    }
    setSaveMessage(message);
  }, []);

  const handleSaveLocation = async () => {
    setIsSaving(true);
    setSaveMessage("");
    const rawStr = manualRaw.trim();
    if (!rawStr) {
      setSaveMessage("Introdu coordonatele in al doilea camp.");
      setIsSaving(false);
      return;
    }
    const coords = parseLatLon(rawStr);
    if (!coords) {
      setSaveMessage(
        "Format nerecunoscut. Exemplu: 44.43, 26.10 (lat, lon) sau DMS ca in placeholder.",
      );
      setIsSaving(false);
      return;
    }
    const name = manualName.trim() || t("sos.states.savedLocation");
    const locationPayload = {
      name,
      raw: rawStr,
      coordinates: { lat: coords.lat, lon: coords.lon },
    };
    try {
      const response = await apiClient.patch("/api/me/location", {
        name,
        raw: rawStr,
      });
      const location = response.data?.location || locationPayload;
      writeLocalSavedLocation(location);
      applySavedLocation(location, t("map.save.savedAccount"));
    } catch (error) {
      const status = error?.response?.status;
      const apiMsg = error?.response?.data?.error;
      const offline =
        !error?.response ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        error?.code === "ERR_NETWORK";
      if (offline) {
        writeLocalSavedLocation(locationPayload);
        applySavedLocation(
          locationPayload,
          status === 401 || status === 403
            ? t("map.save.savedDeviceAuth")
            : t("map.save.savedDevice"),
        );
      } else {
        setSaveMessage(apiMsg || t("map.save.error"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setIsSaving(true);
    setSaveMessage("");
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setIsSaving(false);
      setSaveMessage(
        t("map.save.gpsNeedsHttps"),
      );
      return;
    }
    const result = await getBrowserLocation({ timeoutMs: 5000 });
    if (!result.ok) {
      setIsSaving(false);
      if (result.reason === "gps_denied") {
        setSaveMessage(t("map.save.gpsBlocked"));
        return;
      }
      setSaveMessage(t("map.save.gpsFailed"));
      return;
    }

    const lat = result.location.lat;
    const lon = result.location.lon;
    const raw = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const name = t("map.save.myCurrentLocation");
    const locationPayload = {
      name,
      raw,
      coordinates: { lat, lon },
      accuracy: result.location.accuracy,
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await apiClient.patch("/api/me/location", { name, raw });
      const saved = {
        ...locationPayload,
        ...(response.data?.location || {}),
      };
      writeLocalSavedLocation(saved);
      setManualName(saved.name || name);
      setManualRaw(saved.raw || raw);
      applySavedLocation(saved, t("map.save.currentSaved"));
    } catch {
      writeLocalSavedLocation(locationPayload);
      setManualName(name);
      setManualRaw(raw);
      applySavedLocation(locationPayload, t("map.save.savedLocalGps"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveMapPressLocation = useCallback(async (lngLat) => {
    if (!lngLat) return;
    const confirmed = window.confirm(t("map.save.confirmMapPress"));
    if (!confirmed) return;

    const lat = Number(lngLat.lat);
    const lon = Number(lngLat.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    setIsSaving(true);
    const raw = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const locationPayload = {
      name: t("map.save.customLocation"),
      raw,
      coordinates: { lat, lon },
      source: "manual_map",
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await apiClient.patch("/api/me/location", {
        name: locationPayload.name,
        raw,
      });
      const saved = {
        ...locationPayload,
        ...(response.data?.location || {}),
        source: "manual_map",
      };
      writeLocalSavedLocation(saved);
      setManualName(saved.name || locationPayload.name);
      setManualRaw(saved.raw || raw);
      applySavedLocation(saved, t("map.save.savedMap"));
    } catch {
      writeLocalSavedLocation(locationPayload);
      setManualName(locationPayload.name);
      setManualRaw(raw);
      applySavedLocation(locationPayload, t("map.save.savedLocalGps"));
    } finally {
      setIsSaving(false);
    }
  }, [applySavedLocation, t]);
  saveMapPressLocationRef.current = saveMapPressLocation;

  const handleSelectResource = (resource) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: resource.coords, zoom: 13 });
    if (popupRef.current) {
      popupRef.current.remove();
    }
    popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: false })
      .setLngLat(resource.coords)
      .setHTML(
        resourcePopupHtml(
          resource,
          typeLabels[resource.type] || t("map.resources.resource"),
          resource.distanceLabel || "",
        ),
      )
      .addTo(mapRef.current);
  };

  const handleSelectIncident = (incident) => {
    if (!mapRef.current) return;
    const coords = Number.isFinite(Number(incident?.displayLat)) && Number.isFinite(Number(incident?.displayLon))
      ? { lat: Number(incident.displayLat), lon: Number(incident.displayLon) }
      : getIncidentLatLon(incident);
    if (!coords) return;
    mapRef.current.flyTo({
      center: [coords.lon, coords.lat],
      zoom: incident.hasReliableGeo ? 13 : 11.8,
    });
    if (popupRef.current) {
      popupRef.current.remove();
    }
    popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: false })
      .setLngLat([coords.lon, coords.lat])
      .setHTML(
        incidentPopupHtml({
          ...normalizeIncidentForMap(incident, locale, t("map.states.unknownTime")),
          overlapCount: incident.overlapCount || 1,
          hasReliableGeo: incident.hasReliableGeo ?? hasReliableIncidentGeo(incident),
          radiusKm: getIncidentRadiusKm(incident),
        }),
      )
      .addTo(mapRef.current);
  };

  const criticalIncidentsCount = mapIncidents.filter(
    (item) => String(item.severity).toLowerCase() === "critical",
  ).length;
  const severeIncidentsCount = mapIncidents.filter((item) =>
    ["critical", "high"].includes(String(item.severity).toLowerCase()),
  ).length;
  const mapStatusLabel = incidentDataState === "live"
    ? t("map.states.live")
    : incidentDataState === "offline"
      ? t("map.states.offline")
      : t("map.states.localResources");

  const renderResourcesPanel = () => (
    <>
      <div className="map-list-head">
        <h2>{t("map.resources.title")}</h2>
        <span>{t("map.resources.results", { count: searchedResources.length })}</span>
      </div>
      <div className="map-search">
        <input
          type="search"
          placeholder={t("map.resources.searchPlaceholder")}
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>
      <div className="map-list">
        {searchedResources.map((resource) => {
          const [rlon, rlat] = resource.coords;
          return (
            <button
              key={`${resource.name}-${resource.coords.join("-")}`}
              type="button"
              className="map-list-item"
              onClick={() => handleSelectResource(resource)}
            >
              <div className="map-list-item-text">
                <span className="marker-name">{resource.name}</span>
                <span className="marker-type">{typeLabels[resource.type]}</span>
              </div>
              <div className="map-list-item-side">
                <span className="marker-distance">{resource.distanceLabel}</span>
                <span
                  className="map-nav-links"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  role="presentation"
                >
                  <a href={googleMapsUrl(rlat, rlon)} target="_blank" rel="noreferrer noopener">
                    Maps
                  </a>
                  <a href={wazeNavigateUrl(rlat, rlon)} target="_blank" rel="noreferrer noopener">
                    Waze
                  </a>
                </span>
              </div>
            </button>
          );
        })}
        {!searchedResources.length && (
          <p className="map-empty">{t("map.resources.empty")}</p>
        )}
      </div>
    </>
  );

  const renderIncidentsPanel = () => (
    <>
      <div className="map-list-head">
        <h2>{t("map.incidents.title")}</h2>
        <span>{mapIncidents.length}</span>
      </div>
      <div className="map-incident-strip">
        <span className="map-incident-strip-pill map-incident-strip-pill--critical">
          {t("map.incidents.critical", { count: criticalIncidentsCount })}
        </span>
        <span className="map-incident-strip-pill map-incident-strip-pill--high">
          {t("map.incidents.severe", { count: severeIncidentsCount })}
        </span>
      </div>
      <div className="map-list">
        {mapIncidents.map((incident, index) => (
          <button
            key={getIncidentListKey(incident, index)}
            type="button"
            className={`map-list-item map-list-item--incident severity-${String(incident.severity || "medium").toLowerCase()}`}
            onClick={() => handleSelectIncident(incident)}
          >
            <div className="map-incident-card-top">
              <span className="map-incident-kind">
                <span
                  className="map-incident-kind-dot"
                  aria-hidden="true"
                  style={{ background: incident.markerColor || "#475569" }}
                />
                {incident.kindLabel}
              </span>
              <span className={`map-incident-severity severity-${String(incident.severity || "medium").toLowerCase()}`}>
                {String(incident.severity || "medium").toUpperCase()}
              </span>
            </div>
            <div className="map-list-item-text map-list-item-text--incident">
              <span className="marker-name">{incident.title}</span>
              <span className="marker-type">
                {incident.locationLabel} - {incident.hasReliableGeo ? t("map.incidents.preciseGeo") : t("map.incidents.approximateGeo")}
              </span>
              <span className="marker-type">
                {incident.sourceLabel} - danger {Number(incident.dangerScore || severityDangerFallback(incident.severity))}
              </span>
              <span className="marker-type">{t("map.incidents.updated")}: {incident.timeLabel}</span>
              {Number(incident.overlapCount || 1) > 1 && (
                <span className="marker-type">{t("map.incidents.localGroup", { count: Number(incident.overlapCount) })}</span>
              )}
            </div>
            <div className="map-incident-card-bottom">
              <span className={`map-incident-status severity-${String(incident.severity || "medium").toLowerCase()}`}>
                {String(incident.status || "open").replaceAll("_", " ")}
              </span>
              <span className="map-incident-arrow">{t("map.actions.view")}</span>
            </div>
          </button>
        ))}
        {!mapIncidents.length && <p className="map-empty">{t("map.incidents.empty")}</p>}
      </div>
    </>
  );

  return (
    <section className="page-shell map-page mobile-shell">
      <header className="map-header mobile-card mobile-section-head">
        <div>
          <h1>{t("map.title")}</h1>
          <p>{t("map.subtitle")}</p>
        </div>
        <div className="map-tools" data-tutorial="map-tools">
          <button type="button" className="center-btn" onClick={handleCenterOnUser}>
            {locating ? t("map.actions.centering") : t("map.actions.center")}
          </button>
          <div className="map-offline">
            <span className="offline-dot" aria-hidden="true" />
            {mapStatusLabel}
          </div>
        </div>
      </header>
      {locationError && <p className="map-error">{locationError}</p>}
      {incidentDataState !== "live" && (
        <p className="map-error map-data-state">
          {t("map.states.staleIncidents")}
        </p>
      )}

      <section className="map-save" data-tutorial="map-save-location">
        <div className="save-header">
          <h2>{t("map.save.title")}</h2>
          <p>
            {t("map.save.help")}{" "}
            <strong>lat, lon</strong> {t("map.save.helpSuffix")}
          </p>
        </div>
        <div className="save-grid">
          <input
            type="text"
            placeholder={t("map.save.namePlaceholder")}
            value={manualName}
            onChange={(event) => setManualName(event.target.value)}
          />
            <input
              type="text"
              placeholder={'45°05\'59.3"N 24°22\'56.2"E'}
              value={manualRaw}
              onChange={(event) => setManualRaw(event.target.value)}
            />
          <button type="button" onClick={handleSaveLocation} disabled={isSaving}>
            {isSaving ? t("common.states.loading") : t("map.actions.saveLocation")}
          </button>
          <button type="button" onClick={handleUseCurrentLocation} disabled={isSaving}>
            {t("map.actions.useCurrent")}
          </button>
        </div>
        {saveMessage && <p className="save-message">{saveMessage}</p>}
        {savedLocation?.coordinates && (
          <div className="save-meta-row">
            <p className="save-meta">
              {t("map.save.current", { name: savedLocation.name || t("sos.states.savedLocation") })} -{" "}
              {savedLocation.raw
                ? savedLocation.raw
                : `${savedLocation.coordinates.lat.toFixed(4)}, ${savedLocation.coordinates.lon.toFixed(4)}`}
            </p>
            <div className="map-nav-links map-nav-links--inline">
              <a
                href={googleMapsUrl(savedLocation.coordinates.lat, savedLocation.coordinates.lon)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Google Maps
              </a>
              <a
                href={wazeNavigateUrl(savedLocation.coordinates.lat, savedLocation.coordinates.lon)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Waze
              </a>
            </div>
          </div>
        )}
      </section>

      <div className="map-filters" data-tutorial="map-filters">
        <button
          type="button"
          className={`filter-chip ${activeFilters.adapost ? "active" : ""}`}
          onClick={() =>
            setActiveFilters((current) => ({ ...current, adapost: !current.adapost }))
          }
        >
          {t("map.resources.shelter")}
        </button>
        <button
          type="button"
          className={`filter-chip ${activeFilters.farmacie ? "active" : ""}`}
          onClick={() =>
            setActiveFilters((current) => ({ ...current, farmacie: !current.farmacie }))
          }
        >
          {t("map.resources.pharmacy")}
        </button>
        <button
          type="button"
          className={`filter-chip ${activeFilters.spital ? "active" : ""}`}
          onClick={() =>
            setActiveFilters((current) => ({ ...current, spital: !current.spital }))
          }
        >
          {t("map.resources.hospital")}
        </button>
      </div>

      <div className={`map-grid ${isMobilePanelLayout ? "is-mobile" : ""}`}>
        {!isMobilePanelLayout ? (
          <aside className="map-list-panel map-list-panel--resources" data-tutorial="map-resource-list">
            {renderResourcesPanel()}
          </aside>
        ) : null}

        <div className="map-canvas" data-tutorial="map-canvas">
          <div ref={mapContainerRef} className="maplibre-container" />
          {isMobilePanelLayout ? (
            <button
              type="button"
              className="map-legend-toggle"
              onClick={() => setIsLegendOpen((current) => !current)}
              aria-expanded={isLegendOpen}
            >
              {isLegendOpen ? t("map.actions.hideLegend") : t("map.actions.showLegend")}
            </button>
          ) : null}
          <div className={`map-legend ${isMobilePanelLayout && !isLegendOpen ? "is-hidden" : ""}`}>
            <div className="legend-item">
              <span className="legend-dot adapost" />
              {t("map.resources.shelter")}
            </div>
            <div className="legend-item">
              <span className="legend-dot farmacie" />
              {t("map.resources.pharmacy")}
            </div>
            <div className="legend-item">
              <span className="legend-dot spital" />
              {t("map.resources.hospital")}
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: "#dc2626" }} />
              {t("map.legend.confirmedIncident")}
            </div>
            <div className="legend-item">
              <span className="legend-marker-modern legend-marker-modern--blocked_road">⛔</span>
              {t("map.legend.blockedRoad")}
            </div>
            <div className="legend-item">
              <span className="legend-marker-modern legend-marker-modern--congestion">🚧</span>
              {t("map.legend.congestion")}
            </div>
            <div className="legend-item">
              <span className="legend-marker-modern legend-marker-modern--police">👮</span>
              {t("map.legend.police")}
            </div>
            <div className="legend-item">
              <span className="legend-marker-modern legend-marker-modern--fire">🔥</span>
              {t("map.legend.fire")}
            </div>
            <div className="legend-item">
              <span className="legend-marker-modern legend-marker-modern--hazard">⚠️</span>
              {t("map.legend.hazard")}
            </div>
            <div className="legend-item">
              <span className="legend-dot legend-dot--approx" />
              {t("map.legend.approximateLocation")}
            </div>
          </div>
        </div>

        {!isMobilePanelLayout ? (
          <aside className="map-list-panel map-list-panel--incidents" data-tutorial="map-incident-list">
            {renderIncidentsPanel()}
          </aside>
        ) : null}
      </div>

      {isMobilePanelLayout ? (
        <section
          className="map-mobile-sheet mobile-card"
          data-tutorial={mobilePanel === "incidents" ? "map-incident-list" : "map-resource-list"}
        >
          <div className="map-mobile-sheet-head">
            <div>
              <h2>{mobilePanel === "incidents" ? t("map.incidents.title") : t("map.resources.nearbyTitle")}</h2>
              <p>
                {mobilePanel === "incidents"
                  ? t("map.mobile.incidentsBody")
                  : t("map.mobile.resourcesBody")}
              </p>
            </div>
            <div className="map-mobile-tabs mobile-segmented-tabs" role="tablist" aria-label={t("map.mobile.panelsAria")}>
              <button
                type="button"
                role="tab"
                aria-selected={mobilePanel === "incidents"}
                className={`map-mobile-tab mobile-segmented-tab ${mobilePanel === "incidents" ? "is-active" : ""}`}
                onClick={() => setMobilePanel("incidents")}
              >
                {t("map.mobile.incidentsTab")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobilePanel === "resources"}
                className={`map-mobile-tab mobile-segmented-tab ${mobilePanel === "resources" ? "is-active" : ""}`}
                onClick={() => setMobilePanel("resources")}
              >
                {t("map.mobile.resourcesTab")}
              </button>
            </div>
          </div>
          <div className="map-list-panel map-mobile-panel">
            {mobilePanel === "incidents" ? renderIncidentsPanel() : renderResourcesPanel()}
          </div>
        </section>
      ) : null}
    </section>
  );
};

export default MapPage;














