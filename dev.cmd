@echo off
rem Installs dependencies (first run), typechecks, then launches Waypoint in dev mode.
rem Output of install + typecheck is written to setup.log.
cd /d "%~dp0"
echo ==== %date% %time% ==== > setup.log
where node >> setup.log 2>&1
node -v >> setup.log 2>&1
if not exist node_modules (
  echo Installing dependencies, this takes a minute...
  call npm install >> setup.log 2>&1
)
echo ---- typecheck ---- >> setup.log
call npm run typecheck >> setup.log 2>&1
echo ---- launching ---- >> setup.log
call npm run dev >> dev.log 2>&1
