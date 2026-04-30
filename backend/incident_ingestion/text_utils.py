from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timezone


def normalize_text(value: str) -> str:
    cleaned = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in cleaned if not unicodedata.combining(char)).lower().strip()


def clean_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def strip_diacritics(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _mojibake_score(value: str) -> int:
    if not value:
        return 0
    markers = ("Ã", "Ä", "Å", "È", "Â", "Ð", "\ufffd", "â")
    return sum(value.count(token) for token in markers)


def repair_mojibake(value: str) -> str:
    """
    Repairs common UTF-8 text that was decoded as latin1/cp1252.
    """
    base = clean_spaces(str(value or ""))
    candidates = [base]
    for encoding in ("latin1", "cp1252"):
        try:
            candidates.append(base.encode(encoding, errors="ignore").decode("utf-8", errors="ignore"))
        except Exception:
            continue
    return min(candidates, key=lambda item: (_mojibake_score(item), -len(item)))


def sanitize_ascii(value: str) -> str:
    raw = clean_spaces(str(value or ""))
    replacements = {
        "È\x99": "s",
        "È\x98": "S",
        "È\x9b": "t",
        "È\x9a": "T",
        "Ä\x83": "a",
        "Ä\x82": "A",
        "Ã¢": "a",
        "Ã‚": "A",
        "Ã®": "i",
        "ÃŽ": "I",
        "Å£": "t",
        "Å¢": "T",
        "â€“": "-",
        "â€”": "-",
        "â€¢": "-",
        "Â": "",
    }
    for broken, fixed in replacements.items():
        raw = raw.replace(broken, fixed)
    repaired = repair_mojibake(raw)
    no_diacritics = strip_diacritics(repaired)
    ascii_only = no_diacritics.encode("ascii", errors="ignore").decode("ascii")
    normalized = clean_spaces(ascii_only)
    common_word_fixes = {
        "Poliiei": "Politiei",
        "Romne": "Romane",
        "informeaz": "informeaza",
        "Bucureti": "Bucuresti",
        "Braov": "Brasov",
        "circulaia": "circulatia",
        "restricionat": "restrictionat",
        "astzi": "astazi",
        "autoritilor": "autoritatilor",
        " n perioada ": " in perioada ",
        " c pe ": " ca pe ",
        " c traficul ": " ca traficul ",
        " c circulaia ": " ca circulatia ",
        " c, ": " ca, ",
        " c ": " ca ",
    }
    for wrong, right in common_word_fixes.items():
        normalized = normalized.replace(wrong, right)
    return clean_spaces(normalized)


def stable_key(*parts: str) -> str:
    joined = "||".join(clean_spaces(part).lower() for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def parse_ro_short_day_month(day_month: str, fallback_year: int | None = None) -> datetime:
    """
    Parses strings like '01 apr' into UTC datetime (00:00).
    """
    lowered = normalize_text(day_month)
    tokens = lowered.split()
    if len(tokens) < 2:
        return datetime.now(tz=timezone.utc)
    month_map = {
        "ian": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "mai": 5,
        "iun": 6,
        "iul": 7,
        "aug": 8,
        "sep": 9,
        "oct": 10,
        "noi": 11,
        "nov": 11,
        "dec": 12,
    }
    try:
        day = int(tokens[0])
    except ValueError:
        return datetime.now(tz=timezone.utc)
    month = month_map.get(tokens[1][:3], datetime.now(tz=timezone.utc).month)
    year = fallback_year or datetime.now(tz=timezone.utc).year
    return datetime(year, month, day, tzinfo=timezone.utc)
