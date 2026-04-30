/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LANGUAGE_OPTIONS, translations } from "./translations";

const LANGUAGE_STORAGE_KEY = "appLanguage";
const SUPPORTED_LANGUAGES = new Set(LANGUAGE_OPTIONS.map((option) => option.code));
const warnedMissingKeys = new Set();

const LanguageContext = createContext(null);

function readInitialLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (SUPPORTED_LANGUAGES.has(stored)) return stored;
  } catch {
    // ignore storage access errors
  }
  return "en";
}

function getByPath(source, key) {
  return String(key || "")
    .split(".")
    .reduce((current, part) => (current && Object.hasOwn(current, part) ? current[part] : undefined), source);
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : `{{${name}}}`,
  );
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readInitialLanguage);

  const setLanguage = useCallback((nextLanguage) => {
    if (!SUPPORTED_LANGUAGES.has(nextLanguage)) return;
    setLanguageState(nextLanguage);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // ignore storage access errors
    }
  }, []);

  const t = useCallback((key, params = {}) => {
    const template = getByPath(translations[language], key);
    if (typeof template !== "string") {
      if (import.meta.env.DEV && !warnedMissingKeys.has(`${language}:${key}`)) {
        warnedMissingKeys.add(`${language}:${key}`);
        console.warn(`[i18n] Missing translation key: ${language}:${key}`);
      }
      return key;
    }
    return interpolate(template, params);
  }, [language]);

  const locale = useMemo(
    () => LANGUAGE_OPTIONS.find((option) => option.code === language)?.locale || "en-US",
    [language],
  );

  const value = useMemo(
    () => ({
      language,
      locale,
      options: LANGUAGE_OPTIONS,
      setLanguage,
      t,
    }),
    [language, locale, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return context;
}
