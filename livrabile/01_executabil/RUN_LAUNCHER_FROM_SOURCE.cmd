@echo off
setlocal

set "PROJECT_ROOT=%~dp0..\.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"

set "DOTNET_CLI_HOME=%PROJECT_ROOT%\.dotnet-cli-home"
if not exist "%DOTNET_CLI_HOME%" mkdir "%DOTNET_CLI_HOME%"

set "LAUNCHER_CSPROJ=%~dp0launcher-src\NeuralGuardLauncher.csproj"

echo [launcher] Running from source:
echo [launcher] %LAUNCHER_CSPROJ%
dotnet run --project "%LAUNCHER_CSPROJ%" -c Release

endlocal
