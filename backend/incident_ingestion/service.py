from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from incident_ingestion.models import IncidentRecord
from incident_ingestion.processor import IncidentProcessingPipeline
from incident_ingestion.sources.base import IncidentSource
from incident_ingestion.storage.mongo_repository import MongoIncidentRepository


@dataclass
class SourceReport:
    name: str
    fetched: int = 0
    accepted: int = 0
    skipped: int = 0
    errors: int = 0
    status: str = "ok"
    last_error: str = ""


@dataclass
class SyncReport:
    gathered: int
    processed: int
    inserted: int
    updated: int
    skipped: int
    deduplicated: int
    auto_resolved: int
    deleted: int
    source_reports: List[SourceReport]
    skip_reasons: Dict[str, int]
    auto_resolve_reasons: Dict[str, int]
    delete_reasons: Dict[str, int]


class IncidentIngestionService:
    def __init__(
        self,
        sources: List[IncidentSource],
        repository: MongoIncidentRepository,
        resolve_ttl_minutes: int,
        auto_sources_regex: str,
        bucharest_keywords: List[str],
        max_item_age_hours: int,
    ) -> None:
        self.sources = sources
        self.repository = repository
        self.resolve_ttl_minutes = resolve_ttl_minutes
        self.auto_sources_regex = auto_sources_regex
        self.pipeline = IncidentProcessingPipeline(
            bucharest_keywords,
            max_item_age_hours=max_item_age_hours,
        )

    def run_once(self) -> SyncReport:
        records: List[IncidentRecord] = []
        processed_records = []
        source_reports: List[SourceReport] = []
        skip_reasons: Dict[str, int] = {}
        delete_reasons: Dict[str, int] = {}
        active_keys_by_source: Dict[str, set[str]] = {}
        for source in self.sources:
            source_report = SourceReport(name=source.name)
            try:
                fetched = list(source.fetch())
                source_report.fetched = len(fetched)
                records.extend(fetched)
                source_name = str(source.name or "").strip()
                if source_name.startswith("waze_live_map"):
                    active_keys_by_source.setdefault(source_name, set()).update(
                        str(item.sourceKey or "").strip()
                        for item in fetched
                        if str(item.sourceKey or "").strip()
                    )
                for item in fetched:
                    decision = self.pipeline.process(item)
                    if decision.accepted and decision.record is not None:
                        processed_records.append(decision.record)
                        source_report.accepted += 1
                    else:
                        source_report.skipped += 1
                        skip_reasons[decision.reason] = skip_reasons.get(decision.reason, 0) + 1
                source_report.status = "ok" if source_report.errors == 0 else "degraded"
                if source_report.skipped and source_report.status == "ok":
                    source_report.status = "partial"
            except Exception as exc:
                source_report.errors += 1
                source_report.status = "degraded"
                source_report.last_error = str(exc)
            source_reports.append(source_report)
        stats = self.repository.upsert_many(processed_records)
        auto_resolved, auto_resolve_reasons = self.repository.auto_resolve_stale(
            ttl_minutes=self.resolve_ttl_minutes,
            auto_sources_regex=self.auto_sources_regex,
        )
        deleted = 0
        for source_name, active_keys in active_keys_by_source.items():
            removed_for_source = self.repository.delete_missing_for_source(source_name, sorted(active_keys))
            if removed_for_source:
                delete_reasons[f"missing_from_{source_name}"] = removed_for_source
                deleted += removed_for_source
        return SyncReport(
            gathered=len(records),
            processed=len(processed_records),
            inserted=stats["inserted"],
            updated=stats["updated"],
            skipped=stats["skipped"],
            deduplicated=stats["deduplicated"],
            auto_resolved=auto_resolved,
            deleted=deleted,
            source_reports=source_reports,
            skip_reasons=skip_reasons,
            auto_resolve_reasons=auto_resolve_reasons,
            delete_reasons=delete_reasons,
        )

    def close(self) -> None:
        self.repository.close()
