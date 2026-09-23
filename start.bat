@echo off
title HIJ Konveksi ERP
echo ========================================================
echo    HIJ KONVEKSI ERP ^& CUSTOMER PORTAL
echo    PT Hasil Inti Jualan
echo ========================================================
echo.

if not exist ".env" (
  echo .env belum ada. Salin .env.example ke .env, isi AUTH_SECRET, lalu jalankan lagi.
  pause
  exit /b 1
)
findstr /R "^AUTH_SECRET=.." .env >nul
if errorlevel 1 (
  echo AUTH_SECRET belum diisi di .env. Buat kuncinya dengan:
  echo   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo Tampilan belum di-build. Menjalankan npm run build:all ...
  call npm run build:all
  if errorlevel 1 ( pause & exit /b 1 )
)
if not exist "dist-server\server.js" (
  echo Server belum di-build. Menjalankan npm run build:server ...
  call npm run build:server
  if errorlevel 1 ( pause & exit /b 1 )
)

set NODE_ENV=production
if "%PORT%"=="" set PORT=3001
echo Menjalankan server di http://localhost:%PORT% ...
echo Tutup jendela ini untuk mematikan server. Untuk berjalan otomatis
echo saat Windows menyala, daftarkan lewat NSSM atau pm2 (lihat README).
echo.
start http://localhost:%PORT%
node dist-server\server.js
pause
