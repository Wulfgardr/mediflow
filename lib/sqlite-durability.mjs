import childProcess from 'node:child_process';
import path from 'node:path';

// Fixed, read-only command. The path is environment data, never PowerShell source.
// MS-FSA 2.1.5.7 / note 80 qualifies directory persistence only on NTFS.
const WINDOWS_DIRECTORY_CHECK = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:MEDIFLOW_SQLITE_DURABILITY_DIRECTORY
if ($p -notmatch '^[A-Za-z]:\\' -or $p.Substring(2).Contains(':')) { throw 'path' }
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($p))
if (-not $drive.IsReady -or $drive.DriveType -ne [System.IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw 'filesystem' }
# Keep the same literal path identity as Node, including trailing component spaces.
# This prefix is constructed only after validating a normal local drive path.
$exact = '\\?\' + $p
if (-not [System.IO.Directory]::Exists($exact)) { throw 'directory' }
$ancestor = $exact
while ($ancestor) {
  if (([System.IO.File]::GetAttributes($ancestor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
  $parent = [System.IO.Path]::GetDirectoryName($ancestor)
  if ($parent -eq $ancestor) { break }
  $ancestor = $parent
}
[Console]::Write('NTFS_FIXED')
`;

/** Qualify each Windows operation before effects; never cache a previous volume. */
export function assertDurableDirectory(directory) {
  if (process.platform !== 'win32') return;
  const deny = () => { throw new Error('SQLITE_DURABILITY_UNSUPPORTED: local fixed NTFS directory required'); };
  if (typeof directory !== 'string' || !/^[A-Za-z]:\\/.test(directory)
      || /[\u0000-\u001f\u007f]/u.test(directory) || directory.includes('/')
      || directory.slice(2).includes(':') || path.win32.normalize(directory) !== directory) deny();
  if (!process.env.SystemRoot || !/^[A-Za-z]:\\/.test(process.env.SystemRoot)) deny();
  const result = childProcess.spawnSync(path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_DIRECTORY_CHECK], {
      encoding: 'utf8', timeout: 15_000, maxBuffer: 4096, windowsHide: true, shell: false,
      env: { ...process.env, MEDIFLOW_SQLITE_DURABILITY_DIRECTORY: directory },
    });
  if (result.error || result.status !== 0 || result.signal || result.stdout !== 'NTFS_FIXED') deny();
}
