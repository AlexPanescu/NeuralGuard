from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from incident_ingestion.models import (
    CLASSIFICATION_VERSION,
    IncidentRecord,
    ProcessedIncidentRecord,
    clamp,
    danger_to_severity,
)
from incident_ingestion.text_utils import clean_spaces, normalize_text, sanitize_ascii, stable_key


BUCHAREST_RELEVANCE_THRESHOLD = 24
STOPWORDS = {
    "pe",
    "la",
    "in",
    "din",
    "si",
    "sau",
    "spre",
    "pentru",
    "cu",
    "un",
    "o",
    "de",
    "ale",
    "zona",
    "trafic",
    "circulatia",
    "circulatie",
    "info",
    "stire",
    "incident",
    "bucuresti",
    "romania",
    "update",
}
NEGATIVE_LOCATION_HINTS = {
    "cluj",
    "iasi",
    "timisoara",
    "constanta",
    "sibiu",
    "brasov",
    "arad",
    "oradea",
    "craiova",
    "galati",
}
POSITIVE_LOCATION_HINTS = {
    "ilfov": 16,
    "mogosoaia": 14,
    "pantelimon": 14,
    "voluntari": 14,
    "popesti leordeni": 14,
    "popesti-leordeni": 14,
    "bragadiru": 14,
    "chitila": 14,
    "buftea": 14,
    "berceni": 14,
    "ciorogarla": 14,
}
TYPE_RULES = [
    ("fire", ("incendiu", "fum", "explozie")),
    ("medical", ("ambulanta", "smurd", "medical", "ranit", "victima")),
    ("security", ("agresiune", "jaf", "violenta", "amenintare")),
    ("weather", ("furtuna", "viscol", "ploi", "cod galben", "cod rosu")),
    ("traffic", ("accident", "trafic", "centura", "autostrada", "dn1", "a0", "a1", "a2")),
]
SEVERITY_SIGNAL_RULES = [
    (92, ("decedat", "decedati", "morti", "explozie", "incendiu major")),
    (82, ("accident grav", "victime", "raniti", "blocat complet", "blocata complet")),
    (72, ("trafic blocat", "restrictii", "restrictionat", "interventie", "carambol")),
    (60, ("ingreunat", "deviat", "alternativ", "aglomerat")),
    (25, ("preventiv", "monitorizare", "verificari")),
]
DE_ESCALATION_SIGNALS = {
    "resolved": ("reluat", "deblocat", "normalizat", "ridicate restrictiile", "s-a reluat"),
    "monitoring": ("intermitent", "se circula dirijat", "ramane in monitorizare", "partial"),
}
LOCATION_CATALOG = [
    ("piata victoriei", 35, "Piata Victoriei, Bucharest", 44.4523, 26.0864, 1.4, 35, 95),
    ("otopeni", 30, "Otopeni, Ilfov", 44.5486, 26.0741, 3.5, 800, 92),
    ("centura bucuresti", 28, "Centura Bucuresti", 44.4670, 26.1500, 6.0, 2000, 88),
    ("centura capitalei", 28, "Centura Bucuresti", 44.4670, 26.1500, 6.0, 2000, 88),
    ("a0", 26, "Autostrada A0 - Centura Bucuresti", 44.4900, 26.1500, 6.0, 2000, 84),
    ("a1 bucuresti", 24, "A1 Bucuresti, zona Chiajna", 44.4360, 25.9900, 5.0, 1500, 82),
    ("a2 bucuresti", 24, "A2 Bucuresti, zona Cernica", 44.4060, 26.3000, 5.0, 1500, 82),
    ("sector 1", 18, "Sector 1, Bucharest", 44.4761, 26.0472, 3.5, 1800, 74),
    ("sector 2", 18, "Sector 2, Bucharest", 44.4485, 26.1446, 3.5, 1800, 74),
    ("sector 3", 18, "Sector 3, Bucharest", 44.4175, 26.1687, 3.5, 1800, 74),
    ("sector 4", 18, "Sector 4, Bucharest", 44.3992, 26.1173, 3.5, 1800, 74),
    ("sector 5", 18, "Sector 5, Bucharest", 44.4097, 26.0730, 3.5, 1800, 74),
    ("sector 6", 18, "Sector 6, Bucharest", 44.4348, 26.0197, 3.5, 1800, 74),
    ("bucuresti", 16, "Bucharest, Romania", 44.4268, 26.1025, 3.0, 2200, 68),
]
SECTOR_COORDS = {
    "1": (44.4761, 26.0472),
    "2": (44.4485, 26.1446),
    "3": (44.4175, 26.1687),
    "4": (44.3992, 26.1173),
    "5": (44.4097, 26.0730),
    "6": (44.4348, 26.0197),
}
ILFOV_HINT_LOCATIONS = {
    "voluntari": (44.4955, 26.1814, "Voluntari, Ilfov"),
    "otopeni": (44.5486, 26.0741, "Otopeni, Ilfov"),
    "pantelimon": (44.4595, 26.2058, "Pantelimon, Ilfov"),
    "mogosoaia": (44.5298, 26.0029, "Mogosoaia, Ilfov"),
    "chitila": (44.5080, 25.9820, "Chitila, Ilfov"),
    "buftea": (44.5661, 25.9488, "Buftea, Ilfov"),
    "bragadiru": (44.3704, 25.9773, "Bragadiru, Ilfov"),
    "popesti leordeni": (44.3777, 26.1711, "Popesti-Leordeni, Ilfov"),
    "popesti-leordeni": (44.3777, 26.1711, "Popesti-Leordeni, Ilfov"),
    "ciorogarla": (44.4396, 25.8839, "Ciorogarla, Ilfov"),
}


