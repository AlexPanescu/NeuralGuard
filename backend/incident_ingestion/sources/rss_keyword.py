from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable, List
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from bs4 import FeatureNotFound

from incident_ingestion.models import IncidentRecord
from incident_ingestion.text_utils import clean_spaces, sanitize_ascii, stable_key


class RssKeywordSource:
    name = "trusted_rss"

    def __init__(self, rss_urls: List[str], timeout_seconds: int, user_agent: str, bucharest_keywords: List[str]) -> None:
        self.rss_urls = [url for url in rss_urls if url]
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent})

    def fetch(self) -> Iterable[IncidentRecord]:
        for url in self.rss_urls:
            try:
                response = self.session.get(url, timeout=self.timeout_seconds)
                response.raise_for_status()
                xml_text = response.content.decode("utf-8", errors="replace")
                yield from self._parse_feed(url, xml_text)
            except requests.RequestException:
                continue

    def _parse_feed(self, feed_url: str, xml_text: str) -> Iterable[IncidentRecord]:
        try:
            soup = BeautifulSoup(xml_text, "xml")
        except FeatureNotFound:
            # Fallback when xml parser backend (e.g. lxml) is not installed.
            soup = BeautifulSoup(xml_text, "html.parser")
        channel_title = sanitize_ascii(
            clean_spaces((soup.find("channel").find("title").get_text(" ", strip=True) if soup.find("channel") else ""))
        )
        source_host = urlparse(feed_url).netloc or "rss"

        for item in soup.find_all("item"):
            title = sanitize_ascii(clean_spaces(item.find("title").get_text(" ", strip=True) if item.find("title") else ""))
            description = sanitize_ascii(
                clean_spaces(item.find("description").get_text(" ", strip=True) if item.find("description") else "")
            )
            link = clean_spaces(item.find("link").get_text(" ", strip=True) if item.find("link") else feed_url)
            published = self._parse_datetime(item.find("pubDate").get_text(" ", strip=True) if item.find("pubDate") else "")

            yield IncidentRecord(
                title=title[:140] or "Stire Bucuresti",
                type="news",
                summary=(description or title)[:500],
                publishedAt=published,
                source=f"{self.name}:{channel_title or source_host}",
                sourceKey=stable_key(self.name, source_host, link, title),
                sourceUrl=link,
                rawMeta={"channelTitle": channel_title, "sourceHost": source_host},
            )

    def _parse_datetime(self, raw_value: str) -> datetime:
        try:
            parsed = parsedate_to_datetime(raw_value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            return datetime.now(tz=timezone.utc)
