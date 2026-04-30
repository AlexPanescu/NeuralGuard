import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../i18n/LanguageContext";
import "../../styles/overlays/tutorial.css";

const MOBILE_BREAKPOINT = 768;
const HIGHLIGHT_PADDING = 10;
const VIEWPORT_EDGE_GAP = 12;
const SELECTOR_RESOLVE_DELAY_MS = 75;
const LAYOUT_DEBOUNCE_MS = 60;
const SCROLL_SETTLE_DELAY_MS = 120;
const POPOVER_HEIGHT_ESTIMATE = 340;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportRect() {
  const visualViewport = window.visualViewport;
  const left = visualViewport?.offsetLeft || 0;
  const top = visualViewport?.offsetTop || 0;
  const width = visualViewport?.width || window.innerWidth;
  const height = visualViewport?.height || window.innerHeight;

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function expandRect(rect, element, viewport = getViewportRect()) {
  const computed = element ? window.getComputedStyle(element) : null;
  const radiusRaw = computed?.borderRadius || "18px";
  const firstRadiusToken = String(radiusRaw).split(" ")[0] || "18px";
  const firstRadius = Number.parseFloat(firstRadiusToken);
  const baseRadius = Number.isFinite(firstRadius) ? firstRadius : 18;
  const isRoundLike = rect.width > 0
    && Math.abs(rect.width - rect.height) <= 6
    && (String(radiusRaw).includes("%") || baseRadius >= Math.min(rect.width, rect.height) * 0.35);
  const radiusPx = isRoundLike
    ? Math.max(10, (Math.min(rect.width, rect.height) + HIGHLIGHT_PADDING * 2) / 2)
    : Math.max(10, baseRadius + 8);
  const nextRadius = isRoundLike ? "999px" : `${radiusPx}px`;

  const top = clamp(rect.top - HIGHLIGHT_PADDING, viewport.top, viewport.bottom);
  const left = clamp(rect.left - HIGHLIGHT_PADDING, viewport.left, viewport.right);
  const right = clamp(rect.right + HIGHLIGHT_PADDING, viewport.left, viewport.right);
  const bottom = clamp(rect.bottom + HIGHLIGHT_PADDING, viewport.top, viewport.bottom);

  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    borderRadius: nextRadius,
    borderRadiusPx: radiusPx,
  };
}

