# PowerShell script to set up the database using XAMPP's MySQL
# Make sure XAMPP is running before executing this script

Write-Host "Setting up database..." -ForegroundColor Green

# XAMPP MySQL path (adjust if your XAMPP is in a different location)
$mysqlPath = "C:\xampp\mysql\bin\mysql.exe"

# Check if MySQL executable exists
if (-not (Test-Path $mysqlPath)) {
    Write-Host "Error: MySQL not found at $mysqlPath" -ForegroundColor Red
    Write-Host "Please make sure XAMPP is installed and adjust the path in this script." -ForegroundColor Yellow
    Write-Host "Common XAMPP locations:" -ForegroundColor Yellow
    Write-Host "  - C:\xampp\mysql\bin\mysql.exe" -ForegroundColor Yellow
    Write-Host "  - C:\Program Files\XAMPP\mysql\bin\mysql.exe" -ForegroundColor Yellow
    exit 1
}

# Schema file path
$schemaFile = Join-Path $PSScriptRoot "database\schema.sql"

# Check if schema file exists
if (-not (Test-Path $schemaFile)) {
    Write-Host "Error: Schema file not found at $schemaFile" -ForegroundColor Red
    exit 1
}

try {
    Write-Host "Running database schema..." -ForegroundColor Yellow
    
    # Run the schema file using MySQL
    & $mysqlPath -u root -e "source $schemaFile"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Database schema executed successfully!" -ForegroundColor Green
        Write-Host "✅ Database 'errandsplace' created" -ForegroundColor Green
        Write-Host "✅ All tables created including wallets" -ForegroundColor Green
        Write-Host "✅ Sample data inserted" -ForegroundColor Green
    } else {
        Write-Host "❌ Error executing database schema" -ForegroundColor Red
    }
}
catch {
    Write-Host "❌ Error running MySQL command: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Make sure XAMPP MySQL is running (start it from XAMPP Control Panel)" -ForegroundColor Yellow
}

Write-Host "`nPress any key to continue..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
