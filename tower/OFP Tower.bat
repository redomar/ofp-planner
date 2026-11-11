@echo off
title OFP Tower - flight recorder + live link to OFP Planner
cd /d "%~dp0"
echo ============================================================
echo  OFP Tower: records your flight and streams it live to
echo  OFP Planner and OBS (route from the Fenix MCDU).
echo  Start MSFS and load into a flight first.
echo  Press Ctrl+C in this window to stop. It also stops by
echo  itself when the sim closes.
echo ============================================================
echo.
start "" "https://plans.massorbit.co.uk/board?tab=gate&feed=link&view=full"
"%LOCALAPPDATA%\Programs\Python\Python312\python.exe" recorder.py --serve
echo.
echo OFP Tower stopped. Recordings are in: %~dp0recordings
pause
