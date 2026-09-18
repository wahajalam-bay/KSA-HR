# Stand up a dedicated PostgreSQL 16 cluster for the Bayut TA platform.
#
# The machine already runs PostgreSQL on 5432 as a Windows service whose
# superuser password is not known here, and 55432 belongs to another project.
# So this creates a cluster of our own on 55441 with a password we set.
#
#   powershell -ExecutionPolicy Bypass -File scripts/pg-init.ps1
#
$ErrorActionPreference = 'Stop'

$PGBIN   = 'C:\Program Files\PostgreSQL\16\bin'
$PGDATA  = 'D:\pgdata-bayut'
$PORT    = 55441
$SUPER   = 'bayut_admin'
$SUPERPW = 'bayut_local_dev_pw'
$APPUSER = 'bayut_ta'
$APPPW   = 'bayut_local_dev_pw'
$DBNAME  = 'bayut_ta'

if (-not (Test-Path "$PGBIN\initdb.exe")) { throw "PostgreSQL 16 binaries not found at $PGBIN" }

if (-not (Test-Path "$PGDATA\PG_VERSION")) {
  Write-Output "initdb -> $PGDATA"
  New-Item -ItemType Directory -Force -Path $PGDATA | Out-Null
  $pwfile = Join-Path $env:TEMP 'bayut_pgpw.txt'
  Set-Content -Path $pwfile -Value $SUPERPW -NoNewline -Encoding ascii
  & "$PGBIN\initdb.exe" -D $PGDATA -U $SUPER --pwfile=$pwfile -E UTF8 --locale=C --auth-local=scram-sha-256 --auth-host=scram-sha-256 | Out-Null
  Remove-Item $pwfile -Force
  # listen only on loopback, on our own port
  Add-Content -Path "$PGDATA\postgresql.conf" -Value @"

# --- Bayut TA platform cluster ---
port = $PORT
listen_addresses = '127.0.0.1'
max_connections = 120
shared_buffers = 256MB
work_mem = 16MB
log_min_duration_statement = 500
log_line_prefix = '%m [%p] %u@%d '
"@
} else {
  Write-Output "cluster already present at $PGDATA"
}

# Start detached: a foreground pg_ctl is killed by the tool timeout.
$running = $false
try {
  & "$PGBIN\pg_isready.exe" -h 127.0.0.1 -p $PORT -q
  if ($LASTEXITCODE -eq 0) { $running = $true }
} catch { $running = $false }

if (-not $running) {
  Write-Output "starting cluster on $PORT"
  # Fire and forget: pg_ctl stays attached to the postmaster, so -Wait would
  # block this script for the life of the server. The port is in
  # postgresql.conf, so no -o is needed.
  Start-Process -FilePath "$PGBIN\pg_ctl.exe" `
    -ArgumentList @('-D', $PGDATA, '-l', "$PGDATA\server.log", 'start') `
    -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    & "$PGBIN\pg_isready.exe" -h 127.0.0.1 -p $PORT -q
    if ($LASTEXITCODE -eq 0) { $running = $true; break }
  }
}
if (-not $running) { throw "cluster did not come up; see $PGDATA\server.log" }
Write-Output "cluster is up on $PORT"

$env:PGPASSWORD = $SUPERPW
$psql = "$PGBIN\psql.exe"

# application role and database, created idempotently
$sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APPUSER') THEN
    CREATE ROLE $APPUSER LOGIN PASSWORD '$APPPW';
  END IF;
END `$`$;
"@
$sql | & $psql -h 127.0.0.1 -p $PORT -U $SUPER -d postgres -v ON_ERROR_STOP=1 -q

$exists = & $psql -h 127.0.0.1 -p $PORT -U $SUPER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'"
if (-not $exists) {
  & $psql -h 127.0.0.1 -p $PORT -U $SUPER -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DBNAME OWNER $APPUSER ENCODING 'UTF8'"
  Write-Output "created database $DBNAME"
}

# extensions the schema needs
& $psql -h 127.0.0.1 -p $PORT -U $SUPER -d $DBNAME -v ON_ERROR_STOP=1 -q -c @"
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS unaccent;
GRANT ALL ON SCHEMA public TO $APPUSER;
"@

Write-Output ""
Write-Output "DATABASE_URL=postgresql://${APPUSER}:${APPPW}@127.0.0.1:${PORT}/${DBNAME}"
