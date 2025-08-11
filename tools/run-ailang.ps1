param(
  [Parameter(Mandatory=$true)] [string] $SourcePath,
  [string] $Server = 'http://localhost:8787',
  [string] $OutJson = 'outputs.json',
  [string] $CtxJson = 'context.json'
)

if (-not (Test-Path $SourcePath)) {
  Write-Error "Source file not found: $SourcePath"; exit 1
}

# Ensure server is up
try {
  $health = Invoke-RestMethod -Method GET "$Server/health" -TimeoutSec 3
} catch {
  Write-Host "Starting local server..." -ForegroundColor Yellow
  # Try to start via npm (assumes working directory is repo root)
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -eq $npm) { Write-Error "npm not found"; exit 1 }
  Start-Process -FilePath "npm" -ArgumentList "run","serve" -NoNewWindow
  Start-Sleep -Seconds 2
}

$src = Get-Content -Raw -Path $SourcePath
$body = @{ source = $src } | ConvertTo-Json -Compress

try {
  $resp = Invoke-RestMethod -Method POST "$Server/run" -ContentType "application/json" -Body $body -TimeoutSec 60
} catch {
  Write-Error "Request failed: $($_.Exception.Message)"; exit 1
}

$resp.outputs | ConvertTo-Json -Depth 50 | Out-File -Encoding utf8 $OutJson
$resp.context | ConvertTo-Json -Depth 50 | Out-File -Encoding utf8 $CtxJson

Write-Host "Wrote $OutJson and $CtxJson" -ForegroundColor Green
