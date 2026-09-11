$ErrorActionPreference = 'Stop'
$treeState = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/tree-data/service.json'))
if (-not (Test-Path -LiteralPath $treeState)) { exit 0 }
$state = Get-Content -LiteralPath $treeState -Raw | ConvertFrom-Json
try {
    $session = Invoke-RestMethod -Uri ($state.url + '/api/session') -TimeoutSec 3
    if ($session.app -eq 'conversation-tree') {
        Invoke-RestMethod -Method Post -Uri ($state.url + '/api/shutdown') -Headers @{'X-Tree-Token'=$session.token} | Out-Null
        Write-Host 'Conversation Tree stopped.'
    }
} catch { Write-Host 'Conversation Tree is not running.' }
