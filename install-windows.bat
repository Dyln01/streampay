@echo off
REM StreamPay - Windows Installation Script
REM Run this in Git Bash or any terminal with Node.js installed

echo ============================================
echo  StreamPay Installation - Windows
echo ============================================
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm not found.
    pause
    exit /b 1
)
echo [OK] npm found:
npm --version

echo.
echo --- Installing dependencies ---
npm install

echo.
echo --- Compiling contract ---
npx hardhat compile

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Compilation failed.
    pause
    exit /b 1
)
echo [OK] Contract compiled.

echo.
echo --- Setup complete ---
echo.
echo Next steps:
echo   1. Get testnet MON: https://faucet.monad.xyz
echo   2. Deploy: set PRIVATE_KEY=0xYOUR_KEY && npx hardhat run scripts/deploy-viem.ts --network monadTestnet
echo   3. Frontend: cd frontend && set NEXT_PUBLIC_STREAMPAY_ADDRESS=0xDEPLOYED && npm run dev
echo.
pause
