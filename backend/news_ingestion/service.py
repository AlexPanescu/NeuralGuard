from __future__ import annotations

from dataclasses import dataclass
from typing import List

from news_ingestion.argos_translation import TranslationStats
from news_ingestion.models import NewsRecord
from news_ingestion.sources.base import NewsSource
from news_ingestion.storage.mongo_repository import MongoNewsRepository


@dataclass
class SyncReport:
    gathered: int
    inserted: int
    updated: int
    skipped: int
    translations: TranslationStats


class NewsIngestionService:
    def __init__(self, sources: List[NewsSource], repository: MongoNewsRepository) -> None:
        self.sources = sources
        self.repository = repository

    def run_once(self) -> SyncReport:
        records: List[NewsRecord] = []
        for source in self.sources:
            try:
                records.extend(list(source.fetch()))
            except Exception:
                continue
        stats = self.repository.upsert_many(records)
        return SyncReport(
            gathered=len(records),
            inserted=stats["inserted"],
            updated=stats["updated"],
            skipped=stats["skipped"],
            translations=stats.get("translations", TranslationStats()),
        )

    def close(self) -> None:
        self.repository.close()
