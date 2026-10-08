param([string]$DeviceSerial = '')

$ErrorActionPreference = 'Stop'
$rhythmPhoneScript = Join-Path $PSScriptRoot 'phone.mjs'
$rhythmNodeArguments = @($rhythmPhoneScript, 'install', '--usb')
if ($DeviceSerial) { $rhythmNodeArguments += @('--serial', $DeviceSerial) }
& node @rhythmNodeArguments
if ($LASTEXITCODE -ne 0) { throw 'Установка не завершена; причина показана выше.' }
