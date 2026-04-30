/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import {
  applyQuickA11yRootClass,
  getInitialQuickA11yEnabled,
  writeQuickA11yToCurrentUser,
  writeQuickA11yToStorage,
} from "./quickA11y";

const AccessibilityContext = createContext(null);

export function AccessibilityProvider({ children }) {
  const [isQuickA11yEnabled, setQuickA11yEnabledState] = useState(() => getInitialQuickA11yEnabled());

  useLayoutEffect(() => {
    applyQuickA11yRootClass(isQuickA11yEnabled);
    writeQuickA11yToStorage(isQuickA11yEnabled);
    writeQuickA11yToCurrentUser(isQuickA11yEnabled);
  }, [isQuickA11yEnabled]);

  const value = useMemo(
    () => ({
      isQuickA11yEnabled,
      setQuickA11yEnabled: (nextValue) => {
        setQuickA11yEnabledState(Boolean(nextValue));
      },
    }),
    [isQuickA11yEnabled],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility must be used inside AccessibilityProvider");
  }
  return context;
}
