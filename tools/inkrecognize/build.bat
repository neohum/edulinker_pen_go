@echo off
REM Build the self-contained single-file inkrecognize.exe helper.
REM Output: bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\inkrecognize.exe
REM Requires: .NET 8 SDK (https://dotnet.microsoft.com/download/dotnet/8.0)

setlocal
cd /d "%~dp0"

dotnet publish -c Release
if errorlevel 1 (
    echo.
    echo Build failed. Make sure .NET 8 SDK is installed and on PATH.
    exit /b 1
)

echo.
echo Built: %CD%\bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\inkrecognize.exe
endlocal
