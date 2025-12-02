@echo off
echo Downloading miniserve server...
echo.
powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/svenstaro/miniserve/releases/download/v0.24.0/miniserve-0.24.0-x86_64-pc-windows-msvc.exe' -OutFile 'mongoose.exe'}"
if exist mongoose.exe (
    echo Download complete!
    exit /b 0
) else (
    echo Download failed!
    exit /b 1
)
