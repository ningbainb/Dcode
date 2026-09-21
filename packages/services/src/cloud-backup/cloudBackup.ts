import { createServiceDescriptor } from "../descriptors.js";

export interface BackupPreview {
  fingerprint: string;
  files: string[];
  bytes: number;
  excluded: { path: string; reason: string }[];
  blocked: { path: string; reason: string }[];
}
export interface BackupSnapshot {
  sha: string;
  createdAt: string;
  files: number;
  uploaded: boolean;
}
export interface BackupProject {
  path: string;
  enabled: boolean;
  approved?: boolean;
  repository: string;
  account: string;
  intervalMinutes: number;
  excludes: string[];
  branch: string;
  lastLocal?: string;
  lastCloud?: string;
  lastError?: string;
  retryAt?: number;
  failures: number;
  snapshots: BackupSnapshot[];
}
export interface BackupStatus {
  supported: boolean;
  account?: string;
  loginPending: boolean;
  error?: string;
  project?: BackupProject;
}
export interface BackupEnableRequest {
  path: string;
  repository: string;
  create: boolean;
  intervalMinutes: number;
  excludes: string[];
  fingerprint: string;
}
export interface ICloudBackupService {
  status(path?: string): Promise<BackupStatus>;
  login(): Promise<void>;
  cancelLogin(): Promise<void>;
  disconnect(): Promise<void>;
  repositories(): Promise<string[]>;
  importRemote(path: string, repository: string): Promise<void>;
  preview(path: string, excludes: string[]): Promise<BackupPreview>;
  enable(request: BackupEnableRequest): Promise<void>;
  setEnabled(path: string, enabled: boolean): Promise<void>;
  backup(path: string): Promise<void>;
  diff(path: string, sha: string): Promise<string>;
  restore(path: string, sha: string, parentDirectory: string): Promise<string>;
  dispose(): Promise<void>;
}
export const ICloudBackupService =
  createServiceDescriptor<ICloudBackupService>("dcode-cloud-backup");
