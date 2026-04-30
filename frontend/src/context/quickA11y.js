const QUICK_A11Y_STORAGE_KEY = "quickAccessibilityMode";
const QUICK_A11Y_ROOT_CLASS = "quick-a11y-enabled";

function parseQuickA11yValue(rawValue) {
  if (rawValue === true || rawValue === "true" || rawValue === "1") return true;
  if (rawValue === false || rawValue === "false" || rawValue === "0") return false;
  return false;
}

function readQuickA11yFromStorage() {
  try {
    return parseQuickA11yValue(localStorage.getItem(QUICK_A11Y_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function writeQuickA11yToStorage(nextValue) {
  try {
    localStorage.setItem(QUICK_A11Y_STORAGE_KEY, nextValue ? "true" : "false");
  } catch {
    // ignore storage access errors
  }
}

export function writeQuickA11yToCurrentUser(nextValue) {
  try {
    const rawUser = localStorage.getItem("currentUser");
    if (!rawUser) return;
    const parsedUser = JSON.parse(rawUser);
    if (!parsedUser || typeof parsedUser !== "object") return;
    const nextUser = {
      ...parsedUser,
      preferences: {
        ...(parsedUser.preferences && typeof parsedUser.preferences === "object" ? parsedUser.preferences : {}),
        quickAccessibilityMode: nextValue,
      },
    };
    localStorage.setItem("currentUser", JSON.stringify(nextUser));
  } catch {
    // ignore storage parsing/writing errors
  }
}

export function applyQuickA11yRootClass(isEnabled) {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle(QUICK_A11Y_ROOT_CLASS, isEnabled);
}

export function getInitialQuickA11yEnabled() {
  const fromStorage = readQuickA11yFromStorage();
  if (fromStorage === true || fromStorage === false) return fromStorage;
  return false;
}

export function applyInitialQuickA11yClass() {
  applyQuickA11yRootClass(getInitialQuickA11yEnabled());
}