@dataclass
class ProcessingDecision:
    stage: str
    accepted: bool
    reason: str
    record: Optional[ProcessedIncidentRecord] = None
    metrics: Optional[Dict[str, object]] = None


class IncidentProcessingPipeline:
    def __init__(
        self,
        bucharest_keywords: Iterable[str],
        max_item_age_hours: int = 72,
    ) -> None:
        self.bucharest_keywords = [normalize_text(item) for item in bucharest_keywords if item]
        self.max_item_age_hours = max(6, int(max_item_age_hours))

    def process(self, record: IncidentRecord) -> ProcessingDecision:
        source_name = clean_spaces(record.source or "").lower()
        is_waze_source = source_name.startswith("waze_live_map")
        raw_title = sanitize_ascii(record.title)
        raw_summary = sanitize_ascii(record.summary or record.title)
        raw_meta_text = extract_raw_meta_text(record.rawMeta)
        normalized_text = normalize_text(" ".join([raw_title, raw_summary, raw_meta_text, record.sourceUrl]))
        if not raw_title:
            return ProcessingDecision("normalize", False, "missing_title", metrics={"normalizedText": normalized_text})

        if (not is_waze_source) and (not is_recent_enough(record.publishedAt, self.max_item_age_hours)):
            return ProcessingDecision(
                "freshness",
                False,
                "stale_publication_date",
                metrics={"publishedAt": record.publishedAt.isoformat(), "maxAgeHours": self.max_item_age_hours},
            )

        relevance_score, relevance_reasons = score_bucharest_relevance(normalized_text, self.bucharest_keywords)
        if (not is_waze_source) and relevance_score < BUCHAREST_RELEVANCE_THRESHOLD:
            return ProcessingDecision(
                "relevance",
                False,
                "outside_bucharest_scope",
                metrics={"relevanceScore": relevance_score, "relevanceReasons": relevance_reasons},
            )

        incident_type = infer_incident_type(normalized_text, record.type)
        danger_score, severity, status, classification_reasons = classify_incident(normalized_text)
        location, geo_confidence, geo_reasons = infer_location(
            normalized_text,
            record.rawLocation,
            record.sourceKey,
        )
        fingerprint = build_source_fingerprint(incident_type, normalized_text, location.get("address", ""))
        processed = ProcessedIncidentRecord(
            title=raw_title[:140],
            type=incident_type,
            severity=severity,
            status=status,
            summary=raw_summary[:500],
            dangerScore=danger_score,
            riskUpdatedAt=record.publishedAt,
            location=location,
            source=record.source,
            sourceKey=record.sourceKey,
            sourceUrl=record.sourceUrl,
            rawTitle=record.title,
            rawSummary=record.summary or record.title,
            normalizedText=normalized_text[:4000],
            ingestionMeta={
                "pipeline": ["fetch", "normalize", "relevance", "classify", "deduplicate", "persist"],
                "relevanceReasons": relevance_reasons,
                "classificationReasons": classification_reasons,
                "geoReasons": geo_reasons,
                "rawMeta": record.rawMeta,
                "classificationVersion": CLASSIFICATION_VERSION,
            },
            sourceFingerprint=fingerprint,
            duplicateOf=None,
            relevanceScore=relevance_score,
            geoConfidence=geo_confidence,
            sourceAliases=[record.source],
            sourceUrls=[record.sourceUrl],
        )
        return ProcessingDecision(
            "persist",
            True,
            "accepted",
            record=processed,
            metrics={
                "relevanceScore": relevance_score,
                "geoConfidence": geo_confidence,
                "severity": severity,
                "status": status,
            },
        )


