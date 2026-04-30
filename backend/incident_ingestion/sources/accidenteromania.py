from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from incident_ingestion.models import IncidentRecord
from incident_ingestion.text_utils import clean_spaces, sanitize_ascii, stable_key


class AccidenteRomaniaSource:
    name = "accidenteromania"
    homepage_url = "https://accidenteromania.ro/"

    def __init__(
        self,
        timeout_seconds: int,
        user_agent: str,
        bucharest_bbox: tuple[float, float, float, float],
        include_waze_imports: bool = False,
        source_name: str | None = None,
    ) -> None:
        if source_name:
            self.name = clean_spaces(source_name)
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent})
        self.bottom, self.left, self.top, self.right = bucharest_bbox
        self.include_waze_imports = include_waze_imports

    def fetch(self) -> Iterable[IncidentRecord]:
        context = self._fetch_map_context()
        if not context:
            return []

        ajax_url, nonce = context
        response = self.session.post(
            ajax_url,
            data={
                "action": "ar_accidents_map",
                "nonce": nonce,
                "period": "1",
            },
            timeout=self.timeout_seconds,
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        items = ((payload or {}).get("data") or {}).get("items") or []

        records: list[IncidentRecord] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            if bool(item.get("is_waze")) != bool(self.include_waze_imports):
                continue

            lat = self._to_float(item.get("lat"))
            lon = self._to_float(item.get("lng"))
            if lat is None or lon is None:
                continue
            if not self._is_inside_bbox(lat, lon):
                continue

            source_url = clean_spaces(str(item.get("url") or self.homepage_url))
            title = sanitize_ascii(clean_spaces(str(item.get("title") or "Accident rutier")))
            published_at = self._parse_timestamp(item.get("ts"))
            detail = self._fetch_detail(source_url)
            if detail.get("published_at"):
                published_at = detail["published_at"]

            accident_type = sanitize_ascii(detail.get("accident_type") or "")
            summary = sanitize_ascii(detail.get("summary") or title)
            if accident_type and accident_type.lower() not in summary.lower():
                summary = f"{summary}. Tip accident: {accident_type}"

            records.append(
                IncidentRecord(
                    title=title[:140],
                    type="traffic",
                    summary=summary[:500],
                    publishedAt=published_at,
                    source=self.name,
                    sourceKey=stable_key(self.name, str(item.get("id") or ""), source_url),
                    sourceUrl=source_url,
                    rawLocation={
                        "lat": lat,
                        "lon": lon,
                        "address": sanitize_ascii(clean_spaces(detail.get("address") or title)),
                        "radiusKm": 1.2,
                        "accuracy": 120,
                    },
                    rawMeta={
                        "origin": "waze_import" if self.include_waze_imports else "accidenteromania_report",
                        "accidentType": accident_type,
                        "sourceTime": str(item.get("ts") or ""),
                        "detailTime": sanitize_ascii(detail.get("time_text") or ""),
                    },
                )
            )
        return records

    def _fetch_map_context(self) -> tuple[str, str] | None:
        response = self.session.get(self.homepage_url, timeout=self.timeout_seconds)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        wrap = soup.select_one("[data-ar-map='1'][data-ajax][data-nonce]")
        if not wrap:
            return None
        ajax_url = clean_spaces(str(wrap.get("data-ajax") or ""))
        nonce = clean_spaces(str(wrap.get("data-nonce") or ""))
        if not ajax_url or not nonce:
            return None
        return (ajax_url, nonce)

    def _fetch_detail(self, source_url: str) -> dict[str, object]:
        if not source_url:
            return {}
        try:
            response = self.session.get(source_url, timeout=self.timeout_seconds)
            response.raise_for_status()
        except requests.RequestException:
            return {}

        soup = BeautifulSoup(response.text, "html.parser")
        lines = [sanitize_ascii(clean_spaces(item)) for item in soup.stripped_strings if clean_spaces(item)]
        accident_type = ""
        summary = ""
        time_text = ""
        address = ""
        for idx, line in enumerate(lines):
            low = line.lower()
            if not address and ("accident in " in low or "accident in " in sanitize_ascii(low)):
                address = line
            if low == "tip accident" and idx + 1 < len(lines):
                accident_type = sanitize_ascii(lines[idx + 1])
            if " ora " in f" {low} " and not time_text:
                match = re.search(r"ora\s*([0-2]?\d:[0-5]\d)", line, flags=re.IGNORECASE)
                if match:
                    time_text = match.group(1)
            if ("accident rutier" in low or "a fost inregistrat" in low) and len(line) > 24 and not summary:
                summary = line

        published_at = None
        for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
            raw_json = node.string or node.get_text() or ""
            if "datePublished" not in raw_json:
                continue
            try:
                payload = json.loads(raw_json)
            except json.JSONDecodeError:
                continue
            published_at = self._extract_date_published(payload)
            if published_at:
                break

        return {
            "accident_type": accident_type,
            "summary": summary,
            "time_text": time_text,
            "address": address,
            "published_at": published_at,
        }

    def _extract_date_published(self, payload: object) -> datetime | None:
        if isinstance(payload, dict):
            if isinstance(payload.get("datePublished"), str):
                parsed = self._parse_iso_datetime(payload["datePublished"])
                if parsed:
                    return parsed
            for value in payload.values():
                nested = self._extract_date_published(value)
                if nested:
                    return nested
        if isinstance(payload, list):
            for value in payload:
                nested = self._extract_date_published(value)
                if nested:
                    return nested
        return None

    def _parse_iso_datetime(self, value: str) -> datetime | None:
        raw = clean_spaces(str(value or ""))
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _parse_timestamp(self, value: object) -> datetime:
        try:
            ts = int(value)
        except (TypeError, ValueError):
            return datetime.now(tz=timezone.utc)
        if ts <= 0:
            return datetime.now(tz=timezone.utc)
        return datetime.fromtimestamp(ts, tz=timezone.utc)

    def _to_float(self, value: object) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _is_inside_bbox(self, lat: float, lon: float) -> bool:
        return self.bottom <= lat <= self.top and self.left <= lon <= self.right
