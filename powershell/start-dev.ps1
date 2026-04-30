param(
    [string]$FrontendUrl = "",
    [string]$MongoExplorerUrl = "https://cloud.mongodb.com/v2/695ba98145800142cceedd80#/explorer/695ba9b9259c243c279d318d/test/users/find",
    [string]$BackendCmd = "npm.cmd start",
    [string]$FrontendCmd = "npm.cmd run dev -- --host",
    [string]$OllamaCmd = "ollama serve",
    [string]$OllamaModel = "qwen3:14b",
    [string]$OllamaModelsDir = "",
    [switch]$SkipOllamaModelPull
)

function Write-Step {
    param([string]$Message)
    Write-Host "[start-dev] $Message"
}

function Test-CommandAvailable {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Wait-OllamaReady {
    param(
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
            return $true
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }

    return $false
}

function Wait-TcpReady {
    param(
        [string]$Address = "127.0.0.1",
        [int]$Port,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect($Address, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(1000, $false) -and $client.Connected) {
                $client.EndConnect($async)
                $client.Close()
                return $true
            }

            $client.Close()
        } catch {
        }

        Start-Sleep -Milliseconds 700
    }

    return $false
}

function Open-Target {
    param(
        [string]$Target,
        [string]$Label
    )

    try {
        Start-Process $Target | Out-Null
        Write-Step "Am deschis $Label"
    } catch {
        Write-Warning "Nu am putut deschide $Label ($Target): $($_.Exception.Message)"
    }
}

function Resolve-FrontendUrl {
    param(
        [string]$PreferredUrl
    )

    if (-not [string]::IsNullOrWhiteSpace($PreferredUrl)) {
        return $PreferredUrl
    }

    $ipv4Candidates = @()
    try {
        $ipv4Candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -ne "127.0.0.1" -and
                -not $_.IPAddress.StartsWith("169.254.") -and
                $_.PrefixOrigin -ne "WellKnown"
            } |
            Select-Object -ExpandProperty IPAddress
    } catch {
        try {
            $ipv4Candidates = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                Where-Object {
                    $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
                    $_.IPAddressToString -ne "127.0.0.1" -and
                    -not $_.IPAddressToString.StartsWith("169.254.")
                } |
                Select-Object -ExpandProperty IPAddressToString
        } catch {
            $ipv4Candidates = @()
        }
    }

    $resolvedIp = $ipv4Candidates | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($resolvedIp)) {
        $resolvedIp = "127.0.0.1"
    }

    return "http://${resolvedIp}:3000/"
}

