#' Post-process RAVE Portable build
#' @author Zhengjia Wang
#' @date Dec 02, 2025
#' @details
#' This script creates cross-platform launcher scripts:
#' - server/serve.py: Python HTTP server (hidden in server folder)
#' - launch: Polyglot script (works as both .bat and .sh)
#' - server/mongoose.exe: Embedded server for Windows users without Python
NULL

message("Creating launcher scripts for RAVE Portable...")

# ---- 1. Python HTTP Server ----
message("\n[1/3] Creating server/serve.py...")
writeLines(c(
  "#!/usr/bin/env python3",
  "import http.server",
  "import socketserver",
  "import webbrowser",
  "import os",
  "import sys",
  "",
  "PORT = 8080",
  "script_dir = os.path.dirname(os.path.abspath(__file__))",
  "site_dir = os.path.join(os.path.dirname(script_dir), 'site')",
  "",
  "if not os.path.exists(site_dir):",
  "    print(f'Error: {site_dir} not found!')",
  "    print('Please run compile.r first to build the site.')",
  "    sys.exit(1)",
  "",
  "os.chdir(site_dir)",
  "Handler = http.server.SimpleHTTPRequestHandler",
  "",
  "print('=' * 60)",
  "print('RAVE Portable Server')",
  "print('=' * 60)",
  "print(f'Server running at http://localhost:{PORT}')",
  "print('Press Ctrl+C to stop.')",
  "print('=' * 60)",
  "print()",
  "",
  "with socketserver.TCPServer(('', PORT), Handler) as httpd:",
  "    webbrowser.open(f'http://localhost:{PORT}')",
  "    try:",
  "        httpd.serve_forever()",
  "    except KeyboardInterrupt:",
  "        print('\\nShutting down server...')",
  "        print('Goodbye!')"
), "server/serve.py")

Sys.chmod("server/serve.py", mode = "0755")
message("  ✓ Created server/serve.py")

# ---- 2. Polyglot Launcher (works as both .bat and .sh) ----
message("\n[2/3] Creating polyglot launch script...")
writeLines(c(
  ":<<BATCH",
  "@echo off",
  "cd /d \"%~dp0\"",
  "cls",
  "echo ========================================",
  "echo RAVE Portable Launcher",
  "echo ========================================",
  "echo.",
  "",
  "REM Check if Python is available",
  "python --version >nul 2>&1",
  "if %errorlevel% equ 0 (",
  "    echo Using Python...",
  "    python --version",
  "    echo.",
  "    python server\\serve.py",
  "    goto end",
  ")",
  "",
  "REM Check if Python 3 is available",
  "python3 --version >nul 2>&1",
  "if %errorlevel% equ 0 (",
  "    echo Using Python3...",
  "    python3 --version",
  "    echo.",
  "    python3 server\\serve.py",
  "    goto end",
  ")",
  "",
  "REM Python not found, try embedded server",
  "if exist \"server\\mongoose.exe\" (",
  "    echo Python not found. Using embedded server...",
  "    echo.",
  "    start http://localhost:8080",
  "    server\\mongoose.exe --port 8080 --index index.html site",
  "    goto end",
  ")",
  "",
  "REM Try to download mongoose.exe",
  "if exist \"server\\download-server.bat\" (",
  "    echo Python not found. Downloading embedded server...",
  "    echo.",
  "    cd server",
  "    call download-server.bat",
  "    cd ..",
  "    if exist \"server\\mongoose.exe\" (",
  "        echo.",
  "        echo Starting server...",
  "        start http://localhost:8080",
  "        server\\mongoose.exe --port 8080 --index index.html site",
  "        goto end",
  "    )",
  ")",
  "",
  "echo Error: Python not found and could not download embedded server.",
  "echo.",
  "echo Please either:",
  "echo   1. Install Python from https://www.python.org/downloads/",
  "echo   2. Or manually download the server from:",
  "echo      https://github.com/svenstaro/miniserve/releases",
  "echo.",
  "pause",
  "exit /b 1",
  "",
  ":end",
  "echo.",
  "pause",
  "exit /b 0",
  "BATCH",
  "",
  "# Bash script starts here",
  "cd \"$(dirname \"$0\")\"",
  "",
  "echo \"========================================\"",
  "echo \"RAVE Portable Launcher\"",
  "echo \"========================================\"",
  "echo",
  "",
  "if command -v python3 &> /dev/null; then",
  "    echo \"Using: $(python3 --version)\"",
  "    echo",
  "    python3 server/serve.py",
  "elif command -v python &> /dev/null; then",
  "    echo \"Using: $(python --version)\"",
  "    echo",
  "    python server/serve.py",
  "else",
  "    echo \"Error: Python not found.\"",
  "    echo \"Please install Python 3 from https://www.python.org/downloads/\"",
  "    echo",
  "    read -p \"Press Enter to exit...\"",
  "    exit 1",
  "fi"
), "launch.bat")

