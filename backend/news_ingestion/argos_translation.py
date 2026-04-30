from __future__ import annotations

import html
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple


TRANSLATABLE_FIELDS = ("title", "summary", "content")
SUPPORTED_TARGET_LANGUAGES = {"ro", "en"}
DEFAULT_PROVIDER = "argos-translate"
DEFAULT_PROVIDER_VERSION = "local-v1"
_setup_logged = False


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_csv(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    return [chunk.strip().lower() for chunk in raw.split(",") if chunk.strip()]


def is_translation_enabled() -> bool:
    return _env_bool("NEWS_TRANSLATION_ENABLED", True)


def get_target_languages() -> List[str]:
    return [lang for lang in _env_csv("NEWS_TRANSLATION_TARGET_LANGS", "ro,en") if lang in SUPPORTED_TARGET_LANGUAGES]


def get_provider() -> str:
    return os.getenv("NEWS_TRANSLATION_PROVIDER", DEFAULT_PROVIDER).strip() or DEFAULT_PROVIDER


def get_provider_version() -> str:
    return os.getenv("NEWS_TRANSLATION_PROVIDER_VERSION", DEFAULT_PROVIDER_VERSION).strip() or DEFAULT_PROVIDER_VERSION


def _normalize_source_field(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value).strip()


def _has_text(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def compute_translation_source_hash(article: Dict[str, Any]) -> str:
    payload = {field: _normalize_source_field(article.get(field)) for field in TRANSLATABLE_FIELDS}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _get_cached_translation(article: Dict[str, Any], target_lang: str) -> Optional[Dict[str, Any]]:
    translations = article.get("translations") or {}
    if not isinstance(translations, dict):
        return None
    cached = translations.get(target_lang)
    return cached if isinstance(cached, dict) else None


def has_valid_cached_translation(article: Dict[str, Any], target_lang: str) -> bool:
    cached = _get_cached_translation(article, target_lang)
    if not cached:
        return False
    if cached.get("provider") != get_provider():
        return False
    if cached.get("providerVersion") != get_provider_version():
        return False
    if cached.get("translationSourceHash") != compute_translation_source_hash(article):
        return False

    for field in TRANSLATABLE_FIELDS:
        if _has_text(article.get(field)) and not _has_text(cached.get(field)):
            return False
        if not _has_text(article.get(field)) and field not in cached:
            return False
    return True


@dataclass
class TranslationStats:
    attempted: int = 0
    translated: int = 0
    cached: int = 0
    skipped: int = 0
    failed: int = 0
    missingModel: int = 0

    def add(self, other: "TranslationStats") -> None:
        self.attempted += other.attempted
        self.translated += other.translated
        self.cached += other.cached
        self.skipped += other.skipped
        self.failed += other.failed
        self.missingModel += other.missingModel

    def to_dict(self) -> Dict[str, int]:
        return {
            "attempted": self.attempted,
            "translated": self.translated,
            "cached": self.cached,
            "skipped": self.skipped,
            "failed": self.failed,
            "missingModel": self.missingModel,
        }


@dataclass(frozen=True)
class ArgosRuntime:
    translate_module: Any = None
    package_module: Any = None
    import_error: str = ""


def _load_argos_runtime() -> ArgosRuntime:
    try:
        import argostranslate.package as package_module  # type: ignore
        import argostranslate.translate as translate_module  # type: ignore

        return ArgosRuntime(translate_module=translate_module, package_module=package_module)
    except Exception as exc:
        return ArgosRuntime(import_error=str(exc))


def _installed_languages(runtime: ArgosRuntime) -> List[Any]:
    if not runtime.translate_module:
        return []
    try:
        return list(runtime.translate_module.get_installed_languages())
    except Exception:
        return []


def _installed_pairs(runtime: ArgosRuntime) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    languages = _installed_languages(runtime)
    for source in languages:
        for target in languages:
            if getattr(source, "code", "") == getattr(target, "code", ""):
                continue
            try:
                translation = source.get_translation(target)
            except Exception:
                translation = None
            if translation:
                pairs.append((source.code, target.code))
    return sorted(set(pairs))


def _find_translation(runtime: ArgosRuntime, source_lang: str, target_lang: str) -> Any:
    for source in _installed_languages(runtime):
        if getattr(source, "code", "") != source_lang:
            continue
        for target in _installed_languages(runtime):
            if getattr(target, "code", "") != target_lang:
                continue
            try:
                return source.get_translation(target)
            except Exception:
                return None
    return None


def _log_setup_instructions_once(runtime: ArgosRuntime, logger: Callable[[str], None] = print) -> None:
    global _setup_logged
    if _setup_logged:
        return
    _setup_logged = True

    if runtime.import_error:
        logger(f"Argos Translate unavailable: {runtime.import_error}")
        logger("Install dependency with: pip install -r backend/news_ingestion/requirements.txt")
        return

    pairs = _installed_pairs(runtime)
    pair_text = ", ".join(f"{src}->{dst}" for src, dst in pairs) or "none"
    logger(f"Argos installed language pairs: {pair_text}")
    if ("en", "ro") not in pairs or ("ro", "en") not in pairs:
        logger("Argos en<->ro models are missing; news translation will be skipped.")
        logger("Install models manually with:")
        logger("  argospm update")
        logger("  argospm install translate-en_ro")
        logger("  argospm install translate-ro_en")


def _maybe_auto_install_models(runtime: ArgosRuntime, logger: Callable[[str], None] = print) -> None:
    if not _env_bool("NEWS_TRANSLATION_AUTO_INSTALL_MODELS", False):
        return
    if not runtime.package_module:
        return
    try:
        runtime.package_module.update_package_index()
        available = runtime.package_module.get_available_packages()
        for source_lang, target_lang in (("en", "ro"), ("ro", "en")):
            if _find_translation(runtime, source_lang, target_lang):
                continue
            package = next(
                (
                    item
                    for item in available
                    if getattr(item, "from_code", "") == source_lang and getattr(item, "to_code", "") == target_lang
                ),
                None,
            )
            if package:
                runtime.package_module.install_from_path(package.download())
    except Exception as exc:
        logger(f"Argos model auto-install failed: {exc}")


def _models_ready(runtime: ArgosRuntime, logger: Callable[[str], None] = print) -> bool:
    if runtime.import_error:
        _log_setup_instructions_once(runtime, logger)
        return False
    _maybe_auto_install_models(runtime, logger)
    pairs = _installed_pairs(runtime)
    ready = ("en", "ro") in pairs and ("ro", "en") in pairs
    if not ready:
        _log_setup_instructions_once(runtime, logger)
    return ready


def log_argos_setup_status(logger: Callable[[str], None] = print, allow_auto_install: bool = True) -> bool:
    if not is_translation_enabled():
        return False
    runtime = _load_argos_runtime()
    if runtime.import_error:
        _log_setup_instructions_once(runtime, logger)
        return False
    if allow_auto_install:
        _maybe_auto_install_models(runtime, logger)
    pairs = _installed_pairs(runtime)
    ready = ("en", "ro") in pairs and ("ro", "en") in pairs
    if not ready:
        _log_setup_instructions_once(runtime, logger)
    return ready


def _detect_source_language(article: Dict[str, Any]) -> str:
    for key in ("language", "sourceLanguage", "lang"):
        value = str(article.get(key) or "").strip().lower()[:2]
        if value in SUPPORTED_TARGET_LANGUAGES:
            return value

    source_blob = " ".join(
        str(article.get(key) or "").lower()
        for key in ("source", "articleUrl", "sourceKey", "articleUrlKey")
    )
    if any(token in source_blob for token in ("digi24", "hotnews", ".ro")):
        return "ro"
    if any(token in source_blob for token in ("bbc", "nytimes", "politico", ".com")):
        return "en"

    text = " ".join(str(article.get(field) or "").lower() for field in TRANSLATABLE_FIELDS)
    ro_score = sum(text.count(token) for token in (" si ", " este ", " pentru ", " in ", " la ", " cu ", " un ", " o "))
    ro_score += sum(text.count(char) for char in "ăâîșț")
    en_score = sum(text.count(token) for token in (" and ", " is ", " for ", " in ", " at ", " with ", " the ", " a "))
    if ro_score > en_score and ro_score > 0:
        return "ro"
    if en_score > ro_score and en_score > 0:
        return "en"
    return ""


def _resolve_source_language(article: Dict[str, Any], target_lang: str, runtime: ArgosRuntime) -> str:
    detected = _detect_source_language(article)
    if detected:
        return detected
    candidates = sorted({source for source, target in _installed_pairs(runtime) if target == target_lang})
    return candidates[0] if len(candidates) == 1 else ""


def _build_original_translation(article: Dict[str, Any], target_lang: str, source_hash: str, source_lang: str) -> Dict[str, Any]:
    return {
        "title": _normalize_source_field(article.get("title")),
        "summary": _normalize_source_field(article.get("summary")),
        "content": _normalize_source_field(article.get("content")),
        "translatedAt": datetime.now(tz=timezone.utc),
        "provider": get_provider(),
        "providerVersion": get_provider_version(),
        "sourceLanguage": source_lang or target_lang,
        "translationSourceHash": source_hash,
    }


def translate_article_fields(
    article: Dict[str, Any],
    target_lang: str,
    *,
    runtime: Optional[ArgosRuntime] = None,
    logger: Callable[[str], None] = print,
) -> Optional[Dict[str, Any]]:
    runtime = runtime or _load_argos_runtime()
    source_lang = _resolve_source_language(article, target_lang, runtime)
    source_hash = compute_translation_source_hash(article)

    if source_lang == target_lang:
        return _build_original_translation(article, target_lang, source_hash, source_lang)
    if not source_lang:
        logger(f"Argos source language unknown for news {article.get('_id') or article.get('sourceKey')}; skipping {target_lang}.")
        return None

    translation = _find_translation(runtime, source_lang, target_lang)
    if not translation:
        logger(f"Argos model missing for {source_lang}->{target_lang}; skipping news {article.get('_id') or article.get('sourceKey')}.")
        return None

    translated: Dict[str, Any] = {}
    for field in TRANSLATABLE_FIELDS:
        value = _normalize_source_field(article.get(field))
        if not _has_text(value):
            translated[field] = value
            continue
        translated[field] = html.unescape(str(translation.translate(value))).strip()

    translated.update(
        {
            "translatedAt": datetime.now(tz=timezone.utc),
            "provider": get_provider(),
            "providerVersion": get_provider_version(),
            "sourceLanguage": source_lang,
            "translationSourceHash": source_hash,
        }
    )
    return translated


def translate_article_if_needed(
    article: Dict[str, Any],
    target_lang: str,
    force: bool = False,
    *,
    collection: Any = None,
    dry_run: bool = False,
    runtime: Optional[ArgosRuntime] = None,
    stats: Optional[TranslationStats] = None,
    logger: Callable[[str], None] = print,
) -> Optional[Dict[str, Any]]:
    stats = stats or TranslationStats()
    runtime = runtime or _load_argos_runtime()

    if not is_translation_enabled() or target_lang not in SUPPORTED_TARGET_LANGUAGES:
        stats.skipped += 1
        return None
    if not force and has_valid_cached_translation(article, target_lang):
        stats.cached += 1
        return _get_cached_translation(article, target_lang)

    has_any_source_text = any(_has_text(article.get(field)) for field in TRANSLATABLE_FIELDS)
    if not has_any_source_text:
        stats.skipped += 1
        return None

    stats.attempted += 1
    if dry_run:
        stats.skipped += 1
        return None

    if not _models_ready(runtime, logger):
        source_lang = _detect_source_language(article)
        if source_lang == target_lang:
            translated = _build_original_translation(
                article,
                target_lang,
                compute_translation_source_hash(article),
                source_lang,
            )
        else:
            stats.missingModel += 1
            return None
    else:
        try:
            translated = translate_article_fields(article, target_lang, runtime=runtime, logger=logger)
        except Exception as exc:
            logger(f"Argos translation failed for news {article.get('_id') or article.get('sourceKey')} [{target_lang}]: {exc}")
            stats.failed += 1
            return None
        if not translated:
            stats.missingModel += 1
            return None

    if collection is not None and article.get("_id") is not None:
        collection.update_one({"_id": article["_id"]}, {"$set": {f"translations.{target_lang}": translated}})
    article.setdefault("translations", {})[target_lang] = translated
    stats.translated += 1
    return translated


def translate_article_all_targets(
    article: Dict[str, Any],
    force: bool = False,
    *,
    collection: Any = None,
    dry_run: bool = False,
    runtime: Optional[ArgosRuntime] = None,
    stats: Optional[TranslationStats] = None,
    logger: Callable[[str], None] = print,
) -> TranslationStats:
    stats = stats or TranslationStats()
    runtime = runtime or _load_argos_runtime()
    for target_lang in get_target_languages():
        translate_article_if_needed(
            article,
            target_lang,
            force=force,
            collection=collection,
            dry_run=dry_run,
            runtime=runtime,
            stats=stats,
            logger=logger,
        )
    return stats
