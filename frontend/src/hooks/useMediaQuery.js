import { useEffect, useState } from "react";

function getMatches(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(query).matches;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(query);
    let animationFrame = 0;
    const syncMatches = (event) => {
      setMatches(event.matches);
    };

    animationFrame = window.requestAnimationFrame(() => {
      setMatches(mediaQuery.matches);
    });
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncMatches);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        mediaQuery.removeEventListener("change", syncMatches);
      };
    }

    mediaQuery.addListener(syncMatches);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      mediaQuery.removeListener(syncMatches);
    };
  }, [query]);

  return matches;
}

export default useMediaQuery;
