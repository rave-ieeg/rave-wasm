@echo off
cd /d "%~dp0"
start http://localhost:8080
mongoose.exe --port 8080 --dir ../site --index index.html
