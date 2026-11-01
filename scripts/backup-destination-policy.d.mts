export const SYNC_DIRECTORY_NAMES: readonly string[];
export const LINUX_SINGLE_DEVICE_FILESYSTEMS: readonly string[];
export const MOUNT_ROOTS: readonly string[];
export class BackupDestinationError extends Error {
  readonly userMessage: string;
  readonly code: string;
  constructor(userMessage: string, code?: string);
}
export function isSynchronizedBackupPath(value: string, options?: { platform?: string; homeDir?: string }): boolean;
export function resolveBackupDestination(value: string): string;
export function backupStorageDirectory(value: string, options?: { platform?: string }): string;
export function resolveEffectiveBackupDestination(value: string, options?: { create?: boolean }): string;
export function probeBackupVolume(destination: string, options?: { platform?: string; run?: (file: string, args: string[], input?: string) => string }): 'verified' | 'unencrypted' | 'unverified';
export function backupDestinationIdentity(destination: string): string;
export function validateBackupDestination(value: string, acknowledged?: boolean, acknowledgedIdentity?: string): { destination: string; protection: 'verified' | 'unencrypted' | 'unverified'; directoryIdentity: { dev: number; ino: number } };
