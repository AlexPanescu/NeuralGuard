from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Dict, List


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


@dataclass
class NewsRecord:
    title: str
    summary: str
    content: str
    source: str
    articleUrl: str
    imageUrl: str
    tags: List[str]
    status: str
    severityScore: int
    publishedAt: datetime
    region: str
    sourceKey: str
    articleUrlKey: str

    def to_mongo_document(self) -> Dict[str, object]:
        payload = asdict(self)
        payload["publishedAt"] = self.publishedAt.astimezone(timezone.utc)
        payload["severityScore"] = int(clamp(self.severityScore, 0, 100))
        return payload
