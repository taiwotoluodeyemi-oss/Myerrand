# PowerShell script to reset MySQL root password in XAMPP
Write-Host "Resetting MySQL root password for XAMPP..." -ForegroundColor Green

# Stop MySQL service
Write-Host "Stopping MySQL service..." -ForegroundColor Yellow
try {
    Stop-Service -Name "MySQL80" -Force -ErrorAction Stop
    Write-Host "✅ MySQL service stopped" -ForegroundColor Green
} catch {
    Write-Host "❌ Could not stop MySQL service: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Try stopping MySQL from XAMPP Control Panel first" -ForegroundColor Yellow
    exit 1
}

# XAMPP MySQL paths
$mysqlBin = "C:\xampp\mysql\bin"
$mysqlData = "C:\xampp\mysql\data"

# Check if paths exist
if (-not (Test-Path $mysqlBin)) {
    Write-Host "❌ MySQL bin directory not found at $mysqlBin" -ForegroundColor Red
    exit 1
}

# Create password reset script
$resetScript = @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '';
FLUSH PRIVILEGES;
"@

$resetFile = Join-Path $env:TEMP "mysql_reset.sql"
$resetScript | Out-File -FilePath $resetFile -Encoding UTF8

try {
    Write-Host "Starting MySQL in safe mode..." -ForegroundColor Yellow
    
    # Start MySQL with init-file to reset password
    $mysqldPath = Join-Path $mysqlBin "mysqld.exe"
    $process = Start-Process -FilePath $mysqldPath -ArgumentList "--init-file=`"$resetFile`"", "--console" -NoNewWindow -PassThru
    
    # Wait a few seconds for MySQL to process the reset
    Start-Sleep -Seconds 5
    
    # Stop the safe mode MySQL
    $process.Kill()
    
    Write-Host "✅ Password reset completed" -ForegroundColor Green
    
    # Clean up
    Remove-Item $resetFile -Force
    
    # Start MySQL service normally
    Write-Host "Starting MySQL service normally..." -ForegroundColor Yellow
    Start-Service -Name "MySQL80"
    Write-Host "✅ MySQL service started" -ForegroundColor Green
    
    Write-Host "`n🎉 MySQL root password has been reset to empty!" -ForegroundColor Green
    Write-Host "You can now connect using:" -ForegroundColor Green
    Write-Host "  User: root" -ForegroundColor Green
    Write-Host "  Password: (empty)" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Error during password reset: $($_.Exception.Message)" -ForegroundColor Red
    
    # Try to start MySQL service anyway
    try {
        Start-Service -Name "MySQL80"
    } catch {
        Write-Host "❌ Could not start MySQL service" -ForegroundColor Red
    }
}

Write-Host "`nPress any key to continue..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
