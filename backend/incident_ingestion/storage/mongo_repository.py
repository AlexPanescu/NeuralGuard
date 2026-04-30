from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

from pymongo import ASCENDING, MongoClient

from incident_ingestion.models import ProcessedIncidentRecord


class MongoIncidentRepository:
    def __init__(self, mongo_uri: str, db_name: str, collection_name: str, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        if not self.dry_run and not (mongo_uri or "").strip():
            raise ValueError("MONGO_URI is required when INCIDENTS_DRY_RUN is false.")
        self.client = (
            MongoClient(mongo_uri, connect=False, serverSelectionTimeoutMS=2000)
            if mongo_uri and not dry_run
            else None
        )
        self.collection = None
        if self.client:
            self.collection = self.client[db_name][collection_name]
            self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        if self.collection is None:
            return
        self.collection.create_index(
            [("sourceKey", ASCENDING)],
            unique=True,
            name="sourceKey_unique",
            partialFilterExpression={"sourceKey": {"$exists": True, "$type": "string"}},
        )
        self.collection.create_index(
            [("sourceFingerprint", ASCENDING)],
            name="sourceFingerprint_idx",
            partialFilterExpression={"sourceFingerprint": {"$exists": True, "$type": "string"}},
        )
        self.collection.create_index([("riskUpdatedAt", ASCENDING)], name="riskUpdatedAt_idx")
        self.collection.create_index([("lastSeenAt", ASCENDING)], name="lastSeenAt_idx")

    def _find_duplicate_candidate(self, record: ProcessedIncidentRecord, now: datetime) -> dict | None:
        if self.collection is None or not record.sourceFingerprint:
            return None
        cutoff = now - timedelta(days=7)
        return self.collection.find_one(
            {
                "sourceFingerprint": record.sourceFingerprint,
                "lastSeenAt": {"$gte": cutoff},
                "sourceKey": {"$ne": record.sourceKey},
                "$or": [{"duplicateOf": None}, {"duplicateOf": {"$exists": False}}],
            },
            sort=[("lastSeenAt", -1)],
        )

    def upsert_many(self, records: Iterable[ProcessedIncidentRecord]) -> dict:
        inserted = 0
        updated = 0
        skipped = 0
        deduplicated = 0
        now = datetime.now(tz=timezone.utc)

        for record in records:
            if not record.title:
                skipped += 1
                continue

            document = record.to_mongo_document()
            document["updatedAt"] = now
            document["lastSeenAt"] = now
            if self.dry_run:
                inserted += 1
                continue
            if self.collection is None:
                raise RuntimeError("Mongo collection is not initialized. Check MONGO_URI and database settings.")

            existing = self.collection.find_one({"sourceKey": record.sourceKey})
            if existing:
                document["sourceAliases"] = sorted(set((existing.get("sourceAliases") or []) + [record.source]))
                document["sourceUrls"] = sorted(set((existing.get("sourceUrls") or []) + [record.sourceUrl]))
                result = self.collection.update_one(
                    {"_id": existing["_id"]},
                    {
                        "$set": document,
                        "$unset": {"resolutionReason": ""},
                    },
                    upsert=False,
                )
            else:
                duplicate = self._find_duplicate_candidate(record, now)
                if duplicate:
                    deduplicated += 1
                    document.setdefault("ingestionMeta", {})
                    document["ingestionMeta"]["dedup"] = {
                        "matchedPrimaryId": str(duplicate["_id"]),
                        "strategy": "sourceFingerprint",
                    }
                    document["sourceKey"] = duplicate.get("sourceKey", record.sourceKey)
                    document["source"] = duplicate.get("source", record.source)
                    document["sourceUrl"] = duplicate.get("sourceUrl", record.sourceUrl)
                    document["sourceAliases"] = sorted(set((duplicate.get("sourceAliases") or []) + [record.source]))
                    document["sourceUrls"] = sorted(set((duplicate.get("sourceUrls") or []) + [record.sourceUrl]))
                    result = self.collection.update_one(
                        {"_id": duplicate["_id"]},
                        {
                            "$set": document,
                            "$unset": {"resolutionReason": ""},
                        },
                        upsert=False,
                    )
                else:
                    result = self.collection.update_one(
                        {"sourceKey": record.sourceKey},
                        {
                            "$set": document,
                            "$setOnInsert": {"createdAt": now, "unreadCount": 0},
                            "$unset": {"resolutionReason": ""},
                        },
                        upsert=True,
                    )
            if result.upserted_id is not None:
                inserted += 1
            elif result.modified_count > 0:
                updated += 1
            else:
                skipped += 1

        return {"inserted": inserted, "updated": updated, "skipped": skipped, "deduplicated": deduplicated}

    def auto_resolve_stale(self, ttl_minutes: int, auto_sources_regex: str) -> tuple[int, dict]:
        if self.dry_run:
            return 0, {}
        if self.collection is None:
            raise RuntimeError("Mongo collection is not initialized. Check MONGO_URI and database settings.")
        now = datetime.now(tz=timezone.utc)
        cutoff = now - timedelta(minutes=max(1, int(ttl_minutes)))
        result = self.collection.update_many(
            {
                "source": {"$regex": auto_sources_regex},
                "status": {"$ne": "resolved"},
                "lastSeenAt": {"$lt": cutoff},
            },
            {
                "$set": {
                    "status": "resolved",
                    "riskUpdatedAt": now,
                    "updatedAt": now,
                    "resolutionReason": "auto_stale",
                }
            },
        )
        modified = int(result.modified_count)
        return modified, ({"auto_stale": modified} if modified else {})

    def delete_missing_for_source(self, source_name: str, active_source_keys: Iterable[str]) -> int:
        if self.dry_run:
            return 0
        if self.collection is None:
            raise RuntimeError("Mongo collection is not initialized. Check MONGO_URI and database settings.")

        source = (source_name or "").strip()
        if not source:
            return 0

        unique_keys = sorted({str(item).strip() for item in active_source_keys if str(item).strip()})
        query: dict = {
            "$or": [
                {"source": source},
                {"sourceAliases": source},
            ]
        }
        if unique_keys:
            query["sourceKey"] = {"$nin": unique_keys}
        result = self.collection.delete_many(query)
        return int(result.deleted_count or 0)

    def close(self) -> None:
        if self.client:
            self.client.close()
