@echo off
REM Script khoi dong Tirouter CLIProxyAPI server
REM Chay: scripts\start-tirouter.bat

cd /d "%~dp0..\Tirouter\CLIProxyAPI"
echo Dang khoi dong Tirouter CLIProxyAPI server tren port 18401...
go run cmd/server/main.go
