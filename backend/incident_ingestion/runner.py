from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

from incident_ingestion.config import load_config
from incident_ingestion.service import IncidentIngestionService
from incident_ingestion.sources.accidenteromania import AccidenteRomaniaSource
from incident_ingestion.sources.waze_live_map import WazeLiveMapSource
from incident_ingestion.storage.mongo_repository import MongoIncidentRepository


def _build_service(force_dry_run: bool = False) -> IncidentIngestionService:
    cfg = load_config()
    dry_run = force_dry_run or cfg.dry_run

    sources = [
        AccidenteRomaniaSource(
            timeout_seconds=cfg.request_timeout_seconds,
            user_agent=cfg.user_agent,
            bucharest_bbox=cfg.bucharest_bbox,
            include_waze_imports=False,
            source_name="accidenteromania",
        ),
        WazeLiveMapSource(
            timeout_seconds=cfg.request_timeout_seconds,
            user_agent=cfg.user_agent,
            bucharest_bbox=cfg.bucharest_bbox,
        ),
    ]
    if cfg.include_waze_imports:
        sources.append(
            AccidenteRomaniaSource(
                timeout_seconds=cfg.request_timeout_seconds,
                user_agent=cfg.user_agent,
                bucharest_bbox=cfg.bucharest_bbox,
                include_waze_imports=True,
                source_name="waze_live_map_import",
            )
        )

    repository = MongoIncidentRepository(
        mongo_uri=cfg.mongo_uri,
        db_name=cfg.mongo_db,
        collection_name=cfg.mongo_collection,
        dry_run=dry_run,
    )
    return IncidentIngestionService(
        sources=sources,
        repository=repository,
        resolve_ttl_minutes=cfg.resolve_ttl_minutes,
        auto_sources_regex=cfg.auto_sources_regex,
        bucharest_keywords=cfg.bucharest_keywords,
        max_item_age_hours=cfg.max_item_age_hours,
    )


def _print_report(report) -> None:
    now = datetime.now(tz=timezone.utc).isoformat()
    print(
        f"[{now}] gathered={report.gathered} processed={report.processed} inserted={report.inserted} "
        f"updated={report.updated} skipped={report.skipped} deduplicated={report.deduplicated} "
        f"auto_resolved={report.auto_resolved} deleted={report.deleted}"
    )
    if report.skip_reasons:
        print(f"  skip_reasons={report.skip_reasons}")
    if report.auto_resolve_reasons:
        print(f"  auto_resolve_reasons={report.auto_resolve_reasons}")
    if report.delete_reasons:
        print(f"  delete_reasons={report.delete_reasons}")
    for source_report in report.source_reports:
        print(
            "  source="
            f"{source_report.name} status={source_report.status} fetched={source_report.fetched} "
            f"accepted={source_report.accepted} skipped={source_report.skipped} errors={source_report.errors}"
            + (f" last_error={source_report.last_error}" if source_report.last_error else "")
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Bucharest incident ingestion to MongoDB Atlas")
    parser.add_argument("--once", action="store_true", help="Run one sync cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to MongoDB")
    args = parser.parse_args()

    cfg = load_config()
    service = _build_service(force_dry_run=args.dry_run)
    try:
        if args.once:
            report = service.run_once()
            _print_report(report)
            return 0

        while True:
            report = service.run_once()
            _print_report(report)
            time.sleep(cfg.poll_interval_seconds)
    except KeyboardInterrupt:
        print("Stopped by user.")
        return 0
    finally:
        service.close()


if __name__ == "__main__":
    raise SystemExit(main())