function getPopoverLayout({ targetRect, placement = "bottom", viewport = getViewportRect() }) {
  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;
  const isMobile = viewportWidth <= MOBILE_BREAKPOINT;
  const popoverHeightEstimate = Math.min(POPOVER_HEIGHT_ESTIMATE, viewportHeight - VIEWPORT_EDGE_GAP * 2);
  const cardWidth = Math.min(isMobile ? viewportWidth - VIEWPORT_EDGE_GAP * 2 : 360, viewportWidth - VIEWPORT_EDGE_GAP * 2);
  const gap = 16;
  const minLeft = viewport.left + VIEWPORT_EDGE_GAP;
  const maxLeft = viewport.right - cardWidth - VIEWPORT_EDGE_GAP;
  const minTop = viewport.top + VIEWPORT_EDGE_GAP;
  const maxTop = viewport.bottom - popoverHeightEstimate - VIEWPORT_EDGE_GAP;
  const centered = {
    width: cardWidth,
    top: clamp(viewport.top + viewportHeight / 2 - popoverHeightEstimate / 2, minTop, Math.max(minTop, maxTop)),
    left: clamp(viewport.left + (viewportWidth - cardWidth) / 2, minLeft, Math.max(minLeft, maxLeft)),
  };
  const edgeFallback = (preferBottom = true) => ({
    width: cardWidth,
    top: preferBottom ? Math.max(minTop, maxTop) : minTop,
    left: clamp(viewport.left + (viewportWidth - cardWidth) / 2, minLeft, Math.max(minLeft, maxLeft)),
  });

  if (!targetRect || placement === "center") {
    return { style: centered, arrow: null };
  }

  if (isMobile) {
    const targetTallerThanViewport = targetRect.height + HIGHLIGHT_PADDING * 2 >= viewportHeight - VIEWPORT_EDGE_GAP * 2;
    if (targetTallerThanViewport) {
      return { style: edgeFallback(placement !== "top"), arrow: null };
    }

    const centerLeft = clamp(targetRect.left + targetRect.width / 2 - cardWidth / 2, minLeft, Math.max(minLeft, maxLeft));
    const belowTop = targetRect.bottom + gap;
    const aboveTop = targetRect.top - popoverHeightEstimate - gap;
    const belowFits = belowTop + popoverHeightEstimate <= viewport.bottom - VIEWPORT_EDGE_GAP;
    const aboveFits = aboveTop >= viewport.top + VIEWPORT_EDGE_GAP;
    const preferredBelow = placement !== "top";

    if ((preferredBelow && belowFits) || (!aboveFits && belowFits)) {
      return {
        style: { width: cardWidth, top: belowTop, left: centerLeft },
        arrow: { side: "top", x: clamp(targetRect.left + targetRect.width / 2 - centerLeft, 24, cardWidth - 24) },
      };
    }

    if (aboveFits) {
      return {
        style: { width: cardWidth, top: aboveTop, left: centerLeft },
        arrow: { side: "bottom", x: clamp(targetRect.left + targetRect.width / 2 - centerLeft, 24, cardWidth - 24) },
      };
    }

    const spaceAbove = Math.max(0, targetRect.top - viewport.top - VIEWPORT_EDGE_GAP);
    const spaceBelow = Math.max(0, viewport.bottom - targetRect.bottom - VIEWPORT_EDGE_GAP);
    const useBelow = spaceBelow >= spaceAbove;
    const availableHeight = Math.max(spaceAbove, spaceBelow);
    const top = useBelow
      ? targetRect.bottom + gap
      : targetRect.top - Math.min(popoverHeightEstimate, availableHeight) - gap;

    return {
      style: {
        width: cardWidth,
        top: clamp(top, minTop, Math.max(minTop, maxTop)),
        left: centerLeft,
      },
      arrow: useBelow
        ? { side: "top", x: clamp(targetRect.left + targetRect.width / 2 - centerLeft, 24, cardWidth - 24) }
        : { side: "bottom", x: clamp(targetRect.left + targetRect.width / 2 - centerLeft, 24, cardWidth - 24) },
    };
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  let left = centerX - cardWidth / 2;
  let top = targetRect.bottom + gap;

  if (placement === "top") {
    top = targetRect.top - popoverHeightEstimate - 12;
  } else if (placement === "left") {
    left = targetRect.left - cardWidth - gap;
    top = centerY - popoverHeightEstimate / 2;
  } else if (placement === "right") {
    left = targetRect.right + gap;
    top = centerY - popoverHeightEstimate / 2;
  }

  return {
    style: {
      width: cardWidth,
      top: clamp(top, minTop, Math.max(minTop, maxTop)),
      left: clamp(left, minLeft, Math.max(minLeft, maxLeft)),
    },
    arrow: null,
  };
}

function rectEquals(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.round(a.top) === Math.round(b.top)
    && Math.round(a.left) === Math.round(b.left)
    && Math.round(a.width) === Math.round(b.width)
    && Math.round(a.height) === Math.round(b.height)
    && a.borderRadius === b.borderRadius
    && Math.round(a.borderRadiusPx || 0) === Math.round(b.borderRadiusPx || 0)
  );
}

function styleEquals(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.round(a.width) === Math.round(b.width)
    && Math.round(a.top) === Math.round(b.top)
    && Math.round(a.left) === Math.round(b.left)
  );
}

function isElementFullyVisible(element, viewport = getViewportRect()) {
  const rect = element.getBoundingClientRect();

  return (
    rect.top >= viewport.top + VIEWPORT_EDGE_GAP
    && rect.left >= viewport.left + VIEWPORT_EDGE_GAP
    && rect.bottom <= viewport.bottom - VIEWPORT_EDGE_GAP
    && rect.right <= viewport.right - VIEWPORT_EDGE_GAP
  );
}

