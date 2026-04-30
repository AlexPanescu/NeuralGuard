from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable, List
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup
from bs4 import FeatureNotFound

from incident_ingestion.text_utils import clean_spaces, normalize_text, repair_mojibake, stable_key
from news_ingestion.models import NewsRecord, clamp


CATEGORY_PATTERNS = {
    "conflict": re.compile(
        r"\b(war|conflict|military|missile|drone|strike|ceasefire|shelling|attack|troops|sanctions)\b",
        re.IGNORECASE,
    ),
    "economy": re.compile(
        r"\b(inflation|economy|economic|trade|tariff|debt|fiscal|gdp|market|recession|supply chain)\b",
        re.IGNORECASE,
    ),
    "humanitarian": re.compile(
        r"\b(humanitarian|refugee|displaced|aid|famine|outbreak|civilian|relief|food insecurity)\b",
        re.IGNORECASE,
    ),
    "politics": re.compile(
        r"\b(election|government|parliament|protest|policy|minister|president|diplomatic|governance)\b",
        re.IGNORECASE,
    ),
}


REGION_PATTERNS = {
    "Europe": re.compile(r"\b(europe|ukraine|russia|romania|moldova|poland|eu|balkans)\b", re.IGNORECASE),
    "Middle East": re.compile(r"\b(israel|gaza|palestin|iran|iraq|syria|yemen|lebanon|middle east)\b", re.IGNORECASE),
    "Africa": re.compile(r"\b(africa|sudan|ethiopia|sahel|congo|niger|somalia)\b", re.IGNORECASE),
    "Asia-Pacific": re.compile(
        r"\b(asia|china|taiwan|myanmar|korea|japan|philippines|south china sea|indonesia)\b",
        re.IGNORECASE,
    ),
    "Americas": re.compile(r"\b(americas|haiti|venezuela|latin america|united states|canada|mexico|brazil)\b", re.IGNORECASE),
}

GEO_KEYWORDS = {
    "romania": re.compile(r"\b(romania|romanian|bucuresti|bucharest|cluj|iasi|timisoara|constanta)\b", re.IGNORECASE),
    "israel": re.compile(r"\b(israel|netanyahu|tel aviv|jerusalem|hamas|hezbollah)\b", re.IGNORECASE),
    "iran": re.compile(r"\b(iran|tehran)\b", re.IGNORECASE),
    "ukraine": re.compile(r"\b(ukraine|kyiv)\b", re.IGNORECASE),
    "russia": re.compile(r"\b(russia|moscow|kremlin)\b", re.IGNORECASE),
    "usa": re.compile(r"\b(united states|u\.s\.|usa|washington)\b", re.IGNORECASE),
    "eu": re.compile(r"\b(eu|european union|brussels)\b", re.IGNORECASE),
}

TOPIC_TAG_PATTERNS = {
    "war": re.compile(r"\b(war|armed|conflict|frontline|invasion)\b", re.IGNORECASE),
    "protest": re.compile(r"\b(protest|demonstration|riot|march)\b", re.IGNORECASE),
    "election": re.compile(r"\b(election|vote|campaign|parliament)\b", re.IGNORECASE),
    "economy": re.compile(r"\b(economy|economic|gdp|inflation|recession|trade|market)\b", re.IGNORECASE),
    "energy": re.compile(r"\b(energy|oil|gas|electricity|power grid)\b", re.IGNORECASE),
    "cyber": re.compile(r"\b(cyber|ransomware|hacker|data breach)\b", re.IGNORECASE),
    "health": re.compile(r"\b(health|hospital|medical|epidemic|virus|disease)\b", re.IGNORECASE),
    "climate": re.compile(r"\b(climate|heatwave|flood|wildfire|storm|drought)\b", re.IGNORECASE),
    "earthquake": re.compile(r"\b(earthquake|seismic|richter)\b", re.IGNORECASE),
}

