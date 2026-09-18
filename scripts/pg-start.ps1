# Bring the Bayut TA cluster up if it is not already listening.
#   powershell -ExecutionPolicy Bypass -File scripts/pg-start.ps1
$ErrorActionPreference = 'Stop'
$PGBIN  = 'C:\Program Files\PostgreSQL\16\bin'
$PGDATA = 'D:\pgdata-bayut'
$PORT   = 55441

& "$PGBIN\pg_isready.exe" -h 127.0.0.1 -p $PORT -q
if ($LASTEXITCODE -eq 0) { Write-Output "already up on $PORT"; exit 0 }

Start-Process -FilePath "$PGBIN\pg_ctl.exe" `
  -ArgumentList @('-D', $PGDATA, '-l', "$PGDATA\server.log", 'start') -WindowStyle Hidden
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  & "$PGBIN\pg_isready.exe" -h 127.0.0.1 -p $PORT -q
  if ($LASTEXITCODE -eq 0) { Write-Output "up on $PORT"; exit 0 }
}
Write-Error "cluster did not come up; see $PGDATA\server.log"
exit 1