Sys.chmod("launch.bat", mode = "0711")
message("  ✓ Created polyglot launch.bat (works on Windows/Mac/Linux)")

# ---- 3. Create Server Helper Scripts ----
message("\n[3/3] Creating server helper scripts...")

dir.create("server", showWarnings = FALSE)

# Create download script for Windows users (will be called by launch.bat)
writeLines(c(
  "@echo off",
  "echo Downloading miniserve server...",
  "echo.",
  "powershell -Command \"& {Invoke-WebRequest -Uri 'https://github.com/svenstaro/miniserve/releases/download/v0.24.0/miniserve-0.24.0-x86_64-pc-windows-msvc.exe' -OutFile 'mongoose.exe'}\"",
  "if exist mongoose.exe (",
  "    echo Download complete!",
  "    exit /b 0",
  ") else (",
  "    echo Download failed!",
  "    exit /b 1",
  ")"
), "server/download-server.bat")

message("  ✓ Created download-server.bat")

# Create start script for miniserve
writeLines(c(
  "@echo off",
  "cd /d \"%~dp0\"",
  "start http://localhost:8080",
  "mongoose.exe --port 8080 --dir ../site --index index.html"
), "server/start-server.bat")

message("  ✓ Created start-server.bat")

# Create a README for the server folder
writeLines(c(
  "# RAVE Portable - Server Scripts",
  "",
  "This folder contains server helper scripts.",
  "",
  "## For End Users",
  "",
  "Just run `launch.bat` (Windows) or `./launch.bat` (Mac/Linux) in the parent directory.",
  "The launcher will:",
  "- Use Python if available (all platforms)",
  "- Download and use miniserve if Python is not available (Windows only)",
  "",
  "## Files",
  "",
  "- `serve.py` - Python HTTP server (cross-platform)",
  "- `download-server.bat` - Downloads miniserve for Windows",
  "- `mongoose.exe` - Miniserve HTTP server (Windows only, auto-downloaded)",
  "- `start-server.bat` - Manual server launcher for Windows",
  "",
  "## About Miniserve",
  "",
  "Miniserve is a simple, self-contained HTTP server written in Rust.",
  "Source: https://github.com/svenstaro/miniserve",
  "License: MIT"
), "server/README.md")

message("  ✓ Created server/README.md")

# ---- Summary ----
message("\n", paste(rep("=", 60), collapse = ""))
message("Launcher scripts created successfully!")
message(paste(rep("=", 60), collapse = ""))
message("\nUsage:")
message("  • Windows:    Double-click launch.bat")
message("  • Mac/Linux:  Run ./launch.bat (or rename to launch.sh if preferred)")
message("\nFiles created:")
message("  • launch.bat              - Polyglot launcher (works on all platforms)")
message("  • server/serve.py         - Python HTTP server")
message("  • server/download-server.bat - Auto-downloads server for Windows")
message("  • server/start-server.bat - Manual server launcher")
message("  • server/README.md        - Server documentation")

message("\nℹ On Windows, launch.bat will auto-download miniserve if Python is not available.")

message("\nNext steps:")
message("  1. Run compile.r to build your site")
message("  2. Use the appropriate launcher for your platform")
message(paste(rep("=", 60), collapse = ""))
