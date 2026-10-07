@echo off
REM StreamPay - Windows One-Click Install Script
REM Run as Administrator: install-stream.bat

echo ========================================
echo   StreamPay - Windows Setup
echo ========================================
echo.

REM --- Check Node.js ---
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [FAIL] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js: %NODE_VERSION%
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js %NODE_VERSION%

REM --- Check MetaMask ---
echo.
echo [INFO] Make sure MetaMask is installed and connected to Monad testnet.
echo        Add network: https://monad.xyz/download
echo.
set /p MM_CONFIRM="Is MetaMask installed and on Monad testnet? (y/n): "
if /I "%MM_CONFIRM%" NEQ "y" (
    echo Setup aborted. Install MetaMask first.
    pause
    exit /b 1
)

REM --- Get testnet MON ---
echo.
echo [STEP 1] Get testnet MON from faucet
echo   Visit: https://faucet.zalalena.com/monad
echo   Claim MON to your MetaMask address
echo.
set /p FAUCET_DONE="Press Enter after you've claimed MON from the faucet... "

REM --- Install dependencies ---
echo.
echo [STEP 2] Installing dependencies...
cd /d "%~dp0"
npm install
cd frontend
npm install
cd ..

REM --- Deploy contract ---
echo.
echo [STEP 3] Deploying StreamPay contract to Monad testnet...
echo   Make sure MetaMask is unlocked and has MON.
echo.
set /p DEPLOY_CONFIRM="Press Enter to deploy (MetaMask will prompt for signature)... "

REM Run deploy script
set PRIVATE_KEY_OUTPUT=
for /f "tokens=2 delims==" %%a in ('findstr "PRIVATE_KEY=" .env 2^>nul') do set PRIVATE_KEY_OUTPUT=%%a
if "%PRIVATE_KEY_OUTPUT%"=="" (
    echo [WARN] No PRIVATE_KEY in .env. Using MetaMask for deploy.
    echo   Run: npx hardhat run scripts/deploy-viem.ts --network monadTestnet
) else (
    npx hardhat run scripts/deploy-viem.ts --network monadTestnet
)

echo.
echo [DONE] Contract deployed! Copy the address from the output above.
echo.

REM --- Start frontend ---
echo [STEP 4] Starting frontend...
echo   Open http://localhost:3000 in your browser.
echo.
cd frontend
set NEXT_PUBLIC_STREAMPAY_ADDRESS=PASTE_CONTRACT_ADDRESS_HERE
npm run dev
