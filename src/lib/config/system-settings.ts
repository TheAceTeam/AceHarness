import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

const SYSTEM_SETTINGS_PATH = getWorkspaceDataFile('system-settings.yaml');

export interface SystemSettings {
  gitcodeToken?: string;
  host?: string;
  port?: number;
  lanAccess?: boolean;
  locale?: 'zh' | 'en';
  engineAvailabilityCacheMinutes?: number;
  emailNotifications?: {
    enabled?: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUsername?: string;
    smtpPassword?: string;
    fromEmail?: string;
    fromName?: string;
    replyTo?: string;
    ccEmails?: string;
    subjectPrefix?: string;
  };
}

async function readSystemSettings(): Promise<SystemSettings> {
  try {
    const content = await readFile(SYSTEM_SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    return parsed && typeof parsed === 'object' ? parsed as SystemSettings : {};
  } catch {
    return {};
  }
}

export async function loadSystemSettings(): Promise<SystemSettings> {
  return readSystemSettings();
}

export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  await mkdir(dirname(SYSTEM_SETTINGS_PATH), { recursive: true });
  await writeFile(SYSTEM_SETTINGS_PATH, stringify(settings), 'utf-8');
}
