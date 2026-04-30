from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import ConfigurationError, OperationFailure

from news_ingestion.argos_translation import TranslationStats, translate_article_all_targets
from news_ingestion.models import NewsRecord


class MongoNewsRepository:
    def __init__(
        self,
        mongo_uri: str,
        db_name: str,
        collection_name: str,
        dry_run: bool = False,
        translation_logger=print,
        connect_when_dry_run: bool = False,
    ) -> None:
        self.dry_run = dry_run
        self.translation_logger = translation_logger
        if not self.dry_run and not (mongo_uri or "").strip():
            raise ValueError("MONGO_URI is required when NEWS_DRY_RUN is false.")
        try:
            self.client = MongoClient(mongo_uri) if mongo_uri and (not dry_run or connect_when_dry_run) else None
        except ConfigurationError as exc:
            if not dry_run:
                raise
            print(f"MongoDB unavailable for dry-run news translation backfill: {exc}")
            self.client = None
        self.collection = None
        if self.client:
            self.collection = self.client[db_name][collection_name]
            self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        if self.collection is None:
            return
        self._create_index_safe(
            [("sourceKey", ASCENDING)],
            unique=True,
            partialFilterExpression={"sourceKey": {"$exists": True, "$type": "string"}},
        )
        self._create_index_safe(
            [("articleUrlKey", ASCENDING)],
            unique=True,
            partialFilterExpression={"articleUrlKey": {"$exists": True, "$type": "string"}},
        )
        self._create_index_safe([("status", ASCENDING), ("publishedAt", DESCENDING)])
        self._create_index_safe([("severityScore", DESCENDING), ("publishedAt", DESCENDING)])
        self._create_index_safe([("publishedAt", DESCENDING)])

    def _create_index_safe(self, keys, **kwargs) -> None:
        """
        Ignore duplicate-name conflicts when an equivalent index already exists
        under Mongo's auto-generated index name.
        """
        if self.collection is None:
            return
        try:
            self.collection.create_index(keys, **kwargs)
        except OperationFailure as exc:
            message = str(exc)
            if "Index already exists with a different name" in message or "IndexOptionsConflict" in message:
                return
            raise

    def upsert_many(self, records: Iterable[NewsRecord]) -> dict:
        inserted = 0
        updated = 0
        skipped = 0
        translation_stats = TranslationStats()
        now = datetime.now(tz=timezone.utc)

        for record in records:
            if not record.title:
                skipped += 1
                continue

            document = record.to_mongo_document()
            document["updatedAt"] = now

            if self.dry_run:
                inserted += 1
                translation_stats.add(translate_article_all_targets(document, dry_run=True, logger=self.translation_logger))
                continue

            if self.collection is None:
                raise RuntimeError("Mongo collection is not initialized. Check MONGO_URI and database settings.")

            result = self.collection.update_one(
                {
                    "$or": [
                        {"sourceKey": record.sourceKey},
                        {"articleUrlKey": record.articleUrlKey},
                    ]
                },
                {
                    "$set": document,
                    "$setOnInsert": {"createdAt": now},
                },
                upsert=True,
            )

            if result.upserted_id is not None:
                inserted += 1
            elif result.modified_count > 0:
                updated += 1
            else:
                skipped += 1

            persisted = self.collection.find_one(
                {
                    "$or": [
                        {"sourceKey": record.sourceKey},
                        {"articleUrlKey": record.articleUrlKey},
                    ]
                }
            )
            if persisted:
                translation_stats.add(
                    translate_article_all_targets(
                        persisted,
                        collection=self.collection,
                        dry_run=False,
                        logger=self.translation_logger,
                    )
                )

        return {"inserted": inserted, "updated": updated, "skipped": skipped, "translations": translation_stats}

    def backfill_translations(self, limit: int, force: bool = False, dry_run: bool = False) -> TranslationStats:
        stats = TranslationStats()
        if self.collection is None:
            return stats
        cursor = self.collection.find({"status": "active"}).sort("publishedAt", DESCENDING).limit(limit)
        for document in cursor:
            stats.add(
                translate_article_all_targets(
                    document,
                    force=force,
                    collection=None if dry_run else self.collection,
                    dry_run=dry_run,
                    logger=self.translation_logger,
                )
            )
        return stats

    def close(self) -> None:
        if self.client:
            self.client.close()
