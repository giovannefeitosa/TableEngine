param (
    [string]$DbHost = "localhost",
    [string]$DbPort = "5432",
    [string]$DbUser = "postgres",
    [string]$DbPassword = "postgres",
    [string]$DbName = "table_engine",
    [string]$OutputFile = "$PSScriptRoot\table_engine_backup.sql",
    [string]$PgDumpPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " TableEngine - Database Backup Utility    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Locate pg_dump executable
if (-not $PgDumpPath) {
    $localPgDump = Join-Path $PSScriptRoot "..\.pgsql\pgsql\bin\pg_dump.exe"
    if (Test-Path $localPgDump) {
        $PgDumpPath = (Resolve-Path $localPgDump).Path
    } elseif (Get-Command pg_dump -ErrorAction SilentlyContinue) {
        $PgDumpPath = (Get-Command pg_dump).Source
    } else {
        Write-Error "Could not locate 'pg_dump.exe'. Please specify -PgDumpPath or ensure PostgreSQL is in PATH or .pgsql folder."
        exit 1
    }
}

Write-Host "Backing up database '$DbName' from ${DbHost}:${DbPort} as user '$DbUser'..." -ForegroundColor Yellow
Write-Host "Using pg_dump: $PgDumpPath" -ForegroundColor Gray
Write-Host "Target file: $OutputFile" -ForegroundColor Gray

# 2. Execute pg_dump
$env:PGPASSWORD = $DbPassword
& $PgDumpPath -h $DbHost -p $DbPort -U $DbUser -d $DbName --clean --if-exists --no-owner --no-privileges -f $OutputFile

if ($LASTEXITCODE -eq 0) {
    $fileItem = Get-Item $OutputFile
    $sizeKb = [math]::Round($fileItem.Length / 1KB, 2)
    Write-Host "`n[SUCCESS] Backup saved successfully ($sizeKb KB): $OutputFile" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Backup failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
