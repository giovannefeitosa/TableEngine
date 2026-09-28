param (
    [string]$DbHost = "localhost",
    [string]$DbPort = "5432",
    [string]$DbUser = "postgres",
    [string]$DbPassword = "postgres",
    [string]$DbName = "table_engine",
    [string]$BackupFile = "$PSScriptRoot\table_engine_backup.sql",
    [string]$PsqlPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " TableEngine - Database Restore Utility   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Resolve backup file
if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found at: $BackupFile"
    exit 1
}

# 2. Locate psql executable
if (-not $PsqlPath) {
    $localPsql = Join-Path $PSScriptRoot "..\.pgsql\pgsql\bin\psql.exe"
    if (Test-Path $localPsql) {
        $PsqlPath = (Resolve-Path $localPsql).Path
    } elseif (Get-Command psql -ErrorAction SilentlyContinue) {
        $PsqlPath = (Get-Command psql).Source
    } else {
        Write-Error "Could not locate 'psql.exe'. Please specify -PsqlPath or ensure PostgreSQL is in PATH or .pgsql folder."
        exit 1
    }
}

Write-Host "Restoring database '$DbName' on ${DbHost}:${DbPort} as user '$DbUser'..." -ForegroundColor Yellow
Write-Host "Using psql: $PsqlPath" -ForegroundColor Gray
Write-Host "Source file: $BackupFile" -ForegroundColor Gray

# 3. Execute restore
$env:PGPASSWORD = $DbPassword
& $PsqlPath -h $DbHost -p $DbPort -U $DbUser -d $DbName -f $BackupFile -v ON_ERROR_STOP=1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[SUCCESS] Database '$DbName' restored successfully!" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Database restore failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
