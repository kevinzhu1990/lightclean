$ErrorActionPreference = 'Stop'

$version = '1.2.3'

$packageArgs = @{
  packageName    = 'lightclean'
  fileType       = 'exe'
  url64bit       = "https://github.com/kevinzhu1990/lightclean/releases/download/v$version/LightClean-Setup-$version.exe"
  silentArgs     = '/S'
  validExitCodes = @(0)
  checksum64     = '__REPLACE_WITH_SHA256_HASH__'
  checksumType64 = 'sha256'
}

Install-ChocolateyPackage @packageArgs
