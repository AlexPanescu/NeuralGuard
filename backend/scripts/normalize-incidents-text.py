from __future__ import annotations

import os
import sys
from pathlib import Path

from pymongo import MongoClient

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from incident_ingestion.text_utils import sanitize_ascii


def load_env_file(env_file: str) -> None:
    path = Path(env_file)
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> int:
    env_file = os.getenv("ENV_FILE", ".env.incidents")
    load_env_file(env_file)

    mongo_uri = os.getenv("MONGO_URI", "").strip()
    mongo_db = os.getenv("MONGO_DB", "test").strip()
    collection_name = os.getenv("INCIDENTS_COLLECTION", "incidents").strip()

    if not mongo_uri:
        raise SystemExit("MONGO_URI is missing. Set ENV_FILE or export MONGO_URI.")

    client = MongoClient(mongo_uri)
    collection = client[mongo_db][collection_name]

    updated = 0
    scanned = 0
    for row in collection.find({}, {"title": 1, "summary": 1, "location.address": 1}):
        scanned += 1
        title_new = sanitize_ascii(row.get("title", ""))
        summary_new = sanitize_ascii(row.get("summary", ""))
        location = row.get("location") or {}
        address_new = sanitize_ascii(location.get("address", ""))

        patch = {}
        if title_new != row.get("title", ""):
            patch["title"] = title_new
        if summary_new != row.get("summary", ""):
            patch["summary"] = summary_new
        if address_new != location.get("address", ""):
            patch["location.address"] = address_new
        if patch:
            collection.update_one({"_id": row["_id"]}, {"$set": patch})
            updated += 1

    print(f"scanned={scanned} updated={updated} db={mongo_db} collection={collection_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
