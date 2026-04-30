import { useState } from "react";
import "../../styles/components/NewsStory.css";

const LABELS = {
  card: "Top story",
  hero: "Feature image",
};

const NewsVisual = ({ imageUrl, source, title, variant = "card", disableImage = false }) => {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const hasImage = Boolean(imageUrl) && failedImageUrl !== String(imageUrl || "") && !disableImage;

  return (
    <div
      className={`news-story-visual news-story-visual-${variant} ${hasImage ? "has-image" : "is-fallback"} ${disableImage ? "is-low-data" : ""}`.trim()}
    >
      {hasImage ? (
        <img
          className="news-story-image"
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedImageUrl(String(imageUrl || ""))}
        />
      ) : null}
      <div className="news-story-visual-overlay" aria-hidden="true" />
      <div className="news-story-visual-meta">
        <span className="news-story-source-chip">{source || "Live brief"}</span>
        <span className="news-story-visual-label">{LABELS[variant] || LABELS.card}</span>
      </div>
      {!hasImage ? (
        <div className="news-story-fallback-copy" aria-hidden="true">
          <span>{source || "NeuralGuard brief"}</span>
          {variant === "hero" ? <strong>{title || "Featured coverage"}</strong> : null}
        </div>
      ) : null}
    </div>
  );
};

export default NewsVisual;
