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
  workspaceExperience?: {
    mode?: 'engineer' | 'one-person-company';
    defaultEntry?: 'home' | 'meeting-room' | 'office' | 'workflows';
    onePersonCompanyOnboardingSeen?: boolean;
  };
  agentMemory?: {
    runtimeEnabled?: boolean;
    persistMode?: 'manual' | 'review' | 'auto';
  };
  runtimeControls?: {
    defaultPermissionPolicyId?: 'unrestricted' | 'approve-reads' | 'ask' | 'deny-destructive' | 'deny-all';
  };
  runtimeDebug?: {
    acpxTraceEnabled?: boolean;
  };
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

export function normalizeWorkspaceExperienceSettings(settings?: SystemSettings['workspaceExperience']): Required<NonNullable<SystemSettings['workspaceExperience']>> {
  const mode = settings?.mode === 'one-person-company' ? 'one-person-company' : 'engineer';
  const validEntry = settings?.defaultEntry === 'meeting-room'
    || settings?.defaultEntry === 'office'
    || settings?.defaultEntry === 'workflows'
    || settings?.defaultEntry === 'home';
  return {
    mode,
    defaultEntry: validEntry ? settings!.defaultEntry! : mode === 'one-person-company' ? 'office' : 'home',
    onePersonCompanyOnboardingSeen: Boolean(settings?.onePersonCompanyOnboardingSeen),
  };
}

export function normalizeAgentMemorySettings(settings?: SystemSettings['agentMemory']): Required<NonNullable<SystemSettings['agentMemory']>> {
  const persistMode = settings?.persistMode === 'manual' || settings?.persistMode === 'auto'
    ? settings.persistMode
    : 'review';
  return {
    runtimeEnabled: Boolean(settings?.runtimeEnabled),
    persistMode,
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
