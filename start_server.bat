@echo off
set PLAYER_COUNT=%1
set PUBLIC_IP=%2
set DIFFICULTY=%3
set PORT=%4

echo Starting Edushooter server with:
echo Players: %PLAYER_COUNT%
echo IP: %PUBLIC_IP%
echo Difficulty: %DIFFICULTY%
echo Port: %PORT%

start "" /b edushooter_server\Edushooter.exe -servermode -players "%PLAYER_COUNT%" -external_address "%PUBLIC_IP%" -difficulty "%DIFFICULTY%" -port "%PORT%" -listen_address 0.0.0.0