def score_bucharest_relevance(text: str, configured_keywords: Iterable[str]) -> Tuple[int, List[str]]:
    normalized = normalize_text(text)
    reasons: List[str] = []
    score = 0
    matched_tokens = []
    for token, token_score, *_rest in LOCATION_CATALOG:
        if token in normalized:
            score += int(token_score)
            matched_tokens.append(token)
    if matched_tokens:
        reasons.append(f"location_tokens={','.join(sorted(set(matched_tokens))[:4])}")

    positive_hits = [token for token in POSITIVE_LOCATION_HINTS if token in normalized]
    if positive_hits:
        score += sum(POSITIVE_LOCATION_HINTS[token] for token in set(positive_hits))
        reasons.append(f"ilfov_hints={','.join(sorted(set(positive_hits))[:4])}")

    keyword_hits = [token for token in configured_keywords if token and token in normalized]
    if keyword_hits:
        score += min(36, 10 * len(set(keyword_hits)))
        reasons.append(f"configured_keywords={len(set(keyword_hits))}")

    if re.search(r"\b(dn1|a0|a1|a2)\b", normalized):
        score += 14
        reasons.append("major_road_match")

    if "bucuresti" in normalized:
        score += 10
        reasons.append("explicit_bucharest")

    if "sector" in normalized:
        score += 8
        reasons.append("sector_signal")

    negative_hits = [token for token in NEGATIVE_LOCATION_HINTS if token in normalized]
    if negative_hits:
        score -= min(40, 12 * len(negative_hits))
        reasons.append(f"negative_locations={','.join(sorted(negative_hits)[:3])}")

    score = int(clamp(score, 0, 100))
    if not reasons:
        reasons.append("no_strong_bucharest_signals")
    return score, reasons


def infer_incident_type(text: str, fallback: str) -> str:
    normalized = normalize_text(text)
    for incident_type, tokens in TYPE_RULES:
        if any(token in normalized for token in tokens):
            return incident_type
    fallback_value = clean_spaces(fallback or "").lower()
    return fallback_value or "general"


def classify_incident(text: str) -> Tuple[int, str, str, List[str]]:
    normalized = normalize_text(text)
    reasons: List[str] = []
    score = 45
    for value, tokens in SEVERITY_SIGNAL_RULES:
        if any(token in normalized for token in tokens):
            score = max(score, value)
            reasons.append(f"raise:{value}")

    if any(token in normalized for token in ("blocaj total", "trafic blocat", "restrictionat", "restrictii")):
        score = max(score, 74)
        reasons.append("traffic_restriction")

    status = "active"
    if any(token in normalized for token in DE_ESCALATION_SIGNALS["resolved"]):
        score = min(score, 34)
        status = "resolved"
        reasons.append("resolved_signal")
    elif any(token in normalized for token in DE_ESCALATION_SIGNALS["monitoring"]):
        score = min(score, 42)
        status = "monitoring"
        reasons.append("monitoring_signal")

    severity = danger_to_severity(int(clamp(score, 0, 100)))
    if not reasons:
        reasons.append("default_classification")
    return int(clamp(score, 0, 100)), severity, status, reasons


