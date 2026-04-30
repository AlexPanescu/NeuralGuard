# News Ingestion (Python)

Python service that collects live news from configured websites/RSS and upserts documents into MongoDB Atlas `news` collection.

## Document shape

The ingestion writes fields aligned with `backend/models/News.js`:

- `title`
- `summary`
- `content`
- `source`
- `articleUrl`
- `imageUrl`
- `tags`
- `status` (`active`)
- `severityScore`
- `publishedAt`
- `region`
- `translations.ro` / `translations.en` when local Argos Translate models are installed

For dedupe and audit:

- `sourceKey` (unique)
- `createdAt`, `updatedAt`

## Sources

- Configurable source URLs via `NEWS_SOURCE_URLS`
- Optional filtering via `NEWS_KEYWORDS`

Default sources are:
- `https://www.nytimes.com/`
- `https://www.digi24.ro/ultimele-stiri`
- `https://www.bbc.com/news`
- `https://hotnews.ro/ultima-ora`
- `https://www.politico.com/`

Default behavior is `NEWS_MAX_ITEMS_PER_SOURCE=1`, which means one article per site per run (5 total if all 5 are reachable).

## Install

From `backend`:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r news_ingestion/requirements.txt
```

## Configure

1. Copy `news_ingestion/.env.news.example` to `.env.news`.
2. Fill `MONGO_URI`.
3. Optionally tune feeds, keywords, and local translation settings.

PowerShell:

```powershell
$env:ENV_FILE=".env.news"
```

## Run

One-shot:

```bash
python -m news_ingestion.runner --once
```

Dry-run:

```bash
python -m news_ingestion.runner --once --dry-run
```

Backfill cached local translations for existing active articles:

```bash
python -m news_ingestion.runner --backfill-translations
```

Dry-run backfill reads the batch and reports counts without translating or writing:

```bash
python -m news_ingestion.runner --backfill-translations --dry-run
```

Force refresh cached translations:

```bash
python -m news_ingestion.runner --backfill-translations --force-translation-refresh
```

## Local translation with Argos

Translation is local/offline and uses Argos Translate only. It never calls Google, Ollama, or another live translation API from the dashboard read path.

Install the Python dependency:

```bash
pip install -r news_ingestion/requirements.txt
```

Install Romanian/English Argos models manually:

```bash
argospm update
argospm install translate-en_ro
argospm install translate-ro_en
```

If these model names are unavailable in your Argos package index, download the matching `.argosmodel` files and install them:

```bash
argospm install path\to\translate-en_ro.argosmodel
argospm install path\to\translate-ro_en.argosmodel
```

By default, `NEWS_TRANSLATION_AUTO_INSTALL_MODELS=false`; ingestion logs setup instructions and continues when models are missing.

Daemon:

```bash
python -m news_ingestion.runner
```

PowerShell helper:

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\powershell\sync\run-news-sync.ps1 -EnvFile .env.news
```

Argos helper from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File powershell\run-news-argos.ps1 -EnvFile .env.news
```

Dry-run with no Mongo writes and no effective translation writes:

```powershell
powershell -ExecutionPolicy Bypass -File powershell\run-news-argos.ps1 -EnvFile .env.news -DryRun
```

Backfill cached local translations for existing active articles:

```powershell
powershell -ExecutionPolicy Bypass -File powershell\run-news-argos.ps1 -EnvFile .env.news -Backfill
```

Force-refresh cached translations during backfill:

```powershell
powershell -ExecutionPolicy Bypass -File powershell\run-news-argos.ps1 -EnvFile .env.news -Backfill -ForceRefresh
```

Backend npm shortcuts from `backend`:

```bash
npm run news:sync:once
npm run news:sync:dry
npm run news:sync:daemon
npm run news:translations:backfill
npm run news:translations:backfill:dry
```

Useful Argos environment settings:

- `NEWS_TRANSLATION_ENABLED=true` enables local cached translations.
- `NEWS_TRANSLATION_TARGET_LANGS=ro,en` controls supported cached target languages.
- `NEWS_TRANSLATION_PROVIDER=argos-translate` and `NEWS_TRANSLATION_PROVIDER_VERSION=local-v1` must match the dashboard read-path cache validation.
- `NEWS_TRANSLATION_AUTO_INSTALL_MODELS=false` keeps model installation manual by default.
- `NEWS_TRANSLATION_BACKFILL_LIMIT=50` controls how many active articles one backfill pass reads.

## Task Scheduler

Install task (every 15 minutes):

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\powershell\tasks\install\install-news-task.ps1 -IntervalMinutes 15 -EnvFile .env.news
```

Remove task:

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\powershell\tasks\remove\remove-news-task.ps1
```
