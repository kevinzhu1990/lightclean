@echo off
chcp 65001 >nul
title 轻净离线激活码发放工具
cd /d "%~dp0.."
set "LIGHTCLEAN_LICENSE_DB=%~dp0data\licenses.db"
set "LIGHTCLEAN_PRIVATE_KEY=%~dp0..\..\轻净离线授权私钥\lightclean-ed25519-private.pem"

echo.
echo ==============================
echo   轻净离线激活码发放工具
echo ==============================
echo.
set /p "PURCHASE_CODE=请输入客户的购买兑换码："
echo.
set /p "DEVICE_REQUEST=请粘贴客户的设备申请码："
echo.

node "%~dp0offline-issuer.mjs" --code "%PURCHASE_CODE%" --request "%DEVICE_REQUEST%" --copy
echo.
echo 如上方显示“成功”，激活码已经复制，可直接发给客户。
echo.
pause
