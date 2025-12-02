# RAVE Portable - Server Scripts

This folder contains server helper scripts.

## For End Users

Just run `launch.bat` (Windows) or `./launch.bat` (Mac/Linux) in the parent directory.
The launcher will:
- Use Python if available (all platforms)
- Download and use miniserve if Python is not available (Windows only)

## Files

- `serve.py` - Python HTTP server (cross-platform)
- `download-server.bat` - Downloads miniserve for Windows
- `mongoose.exe` - Miniserve HTTP server (Windows only, auto-downloaded)
- `start-server.bat` - Manual server launcher for Windows

## About Miniserve

Miniserve is a simple, self-contained HTTP server written in Rust.
Source: https://github.com/svenstaro/miniserve
License: MIT