def infer_location(
    text: str,
    raw_location: Optional[Dict[str, object]] = None,
    source_seed: str = "",
) -> Tuple[Dict[str, object], int, List[str]]:
    if raw_location and raw_location.get("lat") is not None and raw_location.get("lon") is not None:
        return (
            {
                "lat": raw_location.get("lat"),
                "lon": raw_location.get("lon"),
                "address": sanitize_ascii(str(raw_location.get("address", "Bucharest, Romania"))),
                "radiusKm": float(raw_location.get("radiusKm", 1.5) or 1.5),
                "accuracy": raw_location.get("accuracy", 120),
            },
            98,
            ["source_coordinates"],
        )

    normalized = normalize_text(text)
    for token, _score, label, lat, lon, radius_km, accuracy, confidence in LOCATION_CATALOG:
        if token in normalized:
            return (
                {
                    "lat": lat,
                    "lon": lon,
                    "address": label,
                    "radiusKm": radius_km,
                    "accuracy": accuracy,
                },
                int(confidence),
                [f"catalog:{token}"],
            )

    sector_match = re.search(r"\bsector(?:ul)?\s*([1-6])\b", normalized)
    if sector_match:
        sector = sector_match.group(1)
        lat, lon = SECTOR_COORDS[sector]
        return (
            {
                "lat": lat,
                "lon": lon,
                "address": f"Sector {sector}, Bucharest",
                "radiusKm": 2.2,
                "accuracy": 1300,
            },
            62,
            [f"sector_regex:{sector}"],
        )

    for token, (lat, lon, address) in ILFOV_HINT_LOCATIONS.items():
        if token in normalized:
            return (
                {
                    "lat": lat,
                    "lon": lon,
                    "address": address,
                    "radiusKm": 2.4,
                    "accuracy": 1200,
                },
                58,
                [f"ilfov_hint:{token}"],
            )

    estimated = estimate_bucharest_location(source_seed or normalized)
    return estimated, 52, ["estimated_sector_from_source"]


def estimate_bucharest_location(seed: str) -> Dict[str, object]:
    digest = hashlib.sha1(seed.encode("utf-8", errors="ignore")).hexdigest()
    sector = str((int(digest[:2], 16) % 6) + 1)
    lat, lon = SECTOR_COORDS[sector]
    return {
        "lat": lat,
        "lon": lon,
        "address": f"Bucharest - estimated sector {sector}",
        "radiusKm": 2.6,
        "accuracy": 1700,
    }


def build_source_fingerprint(incident_type: str, normalized_text: str, address: str) -> str:
    tokens = re.findall(r"[a-z0-9]{3,}", normalized_text)
    unique_tokens = []
    for token in tokens:
        if token in STOPWORDS or token.isdigit():
            continue
        if token not in unique_tokens:
            unique_tokens.append(token)
    address_key = normalize_text(address).replace(" ", "_")
    token_key = "|".join(sorted(unique_tokens[:8]))
    return stable_key(incident_type, address_key, token_key)


def extract_raw_meta_text(raw_meta: Optional[Dict[str, object]]) -> str:
    if not isinstance(raw_meta, dict):
        return ""
    chunks: List[str] = []
    for value in raw_meta.values():
        if isinstance(value, str):
            chunks.append(value)
    return sanitize_ascii(" ".join(chunks))


def is_recent_enough(published_at: datetime, max_age_hours: int) -> bool:
    if not isinstance(published_at, datetime):
        return False
    moment = published_at
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(tz=timezone.utc) - moment.astimezone(timezone.utc)).total_seconds()
    if age_seconds < -7200:
        return False
    return age_seconds <= max_age_hours * 3600
