@echo off
setlocal
set "DIR=%~dp0"

if defined OTTIE_DAEMON_RESOURCES_DIR (
    if exist "%OTTIE_DAEMON_RESOURCES_DIR%\server.mjs" (
        set "RES=%OTTIE_DAEMON_RESOURCES_DIR%"
        goto :run
    )
)

if exist "%DIR%resources\server.mjs" (
    set "RES=%DIR%resources"
    goto :run
)

if exist "%DIR%..\binaries\resources\server.mjs" (
    set "RES=%DIR%..\binaries\resources"
    goto :run
)

echo ottie-daemon-wrapper: cannot find resources\server.mjs near %DIR% 1>&2
exit /b 1

:run
node "%RES%\server.mjs" %*
