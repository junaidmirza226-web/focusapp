@echo off
setlocal enabledelayedexpansion

echo ============================================
echo FocusFine APK Builder
echo ============================================
echo.

REM Set Android SDK path
set ANDROID_HOME=CAndroidsdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%

REM Check if SDK exists, if not download it
if not exist %ANDROID_HOME% (
    echo Downloading Android SDK...
    mkdir %ANDROID_HOME%
    cd d %ANDROID_HOME%
    
    REM Download SDK using PowerShell
    powershell -Command Invoke-WebRequest -Uri 'httpsdl.google.comandroidrepositorycommandlinetools-win-9477386_latest.zip' -OutFile 'cmdline-tools.zip' 
    
    if exist cmdline-tools.zip (
        echo Extracting SDK...
        powershell -Command Expand-Archive -Path 'cmdline-tools.zip' -DestinationPath '.' -Force
        mkdir cmdline-toolslatest
        move cmdline-tools cmdline-toolslatest
        del cmdline-tools.zip
        echo SDK setup complete!
    )
)

REM Set environment variables
setx ANDROID_HOME %ANDROID_HOME%
setx ANDROID_SDK_ROOT %ANDROID_SDK_ROOT%
set PATH=%PATH%;%ANDROID_HOME%cmdline-toolslatestbin;%ANDROID_HOME%build-tools33.0.0;%ANDROID_HOME%platform-tools

REM Accept licenses
echo Accepting Android licenses...
echo y  %ANDROID_HOME%cmdline-toolslatestbinsdkmanager.bat --licenses nul 2&1

REM Build APK
echo.
echo Building FocusFine APK...
cd d DApk Buildfocusappandroid
call gradle bundleRelease

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo BUILD SUCCESSFUL!
    echo ============================================
    echo APK Location DApk Buildfocusappandroidappreleaseapp-release.aab
    echo.
    pause
) else (
    echo.
    echo BUILD FAILED
    echo.
    pause
)
