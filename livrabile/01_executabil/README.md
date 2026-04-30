# Executabil aplicatie

Launcherul porneste aplicatia prin scriptul `powershell/start-dev.ps1`.

## Varianta recomandata (noua)

Ruleaza:

- `RUN_LAUNCHER_FROM_SOURCE.cmd`

Acest fisier executa automat:

- `dotnet run --project launcher-src/NeuralGuardLauncher.csproj -c Release`

si porneste acelasi flux backend/frontend.

## Varianta alternativa

Daca vrei rulare directa, poti folosi:

- `NeuralGuardLauncher/NeuralGuardLauncher.exe`

Pe unele sisteme, `.exe` poate fi blocat de politici locale, caz in care folosesti varianta recomandata de mai sus.

## Cerinte minime

- Windows
- Node.js + npm instalate
- Dependintele proiectului instalate (`npm install` in radacina, plus cele necesare in `backend`/`frontend`)
- Ollama instalat (optional, pentru functionalitatile AI)

## Nota

Launcherul este varianta rapida de livrare pentru o aplicatie web (one-click start pentru mediul local de evaluare).
