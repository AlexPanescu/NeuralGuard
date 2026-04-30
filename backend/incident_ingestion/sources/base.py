from __future__ import annotations

from typing import Iterable, Protocol

from incident_ingestion.models import IncidentRecord


class IncidentSource(Protocol):
    name: str

    def fetch(self) -> Iterable[IncidentRecord]:
        ...

