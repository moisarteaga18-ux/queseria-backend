@echo off
rem Respaldo de la base de QuesoData. Lo ejecuta el Programador de tareas de Windows
rem (tarea "QuesoData - Respaldo semanal", cada jueves a las 8 p. m.).
rem Deja un registro de cada ejecucion en "Respaldos QuesoData\respaldos.log".
rem Este archivo debe tener finales de linea CRLF (ver .gitattributes): con LF, cmd lee mal las lineas.
chcp 65001 >nul
cd /d "%~dp0.."
if not exist "%USERPROFILE%\Respaldos QuesoData" mkdir "%USERPROFILE%\Respaldos QuesoData"
echo ==== %date% %time% >> "%USERPROFILE%\Respaldos QuesoData\respaldos.log"
node scripts\respaldar.js >> "%USERPROFILE%\Respaldos QuesoData\respaldos.log" 2>&1
echo codigo de salida: %errorlevel% >> "%USERPROFILE%\Respaldos QuesoData\respaldos.log"
exit /b %errorlevel%
