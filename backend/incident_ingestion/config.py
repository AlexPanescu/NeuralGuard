from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List


def _load_env_file_if_present() -> None:
    env_file = os.getenv("ENV_FILE", "").strip()
    if not env_file or not os.path.exists(env_file):
        return
    with open(env_file, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_csv(name: str, default: str = "") -> List[str]:
    raw = os.getenv(name, default)
    return [chunk.strip() for chunk in raw.split(",") if chunk.strip()]


def _env_bbox(name: str, default: str) -> tuple[float, float, float, float]:
    raw = os.getenv(name, default)
    chunks = [chunk.strip() for chunk in raw.split(",") if chunk.strip()]
    if len(chunks) != 4:
        chunks = [chunk.strip() for chunk in default.split(",")]
    try:
        bottom, left, top, right = [float(item) for item in chunks]
    except ValueError:
        bottom, left, top, right = [float(item) for item in default.split(",")]
    # Keep sane ordering so callers can trust tuple shape.
    if bottom > top:
        bottom, top = top, bottom
    if left > right:
        left, right = right, left
    return (bottom, left, top, right)


@dataclass(frozen=True)
class AppConfig:
    mongo_uri: str
    mongo_db: str
    mongo_collection: str
    poll_interval_seconds: int
    resolve_ttl_minutes: int
    auto_sources_regex: str
    request_timeout_seconds: int
    max_item_age_hours: int
    user_agent: str
    rss_urls: List[str]
    bucharest_keywords: List[str]
    bucharest_bbox: tuple[float, float, float, float]
    include_waze_imports: bool
    dry_run: bool


def load_config() -> AppConfig:
    _load_env_file_if_present()

    keywords_default = ",".join(
        [
            "bucuresti",
            "sector 1",
            "sector 2",
            "sector 3",
            "sector 4",
            "sector 5",
            "sector 6",
            "otopeni",
            "centura capitalei",
            "centura bucuresti",
            "a0",
            "a 0",
            "a1 bucuresti",
            "a2 bucuresti",
            "dn1 bucuresti",
            "jilava",
            "chiajna",
            "cernica",
        ]
    )
    keyword_values = _env_csv("BUCHAREST_KEYWORDS", keywords_default)
    if not keyword_values:
        keyword_values = [chunk.strip() for chunk in keywords_default.split(",") if chunk.strip()]

    return AppConfig(
        mongo_uri=os.getenv("MONGO_URI", "").strip(),
        mongo_db=os.getenv("MONGO_DB", "test").strip(),
        mongo_collection=os.getenv("INCIDENTS_COLLECTION", "incidents").strip(),
        poll_interval_seconds=max(60, int(os.getenv("INCIDENTS_POLL_SECONDS", "900"))),
        resolve_ttl_minutes=max(5, int(os.getenv("INCIDENTS_RESOLVE_TTL_MINUTES", "60"))),
        auto_sources_regex=os.getenv(
            "INCIDENTS_AUTO_SOURCES_REGEX",
            r"^(accidenteromania|waze_live_map)",
        ).strip(),
        request_timeout_seconds=max(3, int(os.getenv("INCIDENTS_TIMEOUT_SECONDS", "20"))),
        max_item_age_hours=max(6, int(os.getenv("INCIDENTS_MAX_ITEM_AGE_HOURS", "72"))),
        user_agent=os.getenv(
            "INCIDENTS_USER_AGENT",
            "BucharestIncidentBot/1.0 (+local backend ingestion)",
        ).strip(),
        rss_urls=_env_csv("TRUSTED_RSS_URLS", ""),
        bucharest_keywords=[item.lower() for item in keyword_values],
        bucharest_bbox=_env_bbox("INCIDENTS_BUCHAREST_BBOX", "44.25,25.80,44.62,26.35"),
        include_waze_imports=_env_bool("INCIDENTS_INCLUDE_WAZE_IMPORTS", True),
        dry_run=_env_bool("INCIDENTS_DRY_RUN", False),
    )
