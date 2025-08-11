# PowerShell helper to call /assist on the AILang server
param(
  [string]$Server = "http://localhost:8789",
  [Parameter(Mandatory=$true)][string]$Prompt,
  [object]$UserInput = $null,
  [ValidateSet('plan','run','compile')][string]$Mode = 'plan'
)

$body = @{ prompt = $Prompt; mode = $Mode } | ConvertTo-Json -Depth 10
if ($PSBoundParameters.ContainsKey('UserInput')) {
  $bodyObj = @{ prompt = $Prompt; mode = $Mode; input = $UserInput }
  $body = $bodyObj | ConvertTo-Json -Depth 10
}

try {
  $resp = Invoke-RestMethod -Method POST -Uri "$Server/assist" -ContentType 'application/json' -Body $body
  $resp | ConvertTo-Json -Depth 10
} catch {
  Write-Error $_
  exit 1
}
