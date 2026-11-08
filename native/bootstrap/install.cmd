@echo off
setlocal DisableDelayedExpansion
if /i "%~1"=="guided" goto :guided
if /i "%~1"=="guided-browser" goto :guidedBrowser
if /i "%~1"=="guided-administrator" goto :guidedAdministrator
node "%~dp0bin.mjs" %*
exit /b %ERRORLEVEL%

:guided
if "%~2"=="" goto :usage
if not "%~3"=="" goto :usage
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install.ps1" -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId "%~2"
exit /b %ERRORLEVEL%

:guidedBrowser
if "%~2"=="" goto :usage
if not "%~3"=="" goto :usage
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install.ps1" -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId "%~2"
exit /b %ERRORLEVEL%

:usage
>&2 echo Usage: install.cmd guided EXTENSION_ID or install.cmd guided-browser EXTENSION_ID or install.cmd guided-administrator EXTENSION_ID [SETUP_ID]
exit /b 2

:guidedAdministrator
if "%~2"=="" goto :usage
if not "%~4"=="" goto :usage
if "%~3"=="" goto :guidedAdministratorLegacy
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install.ps1" -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId "%~2" -BrowserSetupId "%~3"
exit /b %ERRORLEVEL%

:guidedAdministratorLegacy
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install.ps1" -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId "%~2"
exit /b %ERRORLEVEL%
