import { useEffect } from "react";

function syncViewportTokens() {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  const viewportWidth = Math.round(visualViewport?.width || window.innerWidth || 0);
  const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || 0);
  const offsetTop = Math.round(visualViewport?.offsetTop || 0);
  const offsetLeft = Math.round(visualViewport?.offsetLeft || 0);
  const keyboardInset = Math.max(0, Math.round((window.innerHeight || viewportHeight) - viewportHeight - offsetTop));

  root.style.setProperty("--app-viewport-width", `${viewportWidth}px`);
  root.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
  root.style.setProperty("--app-viewport-offset-top", `${offsetTop}px`);
  root.style.setProperty("--app-viewport-offset-left", `${offsetLeft}px`);
  root.style.setProperty("--app-keyboard-inset", `${keyboardInset}px`);
  root.dataset.keyboardOpen = keyboardInset > 120 ? "true" : "false";
}

function useViewportTokens() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let animationFrame = 0;
    const scheduleSync = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncViewportTokens);
    };

    scheduleSync();
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
    };
  }, []);
}

export default useViewportTokens;
