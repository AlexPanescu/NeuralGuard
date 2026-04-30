import { useEffect, useRef, useState } from "react";

function useReveal(options = {}) {
  const {
    once = true,
    threshold = 0.16,
    rootMargin = "0px 0px -8% 0px",
    disabled = false,
  } = options;
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const resolvedVisible = disabled || isVisible;

  useEffect(() => {
    if (disabled) return undefined;

    const node = ref.current;
    if (!node) return undefined;

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      queueMicrotask(() => setIsVisible(true));
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setIsVisible(false);
          }
        });
      },
      { threshold, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, once, rootMargin, threshold]);

  return { ref, isVisible: resolvedVisible };
}

export default useReveal;
