# Neural Guard
## [DESCHIDE LIVRABILELE AICI](./livrabile/)
Neural Guard este o aplicatie web pentru siguranta urbana si raspuns in situatii de urgenta. Proiectul combina un dashboard React, un API Node.js/Express, date persistate in MongoDB, comunicare realtime prin Socket.IO, un copilot AI local prin Ollama si servicii Python care colecteaza incidente si stiri.

> [!IMPORTANT]
> **LIVRABILELE OFICIALE SUNT IN FOLDERUL [`livrabile/`](./livrabile/).**
>
> Acest `README.MD` explica doar aplicatia (arhitectura, setup, rulare, endpoint-uri).

## Cuprins

- [Functionalitati](#functionalitati)
- [Stack tehnic](#stack-tehnic)
- [Structura proiectului](#structura-proiectului)
- [Cerinte](#cerinte)
- [Configurare rapida](#configurare-rapida)
- [Variabile de mediu](#variabile-de-mediu)
- [Pornire automata pe Windows](#pornire-automata-pe-windows)
- [Pornire manuala](#pornire-manuala)
- [AI local cu Ollama](#ai-local-cu-ollama)
- [Ingestion incidente](#ingestion-incidente)
- [Ingestion stiri](#ingestion-stiri)
- [Task Scheduler](#task-scheduler)
- [Teste si verificari](#teste-si-verificari)
- [Endpoint-uri principale](#endpoint-uri-principale)
- [Pregatire pentru GitHub](#pregatire-pentru-github)
- [Troubleshooting](#troubleshooting)

## Functionalitati

Aplicatia ofera:

- Harta si lista de incidente urbane.
- Dashboard de risc personal si situatie operationala.
- Sistem SOS cu alerte, statusuri, acknowledge, responding, cancel si resolve.
- Autentificare cu email/parola si JWT.
- Profil utilizator, locatie, prezenta si setari de incluziune/accesibilitate.
- Ghiduri educationale PDF pentru cutremur, incendiu si prim ajutor.
- Stiri operationale colectate automat si afisate in dashboard.
- Copilot AI pentru situatii de urgenta, bazat pe Ollama local.
- Comunicatie realtime prin Socket.IO.
- Scripturi Python pentru sincronizarea automata a incidentelor si stirilor in MongoDB.

## Stack tehnic

Frontend:

- React 19
- Vite 7
- React Router DOM 7
- Axios
- Tailwind/PostCSS
- Playwright pentru smoke test mobil

Backend:

- Node.js
- Express 5
- MongoDB Atlas / MongoDB local prin Mongoose
- Socket.IO
- JWT pentru autentificare
- bcrypt pentru parole
- multer pentru upload PDF/imagini
- Cloudinary optional, daca se extinde partea de media

Servicii auxiliare:

- Python pentru incident ingestion si news ingestion
- Argos Translate optional pentru traduceri locale RO/EN la stiri
- Ollama optional pentru AI local
- PowerShell pentru pornire si task-uri automate pe Windows

## Structura proiectului

```text
.
|-- README.MD
|-- package.json
|-- backend/
|   |-- package.json
|   |-- src/
|   |   |-- server.js
|   |   |-- config/
|   |   `-- services/
|   |-- models/
|   |-- data/
|   |   |-- ai/
|   |   |-- chat/
|   |   |-- guides/
|   |   |-- markers/
|   |   `-- users/
|   |-- incident_ingestion/
|   |-- news_ingestion/
|   |-- scripts/
|   `-- tests/
|-- frontend/
|   |-- package.json
|   |-- vite.config.js
|   |-- public/
|   |-- src/
|   |   |-- api/
|   |   |-- components/
|   |   |-- context/
|   |   |-- hooks/
|   |   |-- i18n/
|   |   |-- lib/
|   |   |-- pages/
|   |   |-- styles/
|   |   `-- utils/
|   `-- tests/
`-- powershell/
    |-- start-dev.ps1
    |-- sync/
    `-- tasks/
```

## Cerinte

Trebuie instalate in prealabil:

- Node.js 20+ recomandat
- npm
- Python 3.10+ recomandat
- Git
- MongoDB Atlas sau MongoDB local
- PowerShell 5+ pe Windows
- Ollama, optional pentru copilot AI
- Argos Translate models, optional pentru traduceri locale la stiri

Instalarea se verifica prin:

```powershell
node -v
npm -v
python --version
git --version
```

Pentru Ollama:

```powershell
ollama --version
```

## Configurare rapida

Din radacina proiectului:

In toate comenzile, `<cale-catre-proiect>` trebuie inlocuit cu locatia reala a proiectului. Exemple valide:

```powershell
cd "C:\Users\Nume\Projects\neural-guard"
cd "D:\Aplicatie pc 8 (hardcore)"
cd "E:\Licenta\neural-guard"
```

```powershell
cd "<cale-catre-proiect>"
npm install
cd backend
npm install
cd ..\frontend
npm install
```

Trebuie instalate dependintele Python pentru serviciile de ingestion:

```powershell
cd "<cale-catre-proiect>\backend"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r incident_ingestion\requirements.txt
pip install -r news_ingestion\requirements.txt
```

Fisierele `.env` se pregatesc astfel:

```powershell
cd "<cale-catre-proiect>\backend"
Copy-Item incident_ingestion\.env.incidents.example .env.incidents -ErrorAction SilentlyContinue
Copy-Item news_ingestion\.env.news.example .env.news -ErrorAction SilentlyContinue
```

Important: inainte de publicarea proiectului pe GitHub, trebuie verificat ca fisierele `.env` reale sau URI-urile MongoDB cu parola sa nu fie incluse in repository.

## Variabile de mediu

Backend-ul citeste fisierul indicat de `ENV_FILE`; daca nu exista, foloseste `backend/.env`.

Exemplu pentru `backend/.env`:

```env
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
MONGO_DB=test

JWT_SECRET=inlocuiti-cu-un-secret-lung-si-random
JWT_EXPIRES_IN=8h
JWT_CLOCK_SKEW_SECONDS=60
AUTH_ALLOW_LEGACY_X_USER_ID=false

INCIDENTS_VISIBLE_MAX_AGE_HOURS=72

OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:14b
OLLAMA_TIMEOUT_MS=30000

EMERGENCY_COPILOT_OLLAMA_HOST=http://127.0.0.1:11434
EMERGENCY_COPILOT_OLLAMA_MODEL=qwen3:14b
EMERGENCY_COPILOT_OLLAMA_TIMEOUT_MS=12000
EMERGENCY_COPILOT_DEBUG_ROUTING=0

NEWS_TRANSLATION_PROVIDER=argos-translate
NEWS_TRANSLATION_PROVIDER_VERSION=local-v1
```

Frontend-ul foloseste `frontend/.env`:

```env
VITE_API_URL=http://localhost:5000
```

Pentru productie, `VITE_API_URL` trebuie configurat cu URL-ul real al backend-ului.

### `.env.incidents`

Folosit de serviciul Python pentru incidente:

```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/?appName=<app>
MONGO_DB=incidents

INCIDENTS_POLL_SECONDS=900
INCIDENTS_TIMEOUT_SECONDS=20
INCIDENTS_MAX_ITEM_AGE_HOURS=72
INCIDENTS_USER_AGENT=BucharestIncidentBot/1.0
INCIDENTS_BUCHAREST_BBOX=44.25,25.80,44.62,26.35
BUCHAREST_KEYWORDS=
INCIDENTS_DRY_RUN=false
```

### `.env.news`

Folosit de serviciul Python pentru stiri:

```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/?appName=<app>
MONGO_DB=test
NEWS_COLLECTION=news

NEWS_POLL_SECONDS=900
NEWS_TIMEOUT_SECONDS=20
NEWS_MAX_ITEMS_PER_SOURCE=1
NEWS_USER_AGENT=NeuralGuardNewsBot/1.0
NEWS_SOURCE_URLS=https://www.nytimes.com/,https://www.digi24.ro/ultimele-stiri,https://www.bbc.com/news,https://hotnews.ro/ultima-ora,https://www.politico.com/
NEWS_KEYWORDS=
NEWS_DRY_RUN=false

NEWS_TRANSLATION_ENABLED=true
NEWS_TRANSLATION_TARGET_LANGS=ro,en
NEWS_TRANSLATION_PROVIDER=argos-translate
NEWS_TRANSLATION_PROVIDER_VERSION=local-v1
NEWS_TRANSLATION_AUTO_INSTALL_MODELS=false
NEWS_TRANSLATION_BACKFILL_LIMIT=50
```

## Pornire automata pe Windows

Varianta recomandata pentru dezvoltare este scriptul:

```powershell
cd "<cale-catre-proiect>"
powershell -ExecutionPolicy Bypass -File .\powershell\start-dev.ps1
```

Scriptul executa urmatoarele operatiuni:

- Detectarea folderului proiectului.
- Pregatirea folderului de modele Ollama.
- Pornirea serviciului Ollama, daca este disponibil.
- Verificarea si descarcarea modelului `qwen3:14b`, daca nu este utilizat parametrul `-SkipOllamaModelPull`.
- Pornirea backend-ului intr-o fereastra separata.
- Pornirea frontend-ului intr-o fereastra separata.
- Verificarea porturilor `5000` si `3000`.
- Deschiderea frontend-ului si a Mongo Explorer.

Optiuni utile:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\start-dev.ps1 -SkipOllamaModelPull
```

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\start-dev.ps1 -FrontendUrl "http://127.0.0.1:3000/"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\start-dev.ps1 -OllamaModel "qwen3:14b" -OllamaModelsDir "<cale-catre-modelele-ollama>"
```

URL-uri locale:

- Frontend: `http://localhost:3000`
- Backend/API: `http://localhost:5000`
- Ollama: `http://127.0.0.1:11434`

## Pornire manuala

Daca scriptul PowerShell nu este utilizat, serviciile se pornesc separat.

Terminal 1, backend:

```powershell
cd "<cale-catre-proiect>\backend"
npm install
npm start
```

Terminal 2, frontend:

```powershell
cd "<cale-catre-proiect>\frontend"
npm install
npm run dev -- --host
```

Terminal 3, Ollama optional:

```powershell
ollama serve
```

Terminal 4, descarcare model AI optional:

```powershell
ollama pull qwen3:14b
```

Dupa pornire, se acceseaza:

```text
http://localhost:3000
```

Backend-ul este disponibil implicit la:

```text
http://localhost:5000
```

## AI local cu Ollama

Copilotul de urgenta utilizeaza Ollama local. Variabile importante:

- `OLLAMA_HOST`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT_MS`
- `EMERGENCY_COPILOT_OLLAMA_HOST`
- `EMERGENCY_COPILOT_OLLAMA_MODEL`
- `EMERGENCY_COPILOT_OLLAMA_TIMEOUT_MS`

Instalarea modelului:

```powershell
ollama pull qwen3:14b
```

Verificarea serviciului Ollama:

```powershell
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
```

In cazul in care Ollama nu ruleaza, aplicatia poate porni, insa functiile AI pot returna erori sau raspunsuri fallback.

## Ingestion incidente

Serviciul Python din `backend/incident_ingestion` colecteaza incidente relevante pentru Bucuresti si face upsert in MongoDB.

Surse implementate:

- `accidenteromania.ro`
- `waze.com/ro/live-map`
- importuri Waze prin `accidenteromania.ro`, ca fallback operational

Pipeline:

```text
fetch -> normalize -> relevance -> classify -> deduplicate -> persist -> stale resolution
```

Instalare:

```powershell
cd "<cale-catre-proiect>\backend"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r incident_ingestion\requirements.txt
```

Dry-run, fara scriere in Mongo:

```powershell
$env:ENV_FILE=".env.incidents"
npm run incidents:sync:dry
```

O singura sincronizare cu scriere in Mongo:

```powershell
$env:ENV_FILE=".env.incidents"
npm run incidents:sync:once
```

Rulare in mod daemon:

```powershell
$env:ENV_FILE=".env.incidents"
npm run incidents:sync:daemon
```

Helper PowerShell din radacina proiectului:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\sync\run-incidents-sync.ps1 -EnvFile .env.incidents -NormalizeExisting
```

## Ingestion stiri

Serviciul Python din `backend/news_ingestion` colecteaza stiri din surse configurabile si face upsert in colectia MongoDB `news`.

Surse default:

- `https://www.nytimes.com/`
- `https://www.digi24.ro/ultimele-stiri`
- `https://www.bbc.com/news`
- `https://hotnews.ro/ultima-ora`
- `https://www.politico.com/`

Instalare:

```powershell
cd "<cale-catre-proiect>\backend"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r news_ingestion\requirements.txt
```

Dry-run:

```powershell
$env:ENV_FILE=".env.news"
npm run news:sync:dry
```

O singura sincronizare:

```powershell
$env:ENV_FILE=".env.news"
npm run news:sync:once
```

Daemon:

```powershell
$env:ENV_FILE=".env.news"
npm run news:sync:daemon
```

Backfill traduceri:

```powershell
$env:ENV_FILE=".env.news"
npm run news:translations:backfill
```

Dry-run backfill:

```powershell
$env:ENV_FILE=".env.news"
npm run news:translations:backfill:dry
```

### Traduceri locale cu Argos

Traducerea este locala/offline prin Argos Translate.

```powershell
argospm update
argospm install translate-en_ro
argospm install translate-ro_en
```

In cazul in care modelele nu sunt disponibile in index, fisierele `.argosmodel` compatibile trebuie descarcate si instalate manual:

```powershell
argospm install path\to\translate-en_ro.argosmodel
argospm install path\to\translate-ro_en.argosmodel
```

Helper PowerShell din radacina proiectului:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\sync\run-news-sync.ps1 -EnvFile .env.news
```

Helper Argos:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\sync\run-news-argos.ps1 -EnvFile .env.news
```

## Task Scheduler

Scripturile din `powershell/tasks` pot fi utilizate pentru instalarea task-urilor Windows care ruleaza periodic sincronizarile.

Instalare task incidente:

```powershell
cd "<cale-catre-proiect>"
powershell -ExecutionPolicy Bypass -File .\powershell\tasks\install\install-incidents-task.ps1 -IntervalMinutes 15 -EnvFile .env.incidents
```

Instalare task stiri:

```powershell
cd "<cale-catre-proiect>"
powershell -ExecutionPolicy Bypass -File .\powershell\tasks\install\install-news-task.ps1 -IntervalMinutes 15 -EnvFile .env.news
```

Instalarea tuturor task-urilor:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\tasks\manage\install-all-tasks.ps1
```

Verificarea statusului:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\tasks\manage\task-status.ps1
```

Stergerea tuturor task-urilor:

```powershell
powershell -ExecutionPolicy Bypass -File .\powershell\tasks\manage\remove-all-tasks.ps1
```

## Teste si verificari

Backend:

```powershell
cd "<cale-catre-proiect>\backend"
npm test
```

Frontend lint:

```powershell
cd "<cale-catre-proiect>\frontend"
npm run lint
```

Frontend build:

```powershell
cd "<cale-catre-proiect>\frontend"
npm run build
```

Frontend preview:

```powershell
cd "<cale-catre-proiect>\frontend"
npm run preview
```

Smoke test mobil:

```powershell
cd "<cale-catre-proiect>\frontend"
npm run test:mobile
```

Verificare rapida API dupa pornire:

```powershell
Invoke-WebRequest http://localhost:5000/api/guides -UseBasicParsing
```

## Endpoint-uri principale

Ghiduri:

- `GET /api/guides`
- `GET /api/guides/files`
- `POST /api/guides/upload`
- `POST /api/guides/subcategory`
- `PATCH /api/guides/remove-pdf`
- `DELETE /api/guides/delete`
- `PATCH /api/guides/rename`
- `PATCH /api/guides/metadata`

Incidente:

- `GET /api/incidents`
- `POST /api/incidents`
- `GET /api/incidents/:incidentId`
- `DELETE /api/incidents/:incidentId`
- `PATCH /api/incidents/:incidentId`
- `POST /api/incidents/:incidentId/tasks`
- `PATCH /api/incidents/:incidentId/tasks/:taskId`
- `POST /api/incidents/:incidentId/assign`
- `POST /api/incidents/:incidentId/guides`

Dashboard:

- `GET /api/dashboard/intelligence`
- `GET /api/dashboard/news`
- `GET /api/dashboard/news/:newsId`
- `GET /api/dashboard/personal-risk`
- `GET /api/dashboard/situation`
- `GET /api/dashboard/overview`

Autentificare si profil:

- `POST /api/signup`
- `POST /api/login`
- `GET /api/me`
- `GET /api/me/inclusion-profile`
- `PUT /api/me/inclusion-profile`
- `DELETE /api/me/inclusion-profile`
- `POST /api/profile-picture`
- `GET /api/me/location`
- `PATCH /api/me/location`
- `GET /api/me/presence`
- `PATCH /api/me/presence`

SOS:

- `POST /api/sos/alert`
- `GET /api/sos/alerts`
- `PATCH /api/sos/alert/:alertId/location`
- `PATCH /api/sos/alert/:alertId/acknowledge`
- `PATCH /api/sos/alert/:alertId/responding`
- `PATCH /api/sos/alert/:alertId/cancel`
- `PATCH /api/sos/alert/:alertId/resolve`

Copilot AI:

- `POST /api/emergency/copilot/sessions`
- `POST /api/emergency/copilot/sessions/:sessionId/messages`
- `GET /api/emergency/copilot/sessions/:sessionId`
- `GET /api/emergency/copilot/meta`
- `POST /api/emergency/copilot/chat`
- `POST /api/emergency/copilot/session`
- `POST /api/emergency/copilot/message`
- `GET /api/emergency/copilot/session/:sessionId`

Altele:

- `GET /api/chat/messages`
- `GET /api/notifications`
- `POST /api/family/alert`

## Pregatire pentru GitHub

Inainte de push trebuie verificate urmatoarele:

- Nu publica fisiere reale `.env`.
- Nu publica parole, token-uri, URI-uri MongoDB cu user/parola sau chei private.
- Nu publica `node_modules`.
- Nu publica `.venv`.
- Nu publica log-uri temporare.
- Nu publica fisiere generate precum `dist`, `build`, `coverage`, `test-results`.
- Fisierele `.env.example` trebuie pastrate doar cu placeholder-e.
- Istoricul Git trebuie verificat daca exista suspiciunea ca un secret a fost deja comis.

Recomandare `.gitignore` la radacina:

```gitignore
node_modules/
frontend/node_modules/
backend/node_modules/

.env
.env.*
!*.env.example
backend/.env
backend/.env.*
frontend/.env
frontend/.env.*

.venv/
backend/.venv/
__pycache__/
*.pyc

dist/
build/
coverage/
test-results/

logs/
*.log

.ollama-models/
.npm-cache/
```

Atentie: daca un secret a ajuns deja intr-un commit, stergerea lui din fisier nu este suficienta. Secretul trebuie rotit in MongoDB sau in serviciul corespunzator, iar istoricul Git trebuie curatat.

Comenzi utile:

```powershell
git status
git diff -- README.MD
git add README.MD
git commit -m "docs: add complete project setup guide"
```

## Troubleshooting

### Portul 3000 sau 5000 este ocupat

Procesul se verifica astfel:

```powershell
netstat -ano | findstr :3000
netstat -ano | findstr :5000
```

Procesul se opreste doar daca exista certitudinea ca apartine proiectului:

```powershell
taskkill /PID <PID> /F
```

### Backend-ul nu se conecteaza la MongoDB

Trebuie verificate urmatoarele:

- `MONGO_URI` este complet si valid.
- `MONGO_DB` este setat corect.
- IP-ul curent este permis in MongoDB Atlas Network Access.
- Userul MongoDB are parola corecta si permisiuni pe baza de date.

### Login-ul nu functioneaza

Trebuie verificate urmatoarele:

- `JWT_SECRET` exista in `backend/.env`.
- Backend-ul a fost repornit dupa schimbarea `.env`.
- Frontend-ul foloseste API-ul corect prin `VITE_API_URL`.

### Frontend-ul nu vede API-ul

Trebuie verificate urmatoarele:

- Backend-ul ruleaza pe `http://localhost:5000`.
- `frontend/.env` contine `VITE_API_URL=http://localhost:5000`.
- Vite proxy este activ in `frontend/vite.config.js`.
- Dupa modificarea `.env`, serverul Vite trebuie repornit prin `npm run dev`.

### Copilotul AI nu raspunde

Trebuie verificate urmatoarele:

```powershell
ollama serve
ollama list
ollama pull qwen3:14b
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
```

### Ingestion-ul nu scrie in MongoDB

Trebuie verificate urmatoarele:

- Rulezi cu `$env:ENV_FILE=".env.incidents"` sau `$env:ENV_FILE=".env.news"`.
- `INCIDENTS_DRY_RUN=false` sau `NEWS_DRY_RUN=false`.
- `MONGO_URI` si `MONGO_DB` sunt corecte.
- Sursele externe sunt accesibile din reteaua curenta.

### Playwright mobile test nu porneste

Browserul necesar se instaleaza astfel:

```powershell
cd "<cale-catre-proiect>\frontend"
npx playwright install webkit
```

## Note pentru dezvoltare

- Backend entrypoint: `backend/src/server.js`
- Frontend entrypoint: `frontend/src/main.jsx`
- Config API frontend: `frontend/src/api/client.js`
- Config Vite/proxy: `frontend/vite.config.js`
- Servicii backend importante: `backend/src/services`
- Modele MongoDB: `backend/models`
- Teste backend: `backend/tests`
- Teste frontend mobile: `frontend/tests`

## Licenta

Momentan, `backend/package.json` foloseste licenta `ISC`. In cazul publicarii proiectului, licenta dorita trebuie confirmata inainte de release.


