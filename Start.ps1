param(
    [switch]$Restart,
    [switch]$NoBrowser,
    [string]$DataDirectory
)
$ErrorActionPreference = 'Stop'
$treeDir = $PSScriptRoot
if (-not $DataDirectory) { $DataDirectory = Join-Path $treeDir '../../work/tree-data' }
$treeData = [System.IO.Path]::GetFullPath($DataDirectory)
$treeState = Join-Path $treeData 'service.json'

# Concurrent double-clicks must share one service, including during startup.
$treeHasher = [System.Security.Cryptography.SHA256]::Create()
$treeHash = [BitConverter]::ToString($treeHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($treeData.ToLowerInvariant()))).Replace('-', '')
$treeHasher.Dispose()
$treeMutex = [Threading.Mutex]::new($false, ('Local\ConversationTree-' + $treeHash))
$treeLocked = $false
try {
    try { $treeLocked = $treeMutex.WaitOne(60000) }
    catch [Threading.AbandonedMutexException] { $treeLocked = $true }
    if (-not $treeLocked) { throw 'Another launch is still starting. Try Start.cmd again shortly.' }

    $saved = $null
    if (Test-Path -LiteralPath $treeState) {
        try { $saved = Get-Content -LiteralPath $treeState -Raw | ConvertFrom-Json } catch { }
    }
    $session = $null
    if ($saved -and $saved.url -match '^http://127\.0\.0\.1:[0-9]+$') {
        try { $session = Invoke-RestMethod -Uri ($saved.url + '/api/session') -TimeoutSec 3 } catch { }
    }
    if ($session -and $session.app -eq 'conversation-tree') {
        if (-not $Restart) {
            if (-not $NoBrowser) { Start-Process $saved.url }
            Write-Host ('Opened existing Conversation Tree: ' + $saved.url)
            return
        }
        Invoke-RestMethod -Method Post -Uri ($saved.url + '/api/shutdown') -Headers @{'X-Tree-Token'=$session.token} -TimeoutSec 5 | Out-Null
        # Wait only for the process identified in the service record.
        $treeOldProcess = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
        if ($treeOldProcess -and -not $treeOldProcess.WaitForExit(10000)) {
            throw 'The previous service has not exited. No duplicate service was started.'
        }
    } elseif ($saved -and $saved.pid) {
        # An unresponsive service must not be duplicated over the same data files.
        $treeExisting = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
        if ($treeExisting -and $treeExisting.ProcessName -eq 'node' -and $saved.startedAt) {
            $treeStartTime = [DateTimeOffset]::new($treeExisting.StartTime).ToUnixTimeMilliseconds()
            if ([Math]::Abs($treeStartTime - [double]$saved.startedAt) -lt 60000) {
                throw 'The existing service is not responding. Check work/tree-data/server-error.log before starting another instance.'
            }
        }
    }
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'D:\Node.js\node.exe' }
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js was not found.' }
    # The repository intentionally excludes node_modules. Bootstrap runtime
    # dependencies on first launch so a clean checkout starts reliably.
    if (-not (Test-Path -LiteralPath (Join-Path $treeDir 'node_modules/ssh2/package.json'))) {
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
        if (-not $npm) { $npm = Join-Path (Split-Path $node) 'npm.cmd' }
        if (-not (Test-Path -LiteralPath $npm)) { throw 'npm was not found. Install Node.js 20+ (which includes npm), then run Start.cmd again.' }
        Write-Host 'Installing required packages (first launch only)...'
        & $npm install --no-audit --no-fund --prefer-offline
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $treeDir 'node_modules/ssh2/package.json'))) {
            throw '依赖安装失败，无法找到 ssh2。请关闭正在运行的 branchat 窗口后重新启动 Start.cmd。'
        }
    }
    New-Item -ItemType Directory -Path $treeData -Force | Out-Null
    $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $treePreviousData = $env:TREE_DATA_DIR
    try {
        $env:TREE_DATA_DIR = $treeData
        $serverScript = Join-Path $treeDir "server.mjs"
        $stdoutLog = Join-Path $treeData "server.log"
        $stderrLog = Join-Path $treeData "server-error.log"
        $proc = Start-Process -FilePath $node -ArgumentList @($serverScript) -WorkingDirectory $treeDir -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    } finally { $env:TREE_DATA_DIR = $treePreviousData }
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { throw ('Service failed. See ' + (Join-Path $treeData 'server-error.log')) }
        if (Test-Path -LiteralPath $treeState) {
            try { $state = Get-Content -LiteralPath $treeState -Raw | ConvertFrom-Json } catch { continue }
            if ($state.startedAt -ge $startedAt -and $state.pid -eq $proc.Id) {
                if (-not $NoBrowser) { Start-Process $state.url }
                Write-Host ('Conversation Tree is ready: ' + $state.url)
                return
            }
        }
    }
    throw 'Service startup timed out. Check work/tree-data/server-error.log.'
} finally {
    if ($treeLocked) { $treeMutex.ReleaseMutex() }
    $treeMutex.Dispose()
}
