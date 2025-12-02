:<<BATCH
@echo off
cd /d "%~dp0"
cls
echo ========================================
echo RAVE Portable Launcher
echo ========================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Using Python...
    python --version
    echo.
    python server\serve.py
    goto end
)

REM Check if Python 3 is available
python3 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Using Python3...
    python3 --version
    echo.
    python3 server\serve.py
    goto end
)

REM Python not found, try embedded server
if exist "server\mongoose.exe" (
    echo Python not found. Using embedded server...
    echo.
    start http://localhost:8080
    server\mongoose.exe --port 8080 --index index.html site
    goto end
)

REM Try to download mongoose.exe
if exist "server\download-server.bat" (
    echo Python not found. Downloading embedded server...
    echo.
    cd server
    call download-server.bat
    cd ..
    if exist "server\mongoose.exe" (
        echo.
        echo Starting server...
        start http://localhost:8080
        server\mongoose.exe --port 8080 --index index.html site
        goto end
    )
)

echo Error: Python not found and could not download embedded server.
echo.
echo Please either:
echo   1. Install Python from https://www.python.org/downloads/
echo   2. Or manually download the server from:
echo      https://github.com/svenstaro/miniserve/releases
echo.
pause
exit /b 1

:end
echo.
pause
exit /b 0
BATCH

# Bash script starts here
cd "$(dirname "$0")"

echo "========================================"
echo "RAVE Portable Launcher"
echo "========================================"
echo

if command -v python3 &> /dev/null; then
    echo "Using: $(python3 --version)"
    echo
    python3 server/serve.py
elif command -v python &> /dev/null; then
    echo "Using: $(python --version)"
    echo
    python server/serve.py
else
    echo "Error: Python not found."
    echo "Please install Python 3 from https://www.python.org/downloads/"
    echo
    read -p "Press Enter to exit..."
    exit 1
fi
