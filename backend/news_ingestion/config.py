from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List


DEFAULT_NEWS_SOURCE_URLS = ",".join(
    [
        "https://www.nytimes.com/",
        "https://www.digi24.ro/ultimele-stiri",
        "https://www.bbc.com/news",
        "https://hotnews.ro/ultima-ora",
        "https://www.politico.com/",
    ]
)


def _load_env_file_if_present() -> None:
    env_file = os.getenv("ENV_FILE", ".env.news").strip()
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


@dataclass(frozen=True)
class AppConfig:
    mongo_uri: str
    mongo_db: str
    mongo_collection: str
    poll_interval_seconds: int
    request_timeout_seconds: int
    user_agent: str
    source_urls: List[str]
    keywords: List[str]
    max_items_per_source: int
    dry_run: bool
    translation_enabled: bool
    translation_target_langs: List[str]
    translation_provider: str
    translation_provider_version: str
    translation_auto_install_models: bool
    translation_backfill_limit: int


def load_config() -> AppConfig:
    _load_env_file_if_present()
    return AppConfig(
        mongo_uri=os.getenv("MONGO_URI", "").strip(),
        mongo_db=os.getenv("MONGO_DB", "test").strip(),
        mongo_collection=os.getenv("NEWS_COLLECTION", "news").strip(),
        poll_interval_seconds=max(60, int(os.getenv("NEWS_POLL_SECONDS", "900"))),
        request_timeout_seconds=max(3, int(os.getenv("NEWS_TIMEOUT_SECONDS", "20"))),
        user_agent=os.getenv(
            "NEWS_USER_AGENT",
            "NeuralGuardNewsBot/1.0 (+local backend ingestion)",
        ).strip(),
        source_urls=_env_csv("NEWS_SOURCE_URLS", DEFAULT_NEWS_SOURCE_URLS),
        keywords=[item.lower() for item in _env_csv("NEWS_KEYWORDS", "")],
        max_items_per_source=max(1, int(os.getenv("NEWS_MAX_ITEMS_PER_SOURCE", "1"))),
        dry_run=_env_bool("NEWS_DRY_RUN", False),
        translation_enabled=_env_bool("NEWS_TRANSLATION_ENABLED", True),
        translation_target_langs=[
            item.lower()
            for item in _env_csv("NEWS_TRANSLATION_TARGET_LANGS", "ro,en")
            if item.lower() in {"ro", "en"}
        ],
        translation_provider=os.getenv("NEWS_TRANSLATION_PROVIDER", "argos-translate").strip() or "argos-translate",
        translation_provider_version=os.getenv("NEWS_TRANSLATION_PROVIDER_VERSION", "local-v1").strip() or "local-v1",
        translation_auto_install_models=_env_bool("NEWS_TRANSLATION_AUTO_INSTALL_MODELS", False),
        translation_backfill_limit=max(1, int(os.getenv("NEWS_TRANSLATION_BACKFILL_LIMIT", "50"))),
    )
