param([Parameter(Mandatory=$true)][string]$OwnerFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MediFlowJob {
 public static System.Threading.Tasks.Task<string> ReadCommand() { return System.Threading.Tasks.Task.Run(() => Console.In.ReadLine()); }
 [StructLayout(LayoutKind.Sequential)] public struct BasicLimits { public long User; public long Job; public uint Flags; public UIntPtr Min; public UIntPtr Max; public uint Count; public UIntPtr Affinity; public uint Priority; public uint Scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong A,B,C,D,E,F; }
 [StructLayout(LayoutKind.Sequential)] public struct Limits { public BasicLimits Basic; public Io Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
 [StructLayout(LayoutKind.Sequential)] public struct Accounting { public long User,Kernel,PeriodUser,PeriodKernel; public uint Faults,Total,Active,Terminated; }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits value,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting value,uint length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
 public static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 public static uint Active(IntPtr job) { Accounting a; Check(QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)); return a.Active; }
}
'@
$owner = Get-Content -LiteralPath $OwnerFile -Raw | ConvertFrom-Json
$target = [Diagnostics.Process]::GetProcessById([int]$owner.pid)
if ($target.StartTime.ToUniversalTime().Ticks.ToString() -ne $owner.start) { throw 'Owner identity mismatch' }
$job = [MediFlowJob]::CreateJobObject([IntPtr]::Zero,$null)
if ($job -eq [IntPtr]::Zero) { throw 'Job unavailable' }
try {
 $limits = New-Object MediFlowJob+Limits
 $limits.Basic.Flags = 0x2000
 [MediFlowJob]::Check([MediFlowJob]::SetInformationJobObject($job,9,[ref]$limits,[Runtime.InteropServices.Marshal]::SizeOf($limits)))
 [MediFlowJob]::Check([MediFlowJob]::AssignProcessToJobObject($job,$target.Handle))
 [Console]::Out.WriteLine((@{type='ready';nonce=$owner.nonce} | ConvertTo-Json -Compress))
 $line = [MediFlowJob]::ReadCommand()
 while ($true) {
  $target.Refresh()
  if ($target.HasExited) { break }
  if ($line.IsCompleted) {
   $command = $line.Result
   if ($null -eq $command) { break }
   if ($command -ne $owner.nonce) { throw 'Job command mismatch' }
   break
  }
  Start-Sleep -Milliseconds 40
 }
 $current = Get-Content -LiteralPath $OwnerFile -Raw | ConvertFrom-Json
 if ($current.pid -ne $owner.pid -or $current.start -ne $owner.start -or $current.nonce -ne $owner.nonce) { throw 'Owner token changed' }
 [MediFlowJob]::Check([MediFlowJob]::TerminateJobObject($job,0))
 $deadline = [DateTime]::UtcNow.AddSeconds(15)
 while ([MediFlowJob]::Active($job) -ne 0) {
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Job drain timeout' }
  Start-Sleep -Milliseconds 40
 }
 [Console]::Out.WriteLine((@{type='drained';nonce=$owner.nonce;active=0} | ConvertTo-Json -Compress))
} finally {
 $target.Dispose()
 [MediFlowJob]::Check([MediFlowJob]::CloseHandle($job))
}
