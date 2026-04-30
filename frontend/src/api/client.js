// src/api/client.js
import axios from "axios";
import { clearAuthSession, getAccessToken, isTokenExpired } from "../utils/authSession";

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeApiUrl = (rawUrl) => rawUrl.replace(/\/+$/, "");
const ABSOLUTE_PROTOCOL_PATTERN = /^https?:\/\//i;

const normalizeEnvApiUrl = (rawUrl) => {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return trimmed;

  if (ABSOLUTE_PROTOCOL_PATTERN.test(trimmed)) return trimmed;

  // Accept protocol-relative values such as //192.168.0.64:5000.
  if (trimmed.startsWith("//")) {
    const protocol =
      typeof window !== "undefined" && window.location?.protocol
        ? window.location.protocol
        : "http:";
    return `${protocol}${trimmed}`;
  }

  // Accept host-only values such as 192.168.0.64:5000.
  return `http://${trimmed.replace(/^\/+/, "")}`;
};

const resolveApiUrl = () => {
  const envApiUrl = normalizeEnvApiUrl(import.meta.env.VITE_API_URL);

  if (!envApiUrl) {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `http://${host}:5000`;
  }

  try {
    const parsed = new URL(envApiUrl);

    if (typeof window !== "undefined") {
      const frontendHost = window.location.hostname;
      const frontendIsRemote = !LOCALHOST_HOSTS.has(frontendHost);
      const apiIsLocalhost = LOCALHOST_HOSTS.has(parsed.hostname);

      // If frontend is opened from another device, localhost must point to that backend host.
      if (frontendIsRemote && apiIsLocalhost) {
        parsed.hostname = frontendHost;
      }
    }

    return parsed.toString();
  } catch {
    return envApiUrl;
  }
};

export const API_URL = normalizeApiUrl(resolveApiUrl());

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

let interceptorsRegistered = false;
let isHandlingAuthFailure = false;
let hasClearedExpiredToken = false;

const isAuthRequiredResponse = (error) => {
  const responseStatus = Number(error?.response?.status || 0);
  if (responseStatus !== 401) return false;
  const authHeader = error?.response?.headers?.["x-auth-required"];
  if (String(authHeader || "") === "1") return true;
  const requestAuthHeader = error?.config?.headers?.Authorization || error?.config?.headers?.authorization;
  return typeof requestAuthHeader === "string" && requestAuthHeader.startsWith("Bearer ");
};

const registerInterceptorsOnce = () => {
  if (interceptorsRegistered) return;
  interceptorsRegistered = true;

  apiClient.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) {
      if (isTokenExpired(token, 45)) {
        if (!hasClearedExpiredToken) {
          hasClearedExpiredToken = true;
          clearAuthSession({ reason: "expired_token_local" });
          window.dispatchEvent(new CustomEvent("authRequired", { detail: { status: 401, source: "local_expiry" } }));
        }
        return config;
      }
      hasClearedExpiredToken = false;
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
      const authRequired = isAuthRequiredResponse(error);
      if (authRequired && !isHandlingAuthFailure) {
        isHandlingAuthFailure = true;
        clearAuthSession({ reason: "auth_required_401" });
        window.dispatchEvent(new CustomEvent("authRequired", { detail: { status: 401 } }));
        window.setTimeout(() => {
          isHandlingAuthFailure = false;
        }, 0);
      }
      if (!authRequired) {
        console.error("API Error:", error.response?.data || error.message);
      }
      return Promise.reject(error);
    },
  );
};

registerInterceptorsOnce();

export default apiClient;
