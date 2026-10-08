param(
    [string]$DeviceSerial = '',
    [ValidateRange(1024, 65535)][int]$AdbServerPort = 15037
)

$ErrorActionPreference = 'Stop'
$adbExecutable = Join-Path $PSScriptRoot '.tools\adb\platform-tools\adb.exe'
$apkFile = Join-Path $PSScriptRoot 'output\rhythm-money-0.2.0.apk'
if (-not (Test-Path -LiteralPath $adbExecutable)) {
    throw 'Сначала запусти node bootstrap-adb.mjs в папке finance-collector.'
}
if (-not (Test-Path -LiteralPath $apkFile)) { throw 'APK 0.2.0 не найден.' }

$deviceListing = & $adbExecutable -P $AdbServerPort devices
if ($LASTEXITCODE -ne 0) { throw 'ADB не удалось получить список устройств.' }
$onlineDevices = @($deviceListing | Where-Object { $_ -match '^([^\s]+)\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
if ($DeviceSerial) {
    if ($onlineDevices -notcontains $DeviceSerial) { throw 'Указанный телефон не подключён или не разрешил USB-отладку.' }
} else {
    if ($onlineDevices.Count -eq 0) {
        if ($deviceListing -match '\s+unauthorized\s*$') { throw 'Разблокируй телефон и подтверди USB-отладку для этого компьютера.' }
        throw 'Телефон не найден. Подключи USB-кабель и включи USB-отладку в настройках разработчика.'
    }
    if ($onlineDevices.Count -gt 1) { throw 'Подключено несколько устройств. Укажи нужное через параметр -DeviceSerial.' }
    $DeviceSerial = $onlineDevices[0]
}

$phoneSdk = ((& $adbExecutable -P $AdbServerPort -s $DeviceSerial shell getprop ro.build.version.sdk) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $phoneSdk -notmatch '^\d+$') { throw 'Не удалось определить версию Android.' }
if ([int]$phoneSdk -lt 26) { throw 'Приложению нужен Android 8.0 или новее.' }
$phoneProfile = ((& $adbExecutable -P $AdbServerPort -s $DeviceSerial shell am get-current-user) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $phoneProfile -notmatch '^\d+$') { throw 'Не удалось определить активный профиль телефона.' }
$phoneUserListing = & $adbExecutable -P $AdbServerPort -s $DeviceSerial shell dumpsys user
if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить профиль перед установкой.' }
$phoneProfileIdentity = $phoneUserListing | Where-Object { $_ -match ('UserInfo\{' + $phoneProfile + ':') } | Select-Object -First 1
if ($phoneProfileIdentity -match ':(Режим отладки|Debug mode):') {
    throw 'Включён отдельный Режим отладки Xiaomi. Выйди из него через системное уведомление и вернись в обычный профиль с банковскими приложениями. USB-отладка — отдельная настройка; её оставь включённой для установки.'
}
Write-Output ('Установка Ритм · деньги 0.2.0 на Android API ' + $phoneSdk + ', профиль ' + $phoneProfile)
& $adbExecutable -P $AdbServerPort -s $DeviceSerial install --no-incremental -r --user $phoneProfile $apkFile
if ($LASTEXITCODE -ne 0) {
    throw 'Установка отклонена. Сохрани показанный выше код ошибки для диагностики.'
}
& $adbExecutable -P $AdbServerPort -s $DeviceSerial shell am start -W --user $phoneProfile -n 'uz.rhythm.money/.MainActivity'
if ($LASTEXITCODE -ne 0) { throw 'APK установлен, но приложение не запустилось. Требуется диагностика запуска.' }
Write-Output 'Установка выполнена. Разрешения источников и вопросов настраиваются отдельно в приложении.'
