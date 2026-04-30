from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

from news_ingestion.config import load_config
from news_ingestion.service import NewsIngestionService
from news_ingestion.sources.rss_feed import RssFeedSource
from news_ingestion.storage.mongo_repository import MongoNewsRepository
from news_ingestion.argos_translation import log_argos_setup_status


def _build_service(force_dry_run: bool = False, connect_when_dry_run: bool = False) -> NewsIngestionService:
    cfg = load_config()
    dry_run = force_dry_run or cfg.dry_run

    sources = [
        RssFeedSource(
            source_urls=cfg.source_urls,
            timeout_seconds=cfg.request_timeout_seconds,
            user_agent=cfg.user_agent,
            keywords=cfg.keywords,
            max_items_per_source=cfg.max_items_per_source,
        )
    ]

    repository = MongoNewsRepository(
        mongo_uri=cfg.mongo_uri,
        db_name=cfg.mongo_db,
        collection_name=cfg.mongo_collection,
        dry_run=dry_run,
        connect_when_dry_run=connect_when_dry_run,
    )
    return NewsIngestionService(sources=sources, repository=repository)


def _print_report(report) -> None:
    now = datetime.now(tz=timezone.utc).isoformat()
    print(
        f"[{now}] gathered={report.gathered} inserted={report.inserted} "
        f"updated={report.updated} skipped={report.skipped}"
    )
    values = report.translations.to_dict()
    print(
        f"[{now}] translations attempted={values['attempted']} translated={values['translated']} "
        f"cached={values['cached']} skipped={values['skipped']} failed={values['failed']} "
        f"missingModel={values['missingModel']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="News ingestion to MongoDB Atlas")
    parser.add_argument("--once", action="store_true", help="Run one sync cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to MongoDB")
    parser.add_argument("--backfill-translations", action="store_true", help="Translate existing news documents")
    parser.add_argument("--force-translation-refresh", action="store_true", help="Retranslate even when cache is valid")
    args = parser.parse_args()

    cfg = load_config()
    log_argos_setup_status(allow_auto_install=not (args.dry_run or cfg.dry_run))
    service = _build_service(force_dry_run=args.dry_run, connect_when_dry_run=args.backfill_translations)
    try:
        if args.backfill_translations:
            stats = service.repository.backfill_translations(
                limit=cfg.translation_backfill_limit,
                force=args.force_translation_refresh,
                dry_run=args.dry_run or cfg.dry_run,
            )
            now = datetime.now(tz=timezone.utc).isoformat()
            values = stats.to_dict()
            print(
                f"[{now}] translation_backfill attempted={values['attempted']} translated={values['translated']} "
                f"cached={values['cached']} skipped={values['skipped']} failed={values['failed']} "
                f"missingModel={values['missingModel']}"
            )
            return 0

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
