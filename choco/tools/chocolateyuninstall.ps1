$ErrorActionPreference = 'Stop'

$packageName = 'lightclean'
$softwareName = '*LightClean*'

[array]$key = Get-UninstallRegistryKey -SoftwareName $softwareName

if ($key.Count -eq 1) {
  $key | ForEach-Object {
    $silentArgs = '/S'
    $fileType = 'exe'

    Uninstall-ChocolateyPackage -PackageName $packageName `
                                -FileType $fileType `
                                -SilentArgs $silentArgs `
                                -File $_.UninstallString.Replace('"', '')
  }
} elseif ($key.Count -eq 0) {
  Write-Warning "$packageName has already been uninstalled by other means."
} elseif ($key.Count -gt 1) {
  Write-Warning "$($key.Count) matches found!"
  Write-Warning "To prevent data loss, no programs will be uninstalled."
  Write-Warning "Please alert the package maintainer that the following keys were matched:"
  $key | ForEach-Object { Write-Warning "- $($_.DisplayName)" }
}
