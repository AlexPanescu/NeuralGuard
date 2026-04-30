from __future__ import annotations

import sys
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace


ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from incident_ingestion.models import IncidentRecord, ProcessedIncidentRecord  # noqa: E402
from incident_ingestion.processor import (  # noqa: E402
    IncidentProcessingPipeline,
    classify_incident,
    infer_location,
    score_bucharest_relevance,
)
from incident_ingestion.service import IncidentIngestionService  # noqa: E402
from incident_ingestion.sources.waze_live_map import WazeLiveMapSource  # noqa: E402
from incident_ingestion.storage.mongo_repository import MongoIncidentRepository  # noqa: E402
from incident_ingestion.text_utils import sanitize_ascii  # noqa: E402


class FakeSource:
    def __init__(self, name, items=None, error=None):
        self.name = name
        self._items = items or []
        self._error = error

    def fetch(self):
        if self._error:
            raise self._error
        return list(self._items)


class FakeRepository:
    def __init__(self):
        self.records = []

    def upsert_many(self, records):
        self.records = list(records)
        return {"inserted": len(self.records), "updated": 0, "skipped": 0, "deduplicated": 0}

    def auto_resolve_stale(self, ttl_minutes, auto_sources_regex):
        return 0, {}

    def close(self):
        return None


class UpdateResult:
    def __init__(self, upserted_id=None, modified_count=0):
        self.upserted_id = upserted_id
        self.modified_count = modified_count


