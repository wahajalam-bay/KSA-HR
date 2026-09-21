<#
  Free the port the application listens on.

  `next dev` and `next start` both spawn a child that holds the socket, and
  killing the npm wrapper leaves that child listening. A half-dead server on the
  port is worse than none: the next `npm run start` fails with EADDRINUSE and
  quietly leaves the old one answering, so anything measured afterwards is
  measuring the wrong server against a rebuilt .next.

  This kills whatever owns the port, children first, and does not return until
  the port is actually free.

    powershell -File scripts/port.ps1          # free 3400
    powershell -File scripts/port.ps1 -Port 3001
#>
param([int]$Port = 3400)

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $owners = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess |
    Select-Object -Unique
  if (-not $owners) { Write-Output "port $Port free"; exit 0 }
  foreach ($id in $owners) {
    taskkill /PID $id /T /F 2>$null | Out-Null
  }
  Start-Sleep -Milliseconds 400
}

Write-Error "port $Port is still held after 15s"
exit 1