function Start-PowerShellWindow {
    param(
        [string]$WorkingDirectory,
        [string]$Command,
        [string]$WindowLabel
    )

    $bootstrap = @"
`$Host.UI.RawUI.WindowTitle = '$WindowLabel'
Set-Location -LiteralPath '$WorkingDirectory'
Write-Host '[start-dev] $WindowLabel'
$Command
"@

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
    return Start-Process -FilePath $PSHOME\powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded -PassThru
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backend = Join-Path $projectRoot "backend"
$frontend = Join-Path $projectRoot "frontend"
$projectOllamaModelsDir = Join-Path $projectRoot ".ollama-models"
$resolvedFrontendUrl = Resolve-FrontendUrl -PreferredUrl $FrontendUrl

if (-not (Test-Path $backend)) {
    Write-Error "Nu gasesc folderul backend: $backend"
    exit 1
}

if (-not (Test-Path $frontend)) {
    Write-Error "Nu gasesc folderul frontend: $frontend"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OllamaModelsDir)) {
    if (Test-Path "D:\") {
        $resolvedOllamaModelsDir = "D:\Ollama"
    } else {
        $resolvedOllamaModelsDir = $projectOllamaModelsDir
    }
} else {
    $resolvedOllamaModelsDir = $OllamaModelsDir
}

if (-not (Test-Path $resolvedOllamaModelsDir)) {
    New-Item -ItemType Directory -Path $resolvedOllamaModelsDir | Out-Null
}

$env:OLLAMA_MODELS = $resolvedOllamaModelsDir
$ollamaAvailable = Test-CommandAvailable "ollama"
$npmAvailable = Test-CommandAvailable "npm"
$backendShellCmd = "`$env:OLLAMA_MODEL='$OllamaModel'; `$env:EMERGENCY_COPILOT_OLLAMA_MODEL='$OllamaModel'; `$env:OLLAMA_MODELS='$resolvedOllamaModelsDir'; $BackendCmd"
$ollamaShellCmd = "`$env:OLLAMA_MODELS='$resolvedOllamaModelsDir'; $OllamaCmd"

Write-Step "Project root: $projectRoot"
Write-Step "Ollama model: $OllamaModel"
Write-Step "Ollama models dir: $resolvedOllamaModelsDir"
Write-Step "Frontend URL public: $resolvedFrontendUrl"

if (-not $npmAvailable) {
    Write-Warning "Comanda 'npm' nu este disponibila in PATH. Backend-ul si frontend-ul nu vor porni corect fara Node.js/NPM."
}

if ($ollamaAvailable) {
    try {
        if (Wait-OllamaReady -TimeoutSeconds 2) {
            Write-Step "Ollama ruleaza deja pe http://127.0.0.1:11434"
        } else {
            Write-Step "Pornesc Ollama..."
            $null = Start-PowerShellWindow -WorkingDirectory $projectRoot -Command $ollamaShellCmd -WindowLabel "Ollama - start-dev"
        }

        if (Wait-OllamaReady -TimeoutSeconds 20) {
            Write-Step "Ollama raspunde pe http://127.0.0.1:11434"
        } else {
            Write-Warning "Ollama nu a raspuns in timpul asteptat. Continui, dar primul pull sau primul request AI poate esua."
        }

        if (-not $SkipOllamaModelPull) {
            $modelPresent = $null -ne (& ollama list | Select-String -Pattern ("^\s*" + [regex]::Escape($OllamaModel) + "\b"))
            if (-not $modelPresent) {
                Write-Step "Modelul '$OllamaModel' nu este local. Rulez 'ollama pull $OllamaModel'..."
                & ollama pull $OllamaModel
            } else {
                Write-Step "Modelul '$OllamaModel' este deja instalat."
            }
        } else {
            Write-Step "Ai cerut SkipOllamaModelPull, sar peste verificarea/download-ul modelului."
        }
    } catch {
        Write-Warning "Nu am putut porni sau pregati Ollama automat: $($_.Exception.Message)"
    }
} else {
    Write-Warning "Comanda 'ollama' nu este disponibila. Instaleaza Ollama ca sa functioneze AI-ul cu modelul $OllamaModel."
}

# Pornire backend
Write-Step "Pornesc backend-ul..."
$null = Start-PowerShellWindow -WorkingDirectory $backend -Command $backendShellCmd -WindowLabel "Backend - start-dev"

if (Wait-TcpReady -Port 5000 -TimeoutSeconds 20) {
    Write-Step "Backend-ul raspunde local pe http://127.0.0.1:5000"
} else {
    Write-Warning "Backend-ul nu a pornit pe portul 5000 in timpul asteptat. Verifica fereastra 'Backend - start-dev' pentru erori."
}

# Pornire frontend
Write-Step "Pornesc frontend-ul..."
$null = Start-PowerShellWindow -WorkingDirectory $frontend -Command $FrontendCmd -WindowLabel "Frontend - start-dev"

if (Wait-TcpReady -Port 3000 -TimeoutSeconds 20) {
    Write-Step "Frontend-ul raspunde local pe http://127.0.0.1:3000"
    Write-Step "Frontend-ul pentru browser/dispozitive este $resolvedFrontendUrl"
} else {
    Write-Warning "Frontend-ul nu a pornit pe portul 3000 in timpul asteptat. Verifica fereastra 'Frontend - start-dev' pentru erori."
}

# Pauza scurta inainte sa deschid URL-urile
Write-Step "Astept cateva secunde inainte sa deschid URL-urile..."
Start-Sleep -Seconds 3

# Deschide frontend si Mongo Explorer
Write-Step "Deschid frontend-ul si Mongo Explorer..."
Open-Target -Target $resolvedFrontendUrl -Label "frontend-ul"

if (Get-Command "chrome.exe" -ErrorAction SilentlyContinue) {
    try {
        Start-Process "chrome.exe" $MongoExplorerUrl | Out-Null
        Write-Step "Am deschis Mongo Explorer in Chrome"
    } catch {
        Write-Warning "Nu am putut deschide Mongo Explorer in Chrome: $($_.Exception.Message)"
    }
} else {
    Open-Target -Target $MongoExplorerUrl -Label "Mongo Explorer-ul"
}
