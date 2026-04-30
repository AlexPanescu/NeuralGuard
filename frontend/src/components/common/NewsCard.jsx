import NewsVisual from "./NewsVisual";
import { useLanguage } from "../../i18n/LanguageContext";
import { formatNewsTimestamp } from "../../utils/newsPresentation";

const NewsCard = ({ item, onOpen, style, lowData = false }) => {
  const { locale, t } = useLanguage();
  const summary = item.summary || t("dashboard.news.noSummary");

  return (
    <article className="editorial-news-card" style={style}>
      <button type="button" className="editorial-news-button" onClick={() => onOpen(item)}>
        <NewsVisual
          imageUrl={item.imageUrl}
          source={item.source}
          title={item.title}
          variant="card"
          disableImage={lowData}
        />
        <div className="editorial-news-body">
          <div className="editorial-news-copy">
            <div className="editorial-news-topline">
              <span className="editorial-news-kicker">
                {item.isFallback ? t("dashboard.news.standbyBriefing") : t("dashboard.news.fieldSignal")}
              </span>
              <span className="editorial-news-timestamp">
                {formatNewsTimestamp(item.publishedAt, locale, t("dashboard.fallback.unknown"))}
              </span>
            </div>
            <h3>{item.title || t("dashboard.news.untitled")}</h3>
            <p>{summary}</p>
          </div>

          <div className="editorial-news-footer">
            <strong>{item.source || t("dashboard.news.unknownSource")}</strong>
            <span>{t("dashboard.news.openStory")}</span>
          </div>
        </div>
      </button>
    </article>
  );
};

export const NewsCardSkeleton = () => (
  <article className="editorial-news-card editorial-news-card-skeleton" aria-hidden="true">
    <div className="editorial-news-button">
      <div className="news-story-visual news-story-visual-card is-fallback is-skeleton" />
      <div className="editorial-news-body">
        <div className="editorial-news-copy">
          <div className="editorial-skeleton-line short" />
          <div className="editorial-skeleton-line title" />
          <div className="editorial-skeleton-line title secondary" />
          <div className="editorial-skeleton-line body" />
          <div className="editorial-skeleton-line body short" />
        </div>
        <div className="editorial-news-footer">
          <div className="editorial-skeleton-line footer" />
          <div className="editorial-skeleton-line footer short" />
        </div>
      </div>
    </div>
  </article>
);

export default NewsCard;
