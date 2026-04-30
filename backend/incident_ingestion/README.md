# Incident Ingestion (Python) - Bucuresti

Sistem Python care colecteaza automat incidente relevante pentru Bucuresti din surse verificate si face `upsert` in colectia MongoDB Atlas `incidents`.

## Structura documentului

Documentele inserate respecta campurile cerute:

- `title`
- `type`
- `severity`
- `status`
- `summary`
- `dangerScore`
- `riskUpdatedAt`
- `location` (`lat`, `lon`, `address`, `radiusKm`, `accuracy`)
- `source`

In plus, pentru deduplicare si audit:

- `sourceKey` (unic)
- `sourceFingerprint` (deduplicare cross-source)
- `sourceUrl`
- `rawTitle`, `rawSummary`, `normalizedText`
- `ingestionMeta`
- `duplicateOf`
- `relevanceScore`
- `geoConfidence`
- `classificationVersion`
- `createdAt`, `updatedAt`
- `lastSeenAt`
- `resolutionReason` (cand se inchide automat)

## Surse implementate

1. `accidenteromania.ro` (raportari standard, cu locatie + ora)
2. `waze.com/ro/live-map` (direct, sursa `waze_live_map`)
3. `accidenteromania.ro` importuri Waze (sursa `waze_live_map_import`, fallback operational)

Filtrarea este keyword-based pe Bucuresti (`BUCHAREST_KEYWORDS`).
Pipeline-ul curent executa etapele `fetch -> normalize -> relevance -> classify -> deduplicate -> persist -> stale resolution`
si afiseaza rapoarte per sursa, motive de skip si motive de auto-resolve.

## Instalare

Din folderul `backend`:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r incident_ingestion/requirements.txt
```

## Configurare

1. Copiaza `incident_ingestion/.env.incidents.example` in `.env.incidents`.
2. Completeaza `MONGO_URI`.
3. Optional: ajusteaza `INCIDENTS_BUCHAREST_BBOX` pentru aria monitorizata.
4. Optional: seteaza `INCIDENTS_MAX_ITEM_AGE_HOURS` pentru a ignora articole vechi (implicit 72h).

In PowerShell:

```powershell
$env:ENV_FILE=".env.incidents"
```

## Rulare

One-shot (bun pentru test):

```bash
python -m incident_ingestion.runner --once
```

Dry-run (fara scriere in Mongo):

```bash
python -m incident_ingestion.runner --once --dry-run
```

Daemon (polling automat):

```bash
python -m incident_ingestion.runner
```

PowerShell helper (sync + optional normalize text):

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\powershell\sync\run-incidents-sync.ps1 -EnvFile .env.incidents -NormalizeExisting
```

## Recomandare productie

Instalare Task Scheduler (ruleaza la 15 minute, sub SYSTEM):

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\powershell\tasks\install\install-incidents-task.ps1 -IntervalMinutes 15 -EnvFile .env.incidents
```

Dezinstalare:

```powershell
powershell -ExecutionPolicy Bypass -File ..\remove-incidents-task.ps1
```
