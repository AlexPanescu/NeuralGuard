import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import NewsVisual from "./NewsVisual";
import { useLanguage } from "../../i18n/LanguageContext";
import {
  buildNewsParagraphs,
  formatNewsTimestamp,
} from "../../utils/newsPresentation";

const NewsDetailsModal = ({ news, loading, onClose }) => {
  const closeButtonRef = useRef(null);
  const { locale, t } = useLanguage();

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const paragraphs = buildNewsParagraphs(news.content);
  const hasContent = paragraphs.length > 0;
  const modalTitleId = `news-modal-title-${news.id || "active"}`;

  return createPortal(
    <div className="news-details-backdrop" role="presentation" onClick={onClose}>
      <article
        className="news-details-modal mobile-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="news-details-scroll">
          <header className="news-details-topbar">
            <div className="news-details-meta">
              <span className="news-story-source-chip">{news.source || t("dashboard.news.unknownSource")}</span>
              <span className="news-details-published">
                <span>{t("dashboard.news.published")}</span>
                <strong>{formatNewsTimestamp(news.publishedAt, locale, t("dashboard.fallback.unknown"))}</strong>
              </span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="news-details-close"
              onClick={onClose}
            >
              {t("dashboard.news.close")}
            </button>
          </header>

          <NewsVisual imageUrl={news.imageUrl} source={news.source} title={news.title} variant="hero" />

          <div className="news-details-content">
            <div className="news-details-heading">
              <p className="news-details-eyebrow">
                {news.isFallback ? t("dashboard.news.standbyCoverage") : t("dashboard.news.editorialBriefing")}
              </p>
              <h2 id={modalTitleId}>{news.title || t("dashboard.news.detailsTitle")}</h2>
              {news.summary ? <p className="news-details-dek">{news.summary}</p> : null}
            </div>

            {loading ? (
              <p className="news-details-status">{t("dashboard.news.loadingStory")}</p>
            ) : null}

            <div className="news-details-article">
              {(loading ? [] : paragraphs).map((paragraph, index) => (
                <p key={`${news.id || "news"}-paragraph-${index}`}>{paragraph}</p>
              ))}

              {!loading && !hasContent ? (
                <p className="news-details-empty-copy">
                  {t("dashboard.news.fullUnavailable")}
                </p>
              ) : null}
            </div>

            {news.tags.length ? (
              <div className="news-details-tag-row" aria-label="Story tags">
                {news.tags.map((tag) => (
                  <span key={`${news.id}-${tag}`} className="news-story-tag">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="news-details-footer">
          <div className="news-details-footer-copy">
            <span>{t("dashboard.news.source")}</span>
            <strong>{news.source || t("dashboard.news.unknownSource")}</strong>
          </div>
          {news.articleUrl ? (
            <a
              href={news.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="news-details-link"
            >
              {t("dashboard.news.readOriginal")}
            </a>
          ) : (
            <button type="button" className="news-details-link muted" disabled>
              {t("dashboard.news.noSourceLink")}
            </button>
          )}
        </footer>
      </article>
    </div>,
    document.body,
  );
};

export default NewsDetailsModal;