function scrollElementForTutorial(element, placement = "bottom", viewport = getViewportRect()) {
  const rect = element.getBoundingClientRect();
  const isMobile = viewport.width <= MOBILE_BREAKPOINT;
  if (!isMobile) {
    if (isElementFullyVisible(element, viewport)) return false;
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return true;
  }

  const targetTallerThanViewport = rect.height + HIGHLIGHT_PADDING * 2 >= viewport.height - VIEWPORT_EDGE_GAP * 2;
  const availableHeight = Math.max(1, viewport.height - VIEWPORT_EDGE_GAP * 2);
  const desiredTop = targetTallerThanViewport
    ? viewport.top + VIEWPORT_EDGE_GAP
    : viewport.top + VIEWPORT_EDGE_GAP + Math.max(0, (availableHeight - rect.height) * (placement === "top" ? 0.55 : 0.35));
  const deltaY = rect.top - desiredTop;

  if (Math.abs(deltaY) < 6) return false;
  window.scrollBy({ top: deltaY, left: 0, behavior: "smooth" });
  return true;
}

function resolveTutorialText(item, field, t) {
  const key = item?.[`${field}Key`];
  if (key) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return item?.[field] || key || "";
}

function TutorialOverlay({ isOpen, tutorial, stepIndex, onStepChange, onClose }) {
  const { t } = useLanguage();
  const steps = useMemo(() => tutorial?.steps || [], [tutorial]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [highlightRect, setHighlightRect] = useState(null);
  const [popoverStyle, setPopoverStyle] = useState(() => ({ width: 360, top: 24, left: 24 }));
  const [popoverArrow, setPopoverArrow] = useState(null);
  const [currentStep, setCurrentStep] = useState(null);
  const lastScrollToIndexRef = useRef(-1);

  useEffect(() => {
    if (!isOpen) return undefined;

    let rafId = 0;
    let layoutTimerId = 0;
    let scrollTimerId = 0;
    let lastViewportHeight = getViewportRect().height;

    lastScrollToIndexRef.current = -1;

    const syncLayout = () => {
      const viewport = getViewportRect();
      if (!steps.length) {
        setCurrentStep(null);
        setHighlightRect((prev) => (prev ? null : prev));
        setPopoverStyle((prev) => {
          const next = getPopoverLayout({ targetRect: null, placement: "center", viewport }).style;
          return styleEquals(prev, next) ? prev : next;
        });
        setPopoverArrow(null);
        return;
      }

      let resolvedIndex = Math.min(stepIndex, steps.length - 1);
      let resolvedElement = null;

      while (resolvedIndex < steps.length && !resolvedElement) {
        const step = steps[resolvedIndex];
        if (!step?.selector) break;
        const candidate = document.querySelector(step.selector);
        if (candidate instanceof HTMLElement) {
          resolvedElement = candidate;
          break;
        }
        resolvedIndex += 1;
      }

      if (resolvedIndex >= steps.length) {
        resolvedIndex = Math.min(stepIndex, steps.length - 1);
      }

      if (resolvedIndex !== stepIndex) {
        onStepChange(resolvedIndex);
      }

      const resolvedStep = steps[resolvedIndex] || null;
      setActiveIndex(resolvedIndex);
      setCurrentStep((prev) => (prev === resolvedStep ? prev : resolvedStep));

      if (
        resolvedElement
        && lastScrollToIndexRef.current !== resolvedIndex
      ) {
        lastScrollToIndexRef.current = resolvedIndex;
        if (scrollElementForTutorial(resolvedElement, resolvedStep?.placement || "bottom", viewport)) {
          scrollTimerId = window.setTimeout(scheduleSync, SCROLL_SETTLE_DELAY_MS);
          return;
        }
      }

      const targetRect = resolvedElement?.getBoundingClientRect() || null;
      const nextHighlight = targetRect && resolvedElement ? expandRect(targetRect, resolvedElement, viewport) : null;
      setHighlightRect((prev) => (rectEquals(prev, nextHighlight) ? prev : nextHighlight));

      const nextLayout = getPopoverLayout({
        targetRect,
        placement: resolvedStep?.placement || "bottom",
        viewport,
      });
      const nextPopover = nextLayout.style;
      setPopoverStyle((prev) => (styleEquals(prev, nextPopover) ? prev : nextPopover));
      setPopoverArrow(nextLayout.arrow);
    };

    const scheduleSync = (delay = LAYOUT_DEBOUNCE_MS) => {
      if (layoutTimerId) window.clearTimeout(layoutTimerId);
      layoutTimerId = window.setTimeout(() => {
        layoutTimerId = 0;
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          syncLayout();
        });
      }, delay);
    };

    const scheduleImmediateSync = () => {
      if (layoutTimerId) window.clearTimeout(layoutTimerId);
      layoutTimerId = 0;
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncLayout();
      });
    };

    const handleViewportChange = () => {
      const nextHeight = getViewportRect().height;
      const heightDelta = Math.abs(nextHeight - lastViewportHeight);
      lastViewportHeight = nextHeight;
      if (heightDelta > 80) {
        scheduleImmediateSync();
        return;
      }
      scheduleSync();
    };

    const handleDebouncedLayout = () => scheduleSync();

    scheduleSync(SELECTOR_RESOLVE_DELAY_MS);
    window.addEventListener("resize", handleDebouncedLayout, { passive: true });
    window.addEventListener("orientationchange", scheduleImmediateSync, { passive: true });
    window.addEventListener("scroll", handleDebouncedLayout, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleViewportChange, { passive: true });

    return () => {
      window.removeEventListener("resize", handleDebouncedLayout);
      window.removeEventListener("orientationchange", scheduleImmediateSync);
      window.removeEventListener("scroll", handleDebouncedLayout, true);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      if (layoutTimerId) window.clearTimeout(layoutTimerId);
      if (scrollTimerId) window.clearTimeout(scrollTimerId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isOpen, onStepChange, stepIndex, steps]);

  useEffect(() => {
    if (!isOpen) return undefined;
    document.body.classList.add("tutorial-open");
    return () => document.body.classList.remove("tutorial-open");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight" && activeIndex < steps.length - 1) {
        onStepChange(activeIndex + 1);
      }
      if (event.key === "ArrowLeft" && activeIndex > 0) {
        onStepChange(activeIndex - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, isOpen, onClose, onStepChange, steps.length]);

  if (!isOpen || !tutorial) {
    return null;
  }

  const tutorialTitle = resolveTutorialText(tutorial, "title", t);
  const tutorialDescription = resolveTutorialText(tutorial, "description", t);
  const stepTitle = resolveTutorialText(currentStep, "title", t);
  const stepDescription = resolveTutorialText(currentStep, "description", t);
  const canGoBack = activeIndex > 0;
  const canGoNext = activeIndex < steps.length - 1;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cutoutRight = highlightRect ? highlightRect.left + highlightRect.width : 0;
  const cutoutBottom = highlightRect ? highlightRect.top + highlightRect.height : 0;
  const cornerRadius = highlightRect
    ? Math.max(
        0,
        Math.min(
          highlightRect.borderRadiusPx || 0,
          highlightRect.width / 2,
          highlightRect.height / 2,
        ),
      )
    : 0;
  const cornerMaskSize = Math.max(0, Math.floor(cornerRadius));
  const cornerStops = cornerMaskSize > 1
    ? {
        transparent: Math.max(0, cornerMaskSize - 0.5),
        solid: cornerMaskSize,
      }
    : null;

  return createPortal(
    <div className="tutorial-overlay" role="presentation">
      {highlightRect ? (
        <>
          <div className="tutorial-backdrop tutorial-backdrop-segment" style={{ top: 0, left: 0, width: "100%", height: `${Math.max(0, highlightRect.top)}px` }} aria-hidden="true" />
          <div className="tutorial-backdrop tutorial-backdrop-segment" style={{ top: `${highlightRect.top}px`, left: 0, width: `${Math.max(0, highlightRect.left)}px`, height: `${Math.max(0, highlightRect.height)}px` }} aria-hidden="true" />
          <div className="tutorial-backdrop tutorial-backdrop-segment" style={{ top: `${highlightRect.top}px`, left: `${cutoutRight}px`, width: `${Math.max(0, viewportWidth - cutoutRight)}px`, height: `${Math.max(0, highlightRect.height)}px` }} aria-hidden="true" />
          <div className="tutorial-backdrop tutorial-backdrop-segment" style={{ top: `${cutoutBottom}px`, left: 0, width: "100%", height: `${Math.max(0, viewportHeight - cutoutBottom)}px` }} aria-hidden="true" />
          {cornerMaskSize > 1 && cornerStops ? (
            <>
              <div
                className="tutorial-backdrop tutorial-corner-blur"
                style={{
                  top: `${highlightRect.top}px`,
                  left: `${highlightRect.left}px`,
                  width: `${cornerMaskSize}px`,
                  height: `${cornerMaskSize}px`,
                  WebkitMaskImage: `radial-gradient(circle ${cornerMaskSize}px at 100% 100%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                  maskImage: `radial-gradient(circle ${cornerMaskSize}px at 100% 100%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                }}
                aria-hidden="true"
              />
              <div
                className="tutorial-backdrop tutorial-corner-blur"
                style={{
                  top: `${highlightRect.top}px`,
                  left: `${highlightRect.left + highlightRect.width - cornerMaskSize}px`,
                  width: `${cornerMaskSize}px`,
                  height: `${cornerMaskSize}px`,
                  WebkitMaskImage: `radial-gradient(circle ${cornerMaskSize}px at 0% 100%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                  maskImage: `radial-gradient(circle ${cornerMaskSize}px at 0% 100%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                }}
                aria-hidden="true"
              />
              <div
                className="tutorial-backdrop tutorial-corner-blur"
                style={{
                  top: `${highlightRect.top + highlightRect.height - cornerMaskSize}px`,
                  left: `${highlightRect.left}px`,
                  width: `${cornerMaskSize}px`,
                  height: `${cornerMaskSize}px`,
                  WebkitMaskImage: `radial-gradient(circle ${cornerMaskSize}px at 100% 0%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                  maskImage: `radial-gradient(circle ${cornerMaskSize}px at 100% 0%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                }}
                aria-hidden="true"
              />
              <div
                className="tutorial-backdrop tutorial-corner-blur"
                style={{
                  top: `${highlightRect.top + highlightRect.height - cornerMaskSize}px`,
                  left: `${highlightRect.left + highlightRect.width - cornerMaskSize}px`,
                  width: `${cornerMaskSize}px`,
                  height: `${cornerMaskSize}px`,
                  WebkitMaskImage: `radial-gradient(circle ${cornerMaskSize}px at 0% 0%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                  maskImage: `radial-gradient(circle ${cornerMaskSize}px at 0% 0%, transparent ${cornerStops.transparent}px, #000 ${cornerStops.solid}px)`,
                }}
                aria-hidden="true"
              />
            </>
          ) : null}
        </>
      ) : (
        <div
          className="tutorial-backdrop"
          aria-hidden="true"
        />
      )}

      {highlightRect ? (
        <div
          className="tutorial-highlight"
          style={{
            top: `${highlightRect.top}px`,
            left: `${highlightRect.left}px`,
            width: `${highlightRect.width}px`,
            height: `${highlightRect.height}px`,
            borderRadius: highlightRect.borderRadius,
          }}
          aria-hidden="true"
        />
      ) : null}

      <section
        className="tutorial-popover"
        role="dialog"
        aria-modal="true"
        aria-label={tutorialTitle}
        style={{
          width: `${popoverStyle.width}px`,
          top: `${popoverStyle.top}px`,
          left: `${popoverStyle.left}px`,
        }}
      >
        {popoverArrow ? (
          <span
            className={`tutorial-popover-arrow ${popoverArrow.side}`}
            style={{ left: `${popoverArrow.x}px` }}
            aria-hidden="true"
          />
        ) : null}
        <div className="tutorial-popover-topline">
          <div>
            <p className="tutorial-kicker">{tutorialTitle}</p>
            <h2>{stepTitle || tutorialTitle}</h2>
          </div>
          <button type="button" className="tutorial-close mobile-sheet-close" onClick={onClose} aria-label={t("tutorial.controls.close")}>
            x
          </button>
        </div>

        <p className="tutorial-copy">
          {stepDescription || tutorialDescription}
        </p>

        <div className="tutorial-progress" aria-hidden="true">
          {steps.length ? `${Math.min(activeIndex + 1, steps.length)} / ${steps.length}` : t("tutorial.controls.overview")}
        </div>

        <div className="tutorial-actions">
          <button type="button" className="tutorial-secondary" onClick={onClose}>
            {t("tutorial.controls.close")}
          </button>
          <button
            type="button"
            className="tutorial-secondary"
            onClick={() => onStepChange(activeIndex - 1)}
            disabled={!canGoBack}
          >
            {t("tutorial.controls.back")}
          </button>
          <button
            type="button"
            className="tutorial-primary"
            onClick={() => {
              if (canGoNext) {
                onStepChange(activeIndex + 1);
                return;
              }
              onClose();
            }}
          >
            {canGoNext ? t("tutorial.controls.next") : t("tutorial.controls.finish")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default TutorialOverlay;
