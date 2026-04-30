from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional


CLASSIFICATION_VERSION = "2026.04.11"


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


@dataclass
class IncidentRecord:
    title: str
    summary: str
    source: str
    sourceKey: str
    sourceUrl: str
    publishedAt: datetime
    type: str = "general"
    rawLocation: Optional[Dict[str, object]] = None
    rawMeta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessedIncidentRecord:
    title: str
    type: str
    severity: str
    status: str
    summary: str
    dangerScore: int
    riskUpdatedAt: datetime
    location: Dict[str, object]
    source: str
    sourceKey: str
    sourceUrl: str
    rawTitle: str
    rawSummary: str
    normalizedText: str
    ingestionMeta: Dict[str, Any]
    sourceFingerprint: str
    duplicateOf: Optional[str]
    relevanceScore: int
    geoConfidence: int
    classificationVersion: str = CLASSIFICATION_VERSION
    sourceAliases: list[str] = field(default_factory=list)
    sourceUrls: list[str] = field(default_factory=list)

    def to_mongo_document(self) -> Dict[str, object]:
        payload = asdict(self)
        payload["riskUpdatedAt"] = self.riskUpdatedAt.astimezone(timezone.utc)
        payload.setdefault("location", {})
        payload["duplicateOf"] = self.duplicateOf
        payload["sourceAliases"] = self.sourceAliases or [self.source]
        payload["sourceUrls"] = self.sourceUrls or [self.sourceUrl]
        return payload


def default_bucharest_location(address: str = "Bucharest, Romania") -> Dict[str, object]:
    return {
        "lat": 44.4268,
        "lon": 26.1025,
        "address": address,
        "radiusKm": 3.0,
        "accuracy": 2200,
    }


def danger_to_severity(score: int) -> str:
    value = int(clamp(score, 0, 100))
    if value >= 85:
        return "critical"
    if value >= 65:
        return "high"
    if value >= 35:
        return "medium"
    return "low"
