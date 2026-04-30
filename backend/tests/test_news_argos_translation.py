from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from news_ingestion.argos_translation import (  # noqa: E402
    ArgosRuntime,
    compute_translation_source_hash,
    has_valid_cached_translation,
    translate_article_all_targets,
    translate_article_if_needed,
)


class FakeTranslation:
    def __init__(self, source, target):
        self.source = source
        self.target = target
        self.calls = []

    def translate(self, value):
        self.calls.append(value)
        return f"{self.target}:{value}"


class FakeLanguage:
    def __init__(self, code, routes):
        self.code = code
        self._routes = routes

    def get_translation(self, target):
        return self._routes.get((self.code, target.code))


class FakeTranslateModule:
    def __init__(self, pairs):
        self.translations = {pair: FakeTranslation(*pair) for pair in pairs}
        self.languages = [
            FakeLanguage("en", self.translations),
            FakeLanguage("ro", self.translations),
        ]

    def get_installed_languages(self):
        return self.languages


class FakeCollection:
    def __init__(self):
        self.updates = []

    def update_one(self, query, update):
        self.updates.append((query, update))


def runtime_with_pairs(*pairs):
    return ArgosRuntime(translate_module=FakeTranslateModule(pairs))


class NewsArgosTranslationTests(unittest.TestCase):
    def test_source_hash_is_stable_and_detects_empty_null_changes(self):
        first = {"title": " Alert ", "summary": "", "content": None}
        second = {"title": "Alert", "summary": "", "content": None}
        changed = {"title": "Alert", "summary": None, "content": ""}

        self.assertEqual(compute_translation_source_hash(first), compute_translation_source_hash(second))
        self.assertNotEqual(compute_translation_source_hash(first), compute_translation_source_hash(changed))

    def test_cached_translation_reuse_requires_hash_provider_and_fields(self):
        article = {"title": "Storm", "summary": "Rain", "content": "", "translations": {}}
        article["translations"]["ro"] = {
            "title": "Furtuna",
            "summary": "Ploaie",
            "content": "",
            "provider": "argos-translate",
            "providerVersion": "local-v1",
            "translationSourceHash": compute_translation_source_hash(article),
        }

        self.assertTrue(has_valid_cached_translation(article, "ro"))
        article["translations"]["ro"]["providerVersion"] = "other"
        self.assertFalse(has_valid_cached_translation(article, "ro"))

    def test_empty_null_fields_are_preserved_and_not_translated(self):
        article = {
            "_id": "news-1",
            "title": "Storm",
            "summary": "",
            "content": None,
            "source": "BBC",
            "translations": {},
        }
        runtime = runtime_with_pairs(("en", "ro"), ("ro", "en"))
        collection = FakeCollection()

        stats = translate_article_all_targets(article, collection=collection, runtime=runtime)

        self.assertEqual(stats.translated, 2)
        ro_payload = collection.updates[0][1]["$set"]["translations.ro"]
        self.assertEqual(ro_payload["title"], "ro:Storm")
        self.assertEqual(ro_payload["summary"], "")
        self.assertIsNone(ro_payload["content"])
        self.assertEqual(runtime.translate_module.translations[("en", "ro")].calls, ["Storm"])

    def test_missing_argos_model_does_not_crash_ingestion(self):
        logs = []
        article = {"_id": "news-1", "title": "Storm", "summary": "Rain", "content": "", "source": "BBC"}
        runtime = runtime_with_pairs()

        stats = translate_article_if_needed(article, "ro", runtime=runtime, logger=logs.append)

        self.assertIsNone(stats)
        self.assertTrue(any("models are missing" in line for line in logs))

    def test_same_language_article_stores_original_fields_without_model(self):
        article = {
            "_id": "news-1",
            "title": "Stire",
            "summary": "Este importanta",
            "content": "",
            "source": "Digi24",
            "translations": {},
        }
        collection = FakeCollection()
        stats = translate_article_all_targets(article, collection=collection, runtime=runtime_with_pairs())

        self.assertEqual(stats.translated, 1)
        ro_payload = collection.updates[0][1]["$set"]["translations.ro"]
        self.assertEqual(ro_payload["title"], "Stire")
        self.assertEqual(ro_payload["sourceLanguage"], "ro")

    def test_mongo_update_shape_for_ro_and_en(self):
        article = {
            "_id": "news-1",
            "title": "Storm",
            "summary": "Heavy rain",
            "content": "Stay inside",
            "source": "BBC",
            "translations": {},
        }
        collection = FakeCollection()
        stats = translate_article_all_targets(
            article,
            collection=collection,
            runtime=runtime_with_pairs(("en", "ro"), ("ro", "en")),
        )

        self.assertEqual(stats.translated, 2)
        update_keys = [list(update["$set"].keys())[0] for _, update in collection.updates]
        self.assertEqual(update_keys, ["translations.ro", "translations.en"])
        for _, update in collection.updates:
            payload = next(iter(update["$set"].values()))
            self.assertIn("translatedAt", payload)
            self.assertEqual(payload["provider"], "argos-translate")
            self.assertEqual(payload["providerVersion"], "local-v1")
            self.assertEqual(payload["translationSourceHash"], compute_translation_source_hash(article))

    def test_dry_run_never_translates(self):
        article = {"_id": "news-1", "title": "Storm", "summary": "Rain", "content": "", "source": "BBC"}
        runtime = runtime_with_pairs(("en", "ro"), ("ro", "en"))

        stats = translate_article_all_targets(article, dry_run=True, runtime=runtime)

        self.assertEqual(stats.attempted, 2)
        self.assertEqual(stats.skipped, 2)
        self.assertEqual(runtime.translate_module.translations[("en", "ro")].calls, [])


if __name__ == "__main__":
    unittest.main()
