@echo off
rem Double-click this file on Windows to start the tracker and open it in your browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org & start https://nodejs.org/en/download & pause & exit /b 1)
start "" http://localhost:3000
echo Transport tracker is running at http://localhost:3000 . Keep this window open while you use it.
node server.js
