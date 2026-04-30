import { useEffect } from "react";

const LOCK_COUNT_KEY = "scrollLockCount";
const BODY_OVERFLOW_KEY = "scrollLockBodyOverflow";
const BODY_TOUCH_ACTION_KEY = "scrollLockBodyTouchAction";
const ROOT_OVERFLOW_KEY = "scrollLockRootOverflow";

function lockDocumentScroll() {
  if (typeof document === "undefined") return;

  const body = document.body;
  const root = document.documentElement;
  const currentLocks = Number(body.dataset[LOCK_COUNT_KEY] || 0);

  if (currentLocks === 0) {
    body.dataset[BODY_OVERFLOW_KEY] = body.style.overflow;
    body.dataset[BODY_TOUCH_ACTION_KEY] = body.style.touchAction;
    root.dataset[ROOT_OVERFLOW_KEY] = root.style.overflow;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    root.style.overflow = "hidden";
  }

  body.dataset[LOCK_COUNT_KEY] = String(currentLocks + 1);
}

function unlockDocumentScroll() {
  if (typeof document === "undefined") return;

  const body = document.body;
  const root = document.documentElement;
  const currentLocks = Number(body.dataset[LOCK_COUNT_KEY] || 0);

  if (currentLocks <= 1) {
    body.style.overflow = body.dataset[BODY_OVERFLOW_KEY] || "";
    body.style.touchAction = body.dataset[BODY_TOUCH_ACTION_KEY] || "";
    root.style.overflow = root.dataset[ROOT_OVERFLOW_KEY] || "";
    delete body.dataset[LOCK_COUNT_KEY];
    delete body.dataset[BODY_OVERFLOW_KEY];
    delete body.dataset[BODY_TOUCH_ACTION_KEY];
    delete root.dataset[ROOT_OVERFLOW_KEY];
    return;
  }

  body.dataset[LOCK_COUNT_KEY] = String(currentLocks - 1);
}

function useDocumentScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return undefined;

    lockDocumentScroll();
    return () => unlockDocumentScroll();
  }, [isLocked]);
}

export default useDocumentScrollLock;
