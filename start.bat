@echo off
title HIJ Konveksi PWA Server
echo ========================================================
echo    HIJ KONVEKSI ERP & CUSTOMER PORTAL PWA (SOP 01-20)
echo    PT Hasil Inti Jualan
echo ========================================================
echo.
echo Menjalankan server aplikasi di http://localhost:3001 ...
echo Silakan buka browser Anda di http://localhost:3001
echo.
start http://localhost:3001
set PORT=3001
npx tsx server/index.ts
pause
