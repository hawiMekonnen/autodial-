@echo off
title SkyKin Automatic Dialer Server
echo ====================================================
echo   SkyKin Automatic Dialer Extension
echo   URL: http://127.0.0.1:8080 or http://localhost:8080
echo ====================================================
echo.
echo Starting PHP server on 0.0.0.0:8080...
echo Keep this window OPEN while using the dialer.
echo.
C:\php\php.exe -S 0.0.0.0:8080 -t "%~dp0"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server stopped or encountered an error.
    pause
)
