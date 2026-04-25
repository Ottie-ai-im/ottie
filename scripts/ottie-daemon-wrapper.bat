@echo off
setlocal
set "DIR=%~dp0"
node "%DIR%resources\server.mjs" %*
