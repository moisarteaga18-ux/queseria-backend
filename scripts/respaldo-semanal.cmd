@echo off
rem Respaldo de la base de QuesoData (lo ejecuta el Programador de tareas de Windows cada semana).
rem Deja un registro de cada ejecución en "Respaldos QuesoData\respaldos.log".
cd /d "%~dp0.."
if not exist "%USERPROFILE%\Respaldos QuesoData" mkdir "%USERPROFILE%\Respaldos QuesoData"
echo ==== %date% %time% >> "%USERPROFILE%\Respaldos QuesoData\respaldos.log"
node scripts\respaldar.js >> "%USERPROFILE%\Respaldos QuesoData\respaldos.log" 2>&1
