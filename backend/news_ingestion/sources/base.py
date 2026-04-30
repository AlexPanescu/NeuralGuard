from __future__ import annotations

from typing import Iterable, Protocol

from news_ingestion.models import NewsRecord


class NewsSource(Protocol):
    name: str

    def fetch(self) -> Iterable[NewsRecord]:
        ...

