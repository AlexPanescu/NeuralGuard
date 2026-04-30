/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getConnectionProfile,
  readCrisisModePreference,
  readOfflineLastSync,
  writeCrisisModePreference,
  writeOfflineLastSync,
} from "../utils/crisisMode";

const CrisisModeContext = createContext(null);

const getEffectiveMode = (preference, connectionProfile) => {
  if (preference === "low-data" || connectionProfile.saveData) return "low-data";
  if (preference === "offline-ready" || !connectionProfile.online) return "offline-ready";
  return "auto";
};

export const CrisisModeProvider = ({ children }) => {
  const [preference, setPreferenceState] = useState(readCrisisModePreference);
  const [connectionProfile, setConnectionProfile] = useState(getConnectionProfile);
  const [lastSync, setLastSync] = useState(readOfflineLastSync);

  const setPreference = useCallback((nextPreference) => {
    const normalized = writeCrisisModePreference(nextPreference);
    setPreferenceState(normalized);
  }, []);

  const refreshConnectionProfile = useCallback(() => {
    setConnectionProfile(getConnectionProfile());
  }, []);

  const markCriticalSync = useCallback(() => {
    const nextSync = writeOfflineLastSync();
    if (nextSync) setLastSync(nextSync);
    return nextSync;
  }, []);

  const effectiveMode = useMemo(
    () => getEffectiveMode(preference, connectionProfile),
    [connectionProfile, preference],
  );
  const isLowData = preference === "low-data" || connectionProfile.saveData;
  const isOffline = !connectionProfile.online;
  const isOfflineReady = preference === "offline-ready" || isOffline;

  useEffect(() => {
    window.addEventListener("online", refreshConnectionProfile);
    window.addEventListener("offline", refreshConnectionProfile);
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    connection?.addEventListener?.("change", refreshConnectionProfile);

    return () => {
      window.removeEventListener("online", refreshConnectionProfile);
      window.removeEventListener("offline", refreshConnectionProfile);
      connection?.removeEventListener?.("change", refreshConnectionProfile);
    };
  }, [refreshConnectionProfile]);

  useEffect(() => {
    document.documentElement.classList.toggle("crisis-low-data", isLowData);
    document.documentElement.dataset.crisisMode = effectiveMode;
    return () => {
      document.documentElement.classList.remove("crisis-low-data");
      delete document.documentElement.dataset.crisisMode;
    };
  }, [effectiveMode, isLowData]);

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      connectionProfile,
      effectiveMode,
      isLowData,
      isOfflineReady,
      isOffline,
      lastSync,
      markCriticalSync,
      refreshConnectionProfile,
    }),
    [
      connectionProfile,
      effectiveMode,
      isLowData,
      isOffline,
      isOfflineReady,
      lastSync,
      markCriticalSync,
      preference,
      refreshConnectionProfile,
      setPreference,
    ],
  );

  return (
    <CrisisModeContext.Provider value={value}>
      {children}
    </CrisisModeContext.Provider>
  );
};

export const useCrisisMode = () => {
  const context = useContext(CrisisModeContext);
  if (!context) {
    throw new Error("useCrisisMode must be used inside CrisisModeProvider");
  }
  return context;
};