class FakeCollection:
    def __init__(self):
        self.docs = []

    def create_index(self, *args, **kwargs):
        return None

    def find_one(self, query, projection=None, sort=None):
        docs = list(self.docs)
        if sort:
            key, direction = sort[0]
            docs.sort(key=lambda item: item.get(key), reverse=direction < 0)
        for doc in docs:
            if self._matches(doc, query):
                if projection:
                    return {key: doc[key] for key in projection if key in doc}
                return dict(doc)
        return None

    def update_one(self, query, update, upsert=False):
        for idx, doc in enumerate(self.docs):
            if self._matches(doc, query):
                self.docs[idx] = self._apply_update(dict(doc), update)
                return UpdateResult(modified_count=1)
        if not upsert:
            return UpdateResult(modified_count=0)
        new_doc = self._apply_update({}, update)
        new_doc.update(query)
        new_doc["_id"] = new_doc.get("_id", f"id-{len(self.docs) + 1}")
        self.docs.append(new_doc)
        return UpdateResult(upserted_id=new_doc["_id"], modified_count=0)

    def update_many(self, query, update):
        modified = 0
        for idx, doc in enumerate(list(self.docs)):
            if self._matches(doc, query):
                self.docs[idx] = self._apply_update(dict(doc), update)
                modified += 1
        return SimpleNamespace(modified_count=modified)

    def delete_many(self, query):
        kept = []
        deleted = 0
        for doc in self.docs:
            if self._matches(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs = kept
        return SimpleNamespace(deleted_count=deleted)

    def _apply_update(self, doc, update):
        for key, value in update.get("$set", {}).items():
            self._set_nested(doc, key, value)
        for key in update.get("$unset", {}):
            self._unset_nested(doc, key)
        for key, value in update.get("$setOnInsert", {}).items():
            if key not in doc:
                self._set_nested(doc, key, value)
        for key, spec in update.get("$addToSet", {}).items():
            current = doc.get(key, [])
            if not isinstance(current, list):
                current = []
            for item in spec.get("$each", []):
                if item not in current:
                    current.append(item)
            doc[key] = current
        return doc

    def _matches(self, doc, query):
        for key, value in query.items():
            if key == "$or":
                if not any(self._matches(doc, subquery) for subquery in value):
                    return False
                continue
            doc_value = self._get_nested(doc, key)
            if isinstance(value, dict):
                if "$gte" in value and not (doc_value is not None and doc_value >= value["$gte"]):
                    return False
                if "$lt" in value and not (doc_value is not None and doc_value < value["$lt"]):
                    return False
                if "$ne" in value and doc_value == value["$ne"]:
                    return False
                if "$exists" in value:
                    exists = self._get_nested(doc, key, missing=None) is not None
                    if exists != value["$exists"]:
                        return False
                if "$regex" in value:
                    import re

                    if not re.search(value["$regex"], str(doc_value or "")):
                        return False
                if "$nin" in value and doc_value in value["$nin"]:
                    return False
            elif doc_value != value:
                return False
        return True

    def _get_nested(self, doc, path, missing=object()):
        current = doc
        for part in path.split("."):
            if not isinstance(current, dict) or part not in current:
                return None if missing is None else missing
            current = current[part]
        return current

    def _set_nested(self, doc, path, value):
        parts = path.split(".")
        current = doc
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = value

    def _unset_nested(self, doc, path):
        parts = path.split(".")
        current = doc
        for part in parts[:-1]:
            current = current.get(part, {})
        current.pop(parts[-1], None)


def sample_processed(source_key="key-1", fingerprint="finger-1", source="accidenteromania", minutes_old=0):
    now = datetime.now(tz=timezone.utc) - timedelta(minutes=minutes_old)
    return ProcessedIncidentRecord(
        title="Accident pe A0 Bucuresti",
        type="traffic",
        severity="high",
        status="active",
        summary="Accident pe A0 cu trafic restrictionat.",
        dangerScore=74,
        riskUpdatedAt=now,
        location={"lat": 44.49, "lon": 26.15, "address": "Autostrada A0 - Centura Bucuresti", "radiusKm": 6, "accuracy": 2000},
        source=source,
        sourceKey=source_key,
        sourceUrl=f"https://example.com/{source_key}",
        rawTitle="Accident pe A0 Bucuresti",
        rawSummary="Accident pe A0 cu trafic restrictionat.",
        normalizedText="accident pe a0 bucuresti trafic restrictionat",
        ingestionMeta={"pipeline": ["fetch", "normalize"]},
        sourceFingerprint=fingerprint,
        duplicateOf=None,
        relevanceScore=88,
        geoConfidence=84,
        sourceAliases=[source],
        sourceUrls=[f"https://example.com/{source_key}"],
    )


def make_repository():
    repository = MongoIncidentRepository.__new__(MongoIncidentRepository)
    repository.dry_run = False
    repository.client = None
    repository.collection = FakeCollection()
    return repository


class IncidentIngestionTests(unittest.TestCase):
    def test_sanitize_ascii_repairs_mojibake(self):
        self.assertIn("Bucuresti", sanitize_ascii("BucureÈ™ti"))

    def test_relevance_scoring_rewards_bucharest_and_penalizes_other_cities(self):
        score, reasons = score_bucharest_relevance("accident pe a0 bucuresti", ["bucuresti", "a0"])
        self.assertGreaterEqual(score, 35)
        self.assertTrue(any("location_tokens" in item for item in reasons))

        negative_score, _ = score_bucharest_relevance("incendiu in cluj", ["bucuresti"])
        self.assertLess(negative_score, 35)

    def test_classification_deescalates_to_resolved(self):
        danger_score, severity, status, reasons = classify_incident("traficul a fost reluat dupa accident pe a1 bucuresti")
        self.assertEqual(status, "resolved")
        self.assertEqual(severity, "low")
        self.assertIn("resolved_signal", reasons)
        self.assertLessEqual(danger_score, 34)

    def test_location_inference_uses_catalog_then_estimated_sector(self):
        location, confidence, reasons = infer_location("accident pe a0 bucuresti", None)
        self.assertEqual(location["address"], "Autostrada A0 - Centura Bucuresti")
        self.assertGreaterEqual(confidence, 80)
        self.assertIn("catalog:a0", reasons)

        estimated_location, estimated_confidence, estimated_reasons = infer_location(
            "alerta fara locatie clara",
            None,
            "seed-key-123",
        )
        self.assertIn("estimated sector", estimated_location["address"].lower())
        self.assertEqual(estimated_confidence, 52)
        self.assertIn("estimated_sector_from_source", estimated_reasons)

    def test_pipeline_filters_out_of_scope_items(self):
        pipeline = IncidentProcessingPipeline(["bucuresti", "a0"])
        record = IncidentRecord(
            title="Incendiu in Cluj",
            summary="Interventie in Cluj-Napoca",
            source="accidenteromania",
            sourceKey="key",
            sourceUrl="https://example.com/item",
            publishedAt=datetime.now(tz=timezone.utc),
            type="news",
        )
        decision = pipeline.process(record)
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.reason, "outside_bucharest_scope")

    def test_pipeline_uses_raw_meta_for_bucharest_relevance(self):
        pipeline = IncidentProcessingPipeline(["bucuresti", "a0", "ilfov"])
        record = IncidentRecord(
            title="Trafic restrictionat",
            summary="Circulatie ingreunata.",
            source="accidenteromania",
            sourceKey="key-meta",
            sourceUrl="https://example.com/meta",
            publishedAt=datetime.now(tz=timezone.utc),
            type="traffic",
            rawMeta={"search_blob": "accident pe A0 Bucuresti, in judetul Ilfov"},
        )
        decision = pipeline.process(record)
        self.assertTrue(decision.accepted)
        self.assertGreaterEqual(decision.record.relevanceScore, 24)

    def test_service_reports_partial_and_degraded_sources(self):
        valid_record = IncidentRecord(
            title="Accident pe A0 Bucuresti",
            summary="Trafic restrictionat pe A0 Bucuresti",
            source="accidenteromania",
            sourceKey="key-1",
            sourceUrl="https://example.com/1",
            publishedAt=datetime.now(tz=timezone.utc),
            type="traffic",
        )
        skipped_record = IncidentRecord(
            title="Stire despre Cluj",
            summary="Eveniment in Cluj",
            source="accidenteromania",
            sourceKey="key-2",
            sourceUrl="https://example.com/2",
            publishedAt=datetime.now(tz=timezone.utc),
            type="news",
        )
        service = IncidentIngestionService(
            sources=[
                FakeSource("source-ok", [valid_record, skipped_record]),
                FakeSource("source-bad", error=RuntimeError("boom")),
            ],
            repository=FakeRepository(),
            resolve_ttl_minutes=60,
            auto_sources_regex=r"^(accidenteromania|waze_live_map)",
            bucharest_keywords=["bucuresti", "a0"],
            max_item_age_hours=72,
        )

        report = service.run_once()
        self.assertEqual(report.gathered, 2)
        self.assertEqual(report.processed, 1)
        self.assertEqual(report.source_reports[0].status, "partial")
        self.assertEqual(report.source_reports[1].status, "degraded")
        self.assertEqual(report.skip_reasons["outside_bucharest_scope"], 1)

    def test_pipeline_rejects_stale_publication_date(self):
        pipeline = IncidentProcessingPipeline(["bucuresti"], max_item_age_hours=48)
        old_record = IncidentRecord(
            title="Accident in Bucuresti",
            summary="Eveniment vechi",
            source="accidenteromania",
            sourceKey="old-key",
            sourceUrl="https://example.com/old",
            publishedAt=datetime.now(tz=timezone.utc) - timedelta(days=400),
            type="traffic",
        )
        decision = pipeline.process(old_record)
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.reason, "stale_publication_date")

    def test_repository_deduplicates_by_fingerprint(self):
        repository = make_repository()
        first = sample_processed(source_key="key-1", fingerprint="same-fingerprint", source="source-a")
        second = sample_processed(source_key="key-2", fingerprint="same-fingerprint", source="source-b")

        stats_first = repository.upsert_many([first])
        stats_second = repository.upsert_many([second])

        self.assertEqual(stats_first["inserted"], 1)
        self.assertEqual(stats_second["deduplicated"], 1)
        self.assertEqual(len(repository.collection.docs), 1)
        self.assertEqual(repository.collection.docs[0]["sourceKey"], "key-1")
        self.assertIn("source-b", repository.collection.docs[0]["sourceAliases"])

    def test_auto_resolve_marks_stale_items(self):
        repository = make_repository()
        stale = sample_processed(source_key="old", fingerprint="finger-old", minutes_old=180).to_mongo_document()
        stale["_id"] = "stale-1"
        stale["lastSeenAt"] = datetime.now(tz=timezone.utc) - timedelta(minutes=180)
        stale["status"] = "active"
        stale["source"] = "waze_live_map"
        repository.collection.docs.append(stale)

        count, reasons = repository.auto_resolve_stale(60, r"^waze_live_map")
        self.assertEqual(count, 1)
        self.assertEqual(reasons["auto_stale"], 1)
        self.assertEqual(repository.collection.docs[0]["status"], "resolved")

    def test_repository_deletes_missing_for_source(self):
        repository = make_repository()
        keep = sample_processed(source_key="keep", fingerprint="f-1", source="waze_live_map").to_mongo_document()
        keep["_id"] = "keep"
        old = sample_processed(source_key="old", fingerprint="f-2", source="waze_live_map").to_mongo_document()
        old["_id"] = "old"
        manual = sample_processed(source_key="manual", fingerprint="f-3", source="manual").to_mongo_document()
        manual["_id"] = "manual"
        repository.collection.docs.extend([keep, old, manual])

        deleted = repository.delete_missing_for_source("waze_live_map", ["keep"])
        self.assertEqual(deleted, 1)
        keys = sorted(doc["sourceKey"] for doc in repository.collection.docs)
        self.assertEqual(keys, ["keep", "manual"])

    def test_waze_snapshot_source_key_stays_stable_without_timestamp(self):
        source = WazeLiveMapSource(
            timeout_seconds=5,
            user_agent="test-agent",
            bucharest_bbox=(44.25, 25.80, 44.62, 26.35),
        )
        payload = {
            "payload": {
                "alerts": [
                    {
                        "id": "alert-123",
                        "uuid": "uuid-123",
                        "street": "Bd. Ghencea",
                        "type": "HAZARD",
                        "subtype": "HAZARD_ON_ROAD",
                        "location": {"x": 26.05, "y": 44.41},
                        "pubMillis": 1713000000000,
                    },
                    {
                        "id": "alert-123",
                        "uuid": "uuid-123",
                        "street": "Bd. Ghencea",
                        "type": "HAZARD",
                        "subtype": "HAZARD_ON_ROAD",
                        "location": {"x": 26.05, "y": 44.41},
                        "pubMillis": 1713000009000,
                    },
                ],
                "jams": [],
            }
        }
        with tempfile.NamedTemporaryFile("w+", suffix=".json", encoding="utf-8", delete=False) as handle:
            json.dump(payload, handle)
            snapshot_path = handle.name
        try:
            records = list(source._fetch_from_snapshot(snapshot_path))
        finally:
            Path(snapshot_path).unlink(missing_ok=True)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0].sourceKey, records[1].sourceKey)


if __name__ == "__main__":
    unittest.main()
