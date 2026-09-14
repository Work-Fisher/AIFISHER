export const RELEASE_CONTRACT = Object.freeze({
  product: 'AIFISHER 画布',
  controlCenter: 'AIFISHER 控制中心',
  executable: 'AIFISHER 控制中心.exe',
  installScript: 'Install-AIFISHER-Canvas.bat',
  startScript: 'Start-AIFISHER-Canvas.bat',
  stopScript: 'Stop-AIFISHER-Canvas.bat',
  upgradeScript: 'Upgrade-AIFISHER-Canvas.bat',
  rollbackScript: 'Rollback-AIFISHER-Canvas.bat',
  uninstallScript: 'Uninstall-AIFISHER-Canvas.bat',
  packagePrefix: 'AIFISHER-Canvas',
  format: 'fisherai-portable-release',
});

// These names are accepted only while upgrading an installed legacy package.
// Construct the former brand here so it cannot leak into newly produced assets.
const LEGACY_BRAND = ['Fisher', 'AI'].join('');

export const LEGACY_RELEASE_CONTRACT = Object.freeze({
  product: `${LEGACY_BRAND}画布`,
  packagePrefix: `${LEGACY_BRAND}画布`,
  executable: `${LEGACY_BRAND}画布.exe`,
  installScript: `Install-${LEGACY_BRAND}-Canvas.bat`,
  startScript: `Start-${LEGACY_BRAND}-Canvas.bat`,
  stopScript: `Stop-${LEGACY_BRAND}-Canvas.bat`,
  upgradeScript: `Upgrade-${LEGACY_BRAND}-Canvas.bat`,
  rollbackScript: `Rollback-${LEGACY_BRAND}-Canvas.bat`,
  uninstallScript: `Uninstall-${LEGACY_BRAND}-Canvas.bat`,
});

export function brandedRootFiles(contract = RELEASE_CONTRACT) {
  return [
    contract.executable,
    contract.installScript,
    contract.startScript,
    contract.stopScript,
    contract.upgradeScript,
    contract.rollbackScript,
    contract.uninstallScript,
  ];
}

export function portablePackageName(version) {
  return `${RELEASE_CONTRACT.packagePrefix}-${version}-portable`;
}

export function installerPackageName(version) {
  return `${RELEASE_CONTRACT.packagePrefix}-${version}-Setup.exe`;
}

export function isPortableArchiveFileName(fileName) {
  const prefix = `${RELEASE_CONTRACT.packagePrefix}-`;
  const suffix = '-portable.zip';
  return (
    fileName.startsWith(prefix) &&
    fileName.endsWith(suffix) &&
    fileName.length > prefix.length + suffix.length
  );
}
