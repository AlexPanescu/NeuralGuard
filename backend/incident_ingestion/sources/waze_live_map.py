from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Iterable

import requests

from incident_ingestion.models import IncidentRecord
from incident_ingestion.text_utils import clean_spaces, sanitize_ascii, stable_key


class WazeLiveMapSource:
    """
    Direct Waze live-map georss endpoint.
    """

    name = "waze_live_map"
    base_url = "https://www.waze.com"
    live_map_url = "https://www.waze.com/ro/live-map/"

    def __init__(
        self,
        timeout_seconds: int,
        user_agent: str,
        bucharest_bbox: tuple[float, float, float, float],
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent,
                "Accept": "application/json,text/plain,*/*",
                "Referer": self.live_map_url,
            }
        )
        self.bottom, self.left, self.top, self.right = bucharest_bbox
        self.grid_size = max(1, min(6, int(os.getenv("INCIDENTS_WAZE_GRID_SIZE", "2"))))

    def fetch(self) -> Iterable[IncidentRecord]:
        snapshot_file = os.getenv("WAZE_GEORSS_SNAPSHOT_FILE", "").strip()
        if snapshot_file:
            snapshot_records = list(self._fetch_from_snapshot(snapshot_file))
            if snapshot_records:
                return snapshot_records
        return list(self._fetch_from_waze())

    def _fetch_from_waze(self) -> Iterable[IncidentRecord]:
        self._bootstrap_visitor()
        records_by_key: dict[str, IncidentRecord] = {}
        for index, (bottom, left, top, right) in enumerate(self._iter_query_boxes(), start=1):
            try:
                response = self.session.get(
                    f"{self.base_url}/live-map/api/georss",
                    params={
                        "bottom": bottom,
                        "left": left,
                        "top": top,
                        "right": right,
                        "env": "row",
                        "types": "alerts,traffic",
                    },
                    timeout=self.timeout_seconds,
                )
            except requests.RequestException:
                continue

            if response.status_code != 200:
                continue
            payload = response.json() if response.content else {}
            if not isinstance(payload, dict):
                continue
            for record in self._records_from_payload(payload, origin=f"waze_grid_{index}"):
                records_by_key[record.sourceKey] = record
        return list(records_by_key.values())

    def _fetch_from_snapshot(self, snapshot_file: str) -> Iterable[IncidentRecord]:
        try:
            with open(snapshot_file, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return []

        data = payload.get("payload") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            return []
        return self._records_from_payload(data, origin="waze_snapshot")

    def _records_from_payload(self, data: dict, origin: str = "") -> list[IncidentRecord]:
        alerts = data.get("alerts")
        jams = data.get("jams")
        if not isinstance(alerts, list) and not isinstance(jams, list):
            return []

        records: list[IncidentRecord] = []
        for alert in alerts if isinstance(alerts, list) else []:
            if not isinstance(alert, dict):
                continue
            lat, lon = self._extract_coords(alert)
            if lat is None or lon is None:
                continue

            street = sanitize_ascii(clean_spaces(str(alert.get("street") or "")))
            raw_type = sanitize_ascii(clean_spaces(str(alert.get("type") or "")))
            raw_subtype = sanitize_ascii(clean_spaces(str(alert.get("subtype") or "")))
            normalized_type = self._normalize_alert_type(raw_type, raw_subtype)
            report_description = sanitize_ascii(clean_spaces(str(alert.get("reportDescription") or "")))
            title = report_description or self._fallback_alert_title(normalized_type, street)
            summary = report_description or self._fallback_alert_summary(normalized_type, street)
            published_at = self._parse_pub_time(alert.get("pubMillis"), alert.get("pub_utc_millis"))
            stable_alert_id = self._extract_stable_alert_id(alert, lat, lon, street, raw_type, raw_subtype)
            raw_meta = {
                "subtype": raw_subtype,
                "type": raw_type,
                "confidence": alert.get("confidence"),
                "nThumbsUp": alert.get("nThumbsUp"),
                "sourceKind": "alerts",
                "wazeStableId": stable_alert_id,
            }
            if origin:
                raw_meta["origin"] = origin
            records.append(
                IncidentRecord(
                    title=title[:140],
                    type=normalized_type[:80],
                    summary=summary[:500],
                    publishedAt=published_at,
                    source=self.name,
                    sourceKey=stable_key(
                        self.name,
                        "alert",
                        stable_alert_id,
                    ),
                    sourceUrl=self.live_map_url,
                    rawLocation={
                        "lat": lat,
                        "lon": lon,
                        "address": street or "Bucuresti, Romania",
                        "radiusKm": 0.8,
                        "accuracy": 100,
                    },
                    rawMeta=raw_meta,
                )
            )

        for jam in jams if isinstance(jams, list) else []:
            if not isinstance(jam, dict):
                continue
            lat, lon = self._extract_jam_coords(jam)
            if lat is None or lon is None:
                continue

            street = sanitize_ascii(clean_spaces(str(jam.get("street") or "")))
            level = sanitize_ascii(clean_spaces(str(jam.get("level") or "")))
            title = f"Trafic aglomerat {('- ' + street) if street else ''}".strip()
            summary = f"Ambuteiaj Waze{(' nivel ' + level) if level else ''}{(' pe ' + street) if street else ''}".strip()
            published_at = self._parse_pub_time(
                jam.get("pubMillis"),
                jam.get("pub_utc_millis"),
                jam.get("updateMillis"),
                jam.get("lastUpdateMillis"),
            )
            stable_jam_id = self._extract_stable_jam_id(jam, lat, lon, street, level)
            raw_meta = {
                "sourceKind": "jams",
                "jamLevel": jam.get("level"),
                "speed": jam.get("speed"),
                "length": jam.get("length"),
                "blockType": jam.get("blockType"),
                "wazeStableId": stable_jam_id,
            }
            if origin:
                raw_meta["origin"] = origin
            records.append(
                IncidentRecord(
                    title=title[:140] or "Trafic aglomerat",
                    type="traffic_jam",
                    summary=summary[:500],
                    publishedAt=published_at,
                    source=self.name,
                    sourceKey=stable_key(
                        self.name,
                        "jam",
                        stable_jam_id,
                    ),
                    sourceUrl=self.live_map_url,
                    rawLocation={
                        "lat": lat,
                        "lon": lon,
                        "address": street or "Bucuresti, Romania",
                        "radiusKm": 1.1,
                        "accuracy": 120,
                    },
                    rawMeta=raw_meta,
                )
            )
        return records

    def _iter_query_boxes(self) -> list[tuple[float, float, float, float]]:
        if self.grid_size <= 1:
            return [(self.bottom, self.left, self.top, self.right)]
        lat_step = (self.top - self.bottom) / self.grid_size
        lon_step = (self.right - self.left) / self.grid_size
        boxes: list[tuple[float, float, float, float]] = []
        for row in range(self.grid_size):
            for col in range(self.grid_size):
                bottom = self.bottom + row * lat_step
                top = self.top if row == self.grid_size - 1 else self.bottom + (row + 1) * lat_step
                left = self.left + col * lon_step
                right = self.right if col == self.grid_size - 1 else self.left + (col + 1) * lon_step
                boxes.append((bottom, left, top, right))
        return boxes

    def _fallback_alert_title(self, normalized_type: str, street: str) -> str:
        type_labels = {
            "road_closed": "Drum inchis",
            "traffic_jam": "Trafic aglomerat",
            "police": "Politie in zona",
            "accident": "Accident rutier",
            "hazard": "Pericol pe carosabil",
            "construction": "Lucrari pe drum",
            "weather": "Conditii meteo dificile",
        }
        base = type_labels.get(normalized_type, "Incident Waze")
        if street:
            return f"{base} - {street}"
        return base

    def _fallback_alert_summary(self, normalized_type: str, street: str) -> str:
        title = self._fallback_alert_title(normalized_type, street)
        return f"{title} (sursa Waze)"

    def _normalize_alert_type(self, raw_type: str, raw_subtype: str) -> str:
        token_blob = f"{raw_type} {raw_subtype}".strip().lower()
        if any(token in token_blob for token in ("road_closed", "blocked", "closure")):
            return "road_closed"
        if any(token in token_blob for token in ("traffic_jam", "jam")):
            return "traffic_jam"
        if "police" in token_blob:
            return "police"
        if "accident" in token_blob:
            return "accident"
        if any(token in token_blob for token in ("hazard", "object", "animal", "pothole")):
            return "hazard"
        if any(token in token_blob for token in ("construction", "roadworks")):
            return "construction"
        if any(token in token_blob for token in ("weather", "flood", "fog", "snow", "rain")):
            return "weather"
        return "traffic"

    def _extract_stable_alert_id(
        self,
        alert: dict,
        lat: float,
        lon: float,
        street: str,
        raw_type: str,
        raw_subtype: str,
    ) -> str:
        for key in ("uuid", "id", "reportBy"):
            value = clean_spaces(str(alert.get(key) or ""))
            if value:
                return f"{key}:{value.lower()}"
        waze_data = clean_spaces(str(alert.get("wazeData") or ""))
        if waze_data:
            parts = [part.strip() for part in waze_data.split(",") if part.strip()]
            if parts:
                if len(parts) >= 4:
                    return f"wazeData:{parts[-1].lower()}"
                return f"wazeData:{'|'.join(parts).lower()}"
        fallback = f"{raw_type}|{raw_subtype}|{street}|{lat:.5f}|{lon:.5f}"
        return f"fallback:{stable_key(fallback)}"

    def _extract_stable_jam_id(
        self,
        jam: dict,
        lat: float,
        lon: float,
        street: str,
        level: str,
    ) -> str:
        for key in ("uuid", "id", "wazeData"):
            value = clean_spaces(str(jam.get(key) or ""))
            if not value:
                continue
            if key == "wazeData":
                parts = [part.strip() for part in value.split(",") if part.strip()]
                if len(parts) >= 4:
                    return f"wazeData:{parts[-1].lower()}"
            return f"{key}:{value.lower()}"

        line = jam.get("line")
        if isinstance(line, list) and line:
            line_points = []
            for point in line[:4]:
                if not isinstance(point, dict):
                    continue
                point_lat = self._to_float(point.get("y") or point.get("lat"))
                point_lon = self._to_float(point.get("x") or point.get("lon"))
                if point_lat is None or point_lon is None:
                    continue
                line_points.append(f"{point_lat:.5f}:{point_lon:.5f}")
            if line_points:
                return f"line:{'|'.join(line_points)}"

        fallback = f"{street}|{level}|{lat:.5f}|{lon:.5f}"
        return f"fallback:{stable_key(fallback)}"

    def _bootstrap_visitor(self) -> None:
        visitor_id = str(uuid.uuid4())
        self.session.cookies.set("_web_visitorid", visitor_id, domain="www.waze.com", path="/")
        try:
            self.session.post(
                f"{self.base_url}/web-events/visitors",
                headers={"Content-Type": "application/json"},
                timeout=self.timeout_seconds,
            )
            self.session.get(
                f"{self.base_url}/api/config/LivemapConfig",
                headers={"Content-Type": "application/json"},
                timeout=self.timeout_seconds,
            )
        except requests.RequestException:
            return

    def _parse_pub_time(self, *values: object) -> datetime:
        for value in values:
            try:
                raw = int(value)
            except (TypeError, ValueError):
                continue
            if raw <= 0:
                continue
            # Waze fields can be sec/ms/us/ns depending on endpoint payload.
            # Normalize to epoch seconds by repeatedly shrinking huge values.
            normalized = raw
            while normalized > 9_999_999_999:
                normalized = normalized // 1000
            try:
                return datetime.fromtimestamp(normalized, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                continue
        return datetime.now(tz=timezone.utc)

    def _extract_coords(self, alert: dict) -> tuple[float | None, float | None]:
        location = alert.get("location")
        if isinstance(location, dict):
            lat = self._to_float(location.get("y") or location.get("lat"))
            lon = self._to_float(location.get("x") or location.get("lon"))
            if lat is not None and lon is not None:
                return lat, lon
        lat = self._to_float(alert.get("lat") or alert.get("y"))
        lon = self._to_float(alert.get("lon") or alert.get("x"))
        return lat, lon

    def _extract_jam_coords(self, jam: dict) -> tuple[float | None, float | None]:
        line = jam.get("line")
        if isinstance(line, list) and line:
            first = line[0]
            if isinstance(first, dict):
                lat = self._to_float(first.get("y") or first.get("lat"))
                lon = self._to_float(first.get("x") or first.get("lon"))
                if lat is not None and lon is not None:
                    return lat, lon
        return self._extract_coords(jam)

    def _to_float(self, value: object) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
