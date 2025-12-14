@echo off
REM Test script for Windows Registry-based R detection
REM Mirrors the logic in installer-windows.yml
REM
REM Usage: test-registry-detection.bat

echo ============================================================
echo Windows Registry R Detection Test
echo ============================================================
echo.

setlocal enabledelayedexpansion

REM Check RSTUDIO_WHICH_R environment variable first
echo [1] Checking RSTUDIO_WHICH_R environment variable...
if defined RSTUDIO_WHICH_R (
  if exist "%RSTUDIO_WHICH_R%" (
    echo    Found: %RSTUDIO_WHICH_R%
    echo    Status: VALID
    goto :success
  ) else (
    echo    Defined but path does not exist
  )
) else (
  echo    Not defined
)
echo.

REM Check registry for R installations
echo [2] Checking Windows Registry...
echo    Priority: HKCU\R, HKCU\R64, HKLM\R, HKLM\R64
echo.

set FOUND=0

for %%K in (HKCU HKLM) do (
  for %%V in (R R64) do (
    echo    Querying: %%K\Software\R-core\%%V
    for /f "tokens=2*" %%a in ('reg query "%%K\Software\R-core\%%V" /s /v InstallPath 2^>nul ^| findstr "InstallPath"') do (
      set "RPATH=%%b"
      echo       InstallPath: !RPATH!
      
      if exist "!RPATH!\bin\x64\R.exe" (
        echo       Found: !RPATH!\bin\x64\R.exe
        echo       Status: VALID
        set FOUND=1
        goto :success
      )
      if exist "!RPATH!\bin\R.exe" (
        echo       Found: !RPATH!\bin\R.exe
        echo       Status: VALID
        set FOUND=1
        goto :success
      )
      if exist "!RPATH!\bin\i386\R.exe" (
        echo       Found: !RPATH!\bin\i386\R.exe
        echo       Status: VALID
        set FOUND=1
        goto :success
      )
      echo       Status: Path exists in registry but R.exe not found
    )
  )
)

if %FOUND%==0 (
  echo    No R installations found in registry
  echo.
)

REM Check common installation locations as fallback
echo [3] Checking common installation directories...
for %%D in ("%LOCALAPPDATA%\Programs\R" "%ProgramFiles%\R" "C:\R" "%ProgramFiles(x86)%\R") do (
  echo    Checking: %%~D
  if exist "%%~D" (
    for /f "tokens=*" %%R in ('dir /b /ad /o-n "%%~D\R-*" 2^>nul') do (
      if exist "%%~D\%%R\bin\x64\R.exe" (
        echo       Found: %%~D\%%R\bin\x64\R.exe
        echo       Status: VALID
        goto :success
      )
      if exist "%%~D\%%R\bin\R.exe" (
        echo       Found: %%~D\%%R\bin\R.exe
        echo       Status: VALID
        goto :success
      )
    )
  ) else (
    echo       Directory does not exist
  )
)

:notfound
echo.
echo ============================================================
echo X Test Result: R NOT DETECTED
echo ============================================================
exit /b 1

:success
echo.
echo ============================================================
echo √ Test Result: R DETECTED SUCCESSFULLY
echo ============================================================
exit /b 0