SITE_RSS_FALLBACKS = {
    "www.nytimes.com": ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"],
    "nytimes.com": ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"],
    "www.bbc.com": ["https://feeds.bbci.co.uk/news/rss.xml"],
    "bbc.com": ["https://feeds.bbci.co.uk/news/rss.xml"],
    "hotnews.ro": ["https://hotnews.ro/rss"],
    "www.hotnews.ro": ["https://hotnews.ro/rss"],
    "www.politico.com": ["https://www.politico.com/rss/politicopicks.xml"],
    "politico.com": ["https://www.politico.com/rss/politicopicks.xml"],
    "www.digi24.ro": ["https://www.digi24.ro/rss"],
    "digi24.ro": ["https://www.digi24.ro/rss"],
}


class RssFeedSource:
    name = "rss_feed"

    def __init__(
        self,
        source_urls: List[str],
        timeout_seconds: int,
        user_agent: str,
        keywords: List[str],
        max_items_per_source: int,
    ) -> None:
        self.source_urls = [self._normalize_url(url) for url in source_urls if url]
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent})
        self.keywords = [normalize_text(item) for item in keywords if item]
        self.max_items_per_source = max_items_per_source

    def fetch(self) -> Iterable[NewsRecord]:
        for source_url in self.source_urls:
            try:
                response = self.session.get(source_url, timeout=self.timeout_seconds)
                response.raise_for_status()
                page_text = self._decode_response_text(response)
                yielded = 0
                for record in self._parse_feed(source_url, page_text):
                    yield record
                    yielded += 1
                    if yielded >= self.max_items_per_source:
                        break
                if yielded == 0:
                    fallback = self._parse_html_headline(source_url, page_text)
                    if fallback is not None:
                        yield fallback
                        yielded += 1
                if yielded == 0:
                    for rss_url in self._rss_fallbacks(source_url):
                        try:
                            rss_response = self.session.get(rss_url, timeout=self.timeout_seconds)
                            rss_response.raise_for_status()
                            rss_text = self._decode_response_text(rss_response)
                            for record in self._parse_feed(rss_url, rss_text):
                                # Keep requested source identity in "source"
                                record.source = f"web:{(urlparse(source_url).netloc or 'site').replace('www.', '')}"[:120]
                                record.publishedAt = datetime.now(tz=timezone.utc)
                                yield record
                                yielded += 1
                                break
                            if yielded > 0:
                                break
                        except requests.RequestException:
                            continue
            except requests.RequestException:
                continue

    def _parse_feed(self, feed_url: str, xml_text: str) -> Iterable[NewsRecord]:
        try:
            soup = BeautifulSoup(xml_text, "xml")
        except FeatureNotFound:
            soup = BeautifulSoup(xml_text, "html.parser")

        channel = soup.find("channel")
        feed_title = self._clean(channel.find("title").get_text(" ", strip=True) if channel and channel.find("title") else "")
        source_host = urlparse(feed_url).netloc or "rss"
        source_name = feed_title or source_host

        rss_items = soup.find_all("item")
        atom_items = soup.find_all("entry")
        items = rss_items if rss_items else atom_items

        for item in items:
            title = self._clean(self._extract_text(item, ["title"]))
            summary = self._clean(self._extract_text(item, ["description", "summary", "content:encoded", "content"]))
            link = self._extract_link(item, feed_url)
            published_at = datetime.now(tz=timezone.utc)
            image_url = self._extract_image_url(item)
            content = self._clean(self._extract_content(item, summary))

            if not title and not summary:
                continue

            blob = " ".join(part for part in [title, summary, content, link] if part)
            if not self._passes_keyword_filter(blob):
                continue

            category = self._classify_category(blob)
            region = self._derive_region(blob)
            severity_score = self._compute_severity(category, blob, published_at)

            fallback_summary = summary or content or title
            enriched_summary, enriched_content, enriched_image = self._extract_article_details(
                article_url=link,
                source_url=feed_url,
                fallback_summary=fallback_summary,
                fallback_content=content or fallback_summary,
            )
            news_title = (title or "Operational update")[:220]
            news_summary = (enriched_summary or fallback_summary)[:1200]
            news_content = (enriched_content or content or fallback_summary)[:20000]
            canonical_url = self._canonicalize_article_url(link)
            article_url = canonical_url[:600]
            source = f"{self.name}:{source_name}"[:120]
            image = (enriched_image or image_url)[:1200]
            tag_blob = " ".join([news_title, news_summary, news_content, article_url, source_name])
            region = self._derive_region(tag_blob)
            category = self._classify_category(tag_blob)
            tags = self._derive_tags(category, region, tag_blob)

            yield NewsRecord(
                title=news_title,
                summary=news_summary,
                content=news_content,
                source=source,
                articleUrl=article_url,
                imageUrl=image,
                tags=tags,
                status="active",
                severityScore=severity_score,
                publishedAt=published_at,
                region=region[:120],
                sourceKey=stable_key(self.name, source_host, article_url or news_title, news_title),
                articleUrlKey=stable_key("url", article_url or news_title),
            )

    def _parse_html_headline(self, source_url: str, html_text: str) -> NewsRecord | None:
        soup = BeautifulSoup(html_text, "html.parser")
        source_host = urlparse(source_url).netloc or "site"
        source_name = source_host.replace("www.", "")
        candidates = []

        for heading_tag in ["h1", "h2", "h3"]:
            for heading in soup.find_all(heading_tag):
                label = self._clean(heading.get_text(" ", strip=True))
                if not label or len(label) < 25 or len(label) > 220:
                    continue
                parent_link = heading.find_parent("a")
                href = clean_spaces(parent_link.get("href", "")) if parent_link else ""
                if not href:
                    nested_link = heading.find("a")
                    href = clean_spaces(nested_link.get("href", "")) if nested_link else ""
                if not href:
                    continue
                article_url = urljoin(source_url, href)
                if self._is_non_article_link(article_url):
                    continue
                candidates.append((label, article_url))

        if not candidates:
            for link in soup.find_all("a", href=True):
                label = self._clean(link.get_text(" ", strip=True))
                if not label or len(label) < 35 or len(label) > 220:
                    continue
                article_url = urljoin(source_url, clean_spaces(link.get("href", "")))
                if self._is_non_article_link(article_url):
                    continue
                if urlparse(article_url).netloc and urlparse(article_url).netloc != source_host:
                    continue
                candidates.append((label, article_url))
                if len(candidates) >= 40:
                    break

        for title, article_url in candidates:
            blob = f"{title} {article_url}"
            if not self._passes_keyword_filter(blob):
                continue
            category = self._classify_category(blob)
            region = self._derive_region(blob)
            severity_score = self._compute_severity(category, blob, datetime.now(tz=timezone.utc))
            enriched_summary, enriched_content, enriched_image = self._extract_article_details(
                article_url=article_url,
                source_url=source_url,
                fallback_summary=title,
                fallback_content=title,
            )
            tag_blob = " ".join([title, enriched_summary or "", enriched_content or "", article_url])
            category = self._classify_category(tag_blob)
            region = self._derive_region(tag_blob)
            return NewsRecord(
                title=title[:220] or "Operational update",
                summary=(enriched_summary or title)[:1200],
                content=(enriched_content or title)[:20000],
                source=f"web:{source_name}"[:120],
                articleUrl=self._canonicalize_article_url(article_url)[:600],
                imageUrl=(enriched_image or "")[:1200],
                tags=self._derive_tags(category, region, tag_blob),
                status="active",
                severityScore=severity_score,
                publishedAt=datetime.now(tz=timezone.utc),
                region=region[:120],
                sourceKey=stable_key("web", source_host, self._canonicalize_article_url(article_url), title),
                articleUrlKey=stable_key("url", self._canonicalize_article_url(article_url) or title),
            )
        return None

    def _extract_text(self, item, candidates: List[str]) -> str:
        for tag_name in candidates:
            node = item.find(tag_name)
            if node:
                return node.get_text(" ", strip=True)
        return ""

    def _extract_content(self, item, fallback: str) -> str:
        raw = self._extract_text(item, ["content:encoded", "content", "description", "summary"])
        if not raw:
            return fallback
        stripped = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
        return clean_spaces(stripped)

    def _extract_link(self, item, fallback: str) -> str:
        direct = item.find("link")
        if direct:
            href = direct.get("href")
            if href:
                return clean_spaces(href)
            text = direct.get_text(" ", strip=True)
            if text:
                return clean_spaces(text)
        guid = item.find("guid")
        if guid and guid.get_text(" ", strip=True).startswith("http"):
            return clean_spaces(guid.get_text(" ", strip=True))
        return clean_spaces(fallback)

    def _extract_image_url(self, item) -> str:
        for tag in ["media:content", "media:thumbnail", "enclosure"]:
            node = item.find(tag)
            if not node:
                continue
            url = clean_spaces(node.get("url", ""))
            if not url:
                continue
            if tag != "enclosure":
                return url
            mime_type = clean_spaces(node.get("type", "")).lower()
            if mime_type.startswith("image/"):
                return url
        return ""

    def _extract_article_details(
        self,
        article_url: str,
        source_url: str,
        fallback_summary: str,
        fallback_content: str,
    ) -> tuple[str, str, str]:
        url = clean_spaces(article_url)
        if not url:
            return fallback_summary, fallback_content, ""
        try:
            response = self.session.get(url, timeout=self.timeout_seconds)
            response.raise_for_status()
            html = self._decode_response_text(response)
        except requests.RequestException:
            return fallback_summary, fallback_content, ""

        soup = BeautifulSoup(html, "html.parser")
        summary = self._extract_meta_value(
            soup,
            [
                ("meta", "property", "og:description"),
                ("meta", "name", "description"),
                ("meta", "name", "twitter:description"),
            ],
        )
        image = self._extract_meta_value(
            soup,
            [
                ("meta", "property", "og:image"),
                ("meta", "name", "twitter:image"),
                ("meta", "property", "og:image:url"),
            ],
            attr="content",
        )
        if not image:
            image = self._extract_first_image(soup, source_url)
        else:
            image = urljoin(source_url, image)

        content = self._extract_article_text(soup)
        content = self._clean(content)[:20000] if content else ""
        summary_clean = self._clean(summary)[:1200] if summary else ""

        if not summary_clean:
            summary_clean = self._clean((content or fallback_summary)[:1200])
        if not content:
            content = self._clean((fallback_content or summary_clean)[:20000])

        return summary_clean, content, clean_spaces(image)

    def _extract_meta_value(self, soup: BeautifulSoup, selectors: List[tuple[str, str, str]], attr: str = "content") -> str:
        for tag, key, value in selectors:
            node = soup.find(tag, attrs={key: value})
            if not node:
                continue
            raw = clean_spaces(node.get(attr, ""))
            if raw:
                return raw
        return ""

    def _extract_first_image(self, soup: BeautifulSoup, source_url: str) -> str:
        for container_selector in ["article", "main", "body"]:
            container = soup.select_one(container_selector)
            if not container:
                continue
            img = container.find("img")
            if not img:
                continue
            src = clean_spaces(img.get("src", ""))
            if src and not src.startswith("data:"):
                return urljoin(source_url, src)
        return ""

    def _extract_article_text(self, soup: BeautifulSoup) -> str:
        candidates = []
        preferred = soup.select("article p, main p")
        nodes = preferred if preferred else soup.find_all("p")
        for node in nodes:
            text = clean_spaces(node.get_text(" ", strip=True))
            if len(text) < 50:
                continue
            if text.lower().startswith(("photo:", "image:", "credit:", "advertisement")):
                continue
            candidates.append(text)
            if len(candidates) >= 40:
                break
        return "\n\n".join(candidates)

    def _normalize_url(self, value: str) -> str:
        url = clean_spaces(value)
        if not url:
            return ""
        if not re.match(r"^https?://", url, re.IGNORECASE):
            url = f"https://{url}"
        return url

    def _canonicalize_article_url(self, value: str) -> str:
        raw = self._normalize_url(value)
        if not raw:
            return ""
        parsed = urlparse(raw)
        scheme = "https" if parsed.scheme in {"http", "https"} else parsed.scheme
        host = (parsed.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = parsed.path or "/"
        if path != "/":
            path = path.rstrip("/")
        tracked_prefixes = ("utm_", "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source")
        kept_query = []
        for key, val in parse_qsl(parsed.query, keep_blank_values=True):
            lowered = key.lower()
            if any(lowered.startswith(prefix) for prefix in tracked_prefixes):
                continue
            kept_query.append((key, val))
        query = urlencode(sorted(kept_query))
        return urlunparse((scheme, host, path, "", query, ""))

    def _is_non_article_link(self, article_url: str) -> bool:
        lowered = article_url.lower()
        if not lowered.startswith("http"):
            return True
        block_tokens = [
            "/video",
            "/podcast",
            "/live",
            "/newsletter",
            "/tag/",
            "/topics/",
            "/search",
            "/contact",
            "/about",
            "#",
        ]
        return any(token in lowered for token in block_tokens)

    def _rss_fallbacks(self, source_url: str) -> List[str]:
        host = (urlparse(source_url).netloc or "").lower()
        return SITE_RSS_FALLBACKS.get(host, [])

    def _classify_category(self, text: str) -> str:
        for category, pattern in CATEGORY_PATTERNS.items():
            if pattern.search(text):
                return category
        return "politics"

    def _derive_region(self, text: str) -> str:
        for region, pattern in REGION_PATTERNS.items():
            if pattern.search(text):
                return region
        return "Global"

    def _compute_severity(self, category: str, text: str, published_at: datetime) -> int:
        base = {
            "conflict": 76,
            "humanitarian": 72,
            "economy": 61,
            "politics": 57,
        }.get(category, 55)
        hours_old = max(0.0, (datetime.now(tz=timezone.utc) - published_at).total_seconds() / 3600.0)
        fresh_boost = max(0.0, 16.0 - hours_old)
        urgent_boost = 7 if re.search(r"\b(urgent|breaking|attack|strike|ceasefire|warning|explosion|displaced)\b", text, re.I) else 0
        regional_boost = 4 if self._derive_region(text) != "Global" else 0
        return int(clamp(round(base + fresh_boost + urgent_boost + regional_boost), 30, 99))

    def _derive_tags(self, category: str, region: str, text: str) -> List[str]:
        tags = [category, region.lower().replace(" ", "-")]

        for geo_tag, pattern in GEO_KEYWORDS.items():
            if pattern.search(text):
                tags.append(geo_tag)

        for topic_tag, pattern in TOPIC_TAG_PATTERNS.items():
            if pattern.search(text):
                tags.append(topic_tag)

        if re.search(r"\bbreaking|urgent\b", text, re.IGNORECASE):
            tags.append("breaking")

        deduped = []
        seen = set()
        for item in tags:
            normalized = clean_spaces(item).lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized[:40])
        return deduped[:10]

    def _passes_keyword_filter(self, text: str) -> bool:
        if not self.keywords:
            return True
        normalized = normalize_text(text)
        return any(keyword in normalized for keyword in self.keywords)

    def _clean(self, value: str) -> str:
        # Keep Romanian diacritics. Repair only when mojibake artifacts are present.
        raw = clean_spaces(value)
        if self._looks_mojibake(raw):
            return clean_spaces(repair_mojibake(raw))
        return raw

    def _decode_response_text(self, response: requests.Response) -> str:
        current = (response.encoding or "").lower()
        apparent = (response.apparent_encoding or "").strip()
        # Some sites incorrectly expose latin1/ISO-8859-1 headers for UTF-like content.
        if apparent and (not current or current in {"iso-8859-1", "latin-1", "latin1", "ascii"}):
            response.encoding = apparent
        elif not current:
            response.encoding = "utf-8"
        return response.text

    def _looks_mojibake(self, value: str) -> bool:
        if not value:
            return False
        markers = ("Ã", "â€", "â€“", "â€”", "Å£", "È™", "È›", "ï»¿", "\ufffd")
        return any(token in value for token in markers)
