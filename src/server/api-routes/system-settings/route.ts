import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import {
  loadSystemSettings,
  normalizeAgentMemorySettings,
  normalizeWorkspaceExperienceSettings,
  saveSystemSettings,
} from '@/lib/config/system-settings';
import {
  defaultPermissionPolicy,
  type RuntimePermissionPolicyId,
  type RuntimeReadiness,
} from '@/lib/runtime-agent/contracts';
import { checkSecretProfileReadiness } from '@/lib/runtime-agent/security/env-secret-profiles';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import {
  RuntimeSqliteStore,
  type RuntimeEnvProfileRecord,
  type RuntimeSecretProfileRecord,
} from '@/lib/runtime-agent/sqlite/runtime-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

const RUNTIME_PERMISSION_POLICIES = new Set<RuntimePermissionPolicyId>([
  'unrestricted',
  'approve-reads',
  'ask',
  'deny-destructive',
  'deny-all',
]);

function normalizeRuntimePermissionPolicyId(value: unknown): RuntimePermissionPolicyId {
  return typeof value === 'string' && RUNTIME_PERMISSION_POLICIES.has(value as RuntimePermissionPolicyId)
    ? value as RuntimePermissionPolicyId
    : defaultPermissionPolicy;
}

function summarizeEnvProfile(profile: RuntimeEnvProfileRecord) {
  const missing = new Set<string>();
  const seen = new Map<string, number>();
  for (const variable of profile.variables || []) {
    const key = variable.key.trim();
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (variable.required && !variable.value && !variable.secretRef) {
      missing.add(key);
    }
  }
  const duplicateKeys = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const readiness: RuntimeReadiness = missing.size > 0 ? 'missing' : duplicateKeys.length > 0 ? 'misconfigured' : profile.variables.length > 0 ? 'ready' : 'unknown';
  return {
    displayName: profile.displayName,
    agentId: profile.agentId,
    visibility: profile.visibility,
    variableCount: profile.variables.length,
    readiness,
    missing: [...missing].sort(),
    conflicts: duplicateKeys.map((key) => ({
      key,
      sources: ['env-profile', 'env-profile'],
      selectedSource: 'env-profile',
    })),
    updatedAt: profile.updatedAt,
  };
}

function summarizeSecretProfile(profile: RuntimeSecretProfileRecord) {
  const readiness = checkSecretProfileReadiness(profile);
  return {
    displayName: profile.displayName,
    agentId: profile.agentId,
    visibility: profile.visibility,
    encrypted: profile.encrypted,
    encryptionKeyReady: profile.encryptionKeyReady,
    secretCount: profile.secrets.length,
    readiness,
    missing: profile.secrets
      .filter((secret) => secret.required && secret.readiness !== 'ready')
      .map((secret) => secret.key)
      .sort(),
    conflicts: [],
    updatedAt: profile.updatedAt,
  };
}

function loadRuntimeControlsSummary(ownerUserId: string) {
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  try {
    const store = new RuntimeSqliteStore(db);
    const envProfiles = store.listEnvProfiles({ ownerUserId });
    const secretProfiles = store.listSecretProfiles({ ownerUserId });
    const profileConflicts = new Map<string, Set<string>>();
    for (const envProfile of envProfiles) {
      for (const variable of envProfile.variables || []) {
        const key = variable.key.trim();
        if (!key) continue;
        const hasSecretProfileKey = secretProfiles.some((profile) => profile.secrets.some((secret) => secret.key.trim() === key));
        if (hasSecretProfileKey) {
          const sources = profileConflicts.get(key) ?? new Set<string>();
          sources.add('env-profile');
          sources.add('secret-profile');
          profileConflicts.set(key, sources);
        }
      }
    }
    return {
      envProfiles: envProfiles.map(summarizeEnvProfile),
      secretProfiles: secretProfiles.map(summarizeSecretProfile),
      conflicts: [...profileConflicts.entries()].map(([key, sources]) => ({
        key,
        sources: [...sources],
        selectedSource: 'env-profile',
      })),
    };
  } finally {
    db.close();
  }
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const settings = await loadSystemSettings();
  const runtimeControls = settings.runtimeControls || {};
  const runtimeSummary = loadRuntimeControlsSummary(auth.id);
  return jsonOk({
    gitcodeTokenConfigured: Boolean(settings.gitcodeToken),
    locale: settings.locale || 'zh',
    engineAvailabilityCacheMinutes: Number.isFinite(settings.engineAvailabilityCacheMinutes)
      ? Math.max(1, Math.min(24 * 60, Number(settings.engineAvailabilityCacheMinutes)))
      : 30,
    workspaceExperience: normalizeWorkspaceExperienceSettings(settings.workspaceExperience),
    agentMemory: normalizeAgentMemorySettings(settings.agentMemory),
    runtimeControls: {
      defaultPermissionPolicyId: normalizeRuntimePermissionPolicyId(runtimeControls.defaultPermissionPolicyId),
      ...runtimeSummary,
    },
    runtimeDebug: {
      acpxTraceEnabled: Boolean(settings.runtimeDebug?.acpxTraceEnabled),
      acpxTraceDirectory: getWorkspaceDataFile('acpx-debug-traces'),
    },
    emailNotifications: {
      enabled: Boolean(settings.emailNotifications?.enabled),
      smtpHost: settings.emailNotifications?.smtpHost || '',
      smtpPort: settings.emailNotifications?.smtpPort || 465,
      smtpSecure: settings.emailNotifications?.smtpSecure !== false,
      smtpUsername: settings.emailNotifications?.smtpUsername || '',
      smtpPasswordConfigured: Boolean(settings.emailNotifications?.smtpPassword),
      fromEmail: settings.emailNotifications?.fromEmail || '',
      fromName: settings.emailNotifications?.fromName || '',
      replyTo: settings.emailNotifications?.replyTo || '',
      ccEmails: settings.emailNotifications?.ccEmails || '',
      subjectPrefix: settings.emailNotifications?.subjectPrefix || '',
    },
  });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const settings = await loadSystemSettings();
    const nextEmailSettings = body.emailNotifications && typeof body.emailNotifications === 'object'
      ? {
        ...settings.emailNotifications,
        enabled: body.emailNotifications.enabled === true,
        smtpHost: typeof body.emailNotifications.smtpHost === 'string' ? body.emailNotifications.smtpHost.trim() : settings.emailNotifications?.smtpHost,
        smtpPort: Number.isFinite(Number(body.emailNotifications.smtpPort))
          ? Number(body.emailNotifications.smtpPort)
          : settings.emailNotifications?.smtpPort,
        smtpSecure: body.emailNotifications.smtpSecure !== false,
        smtpUsername: typeof body.emailNotifications.smtpUsername === 'string' ? body.emailNotifications.smtpUsername.trim() : settings.emailNotifications?.smtpUsername,
        smtpPassword: typeof body.emailNotifications.smtpPassword === 'string' && body.emailNotifications.smtpPassword.trim()
          ? body.emailNotifications.smtpPassword
          : settings.emailNotifications?.smtpPassword,
        fromEmail: typeof body.emailNotifications.fromEmail === 'string' ? body.emailNotifications.fromEmail.trim() : settings.emailNotifications?.fromEmail,
        fromName: typeof body.emailNotifications.fromName === 'string' ? body.emailNotifications.fromName.trim() : settings.emailNotifications?.fromName,
        replyTo: typeof body.emailNotifications.replyTo === 'string' ? body.emailNotifications.replyTo.trim() : settings.emailNotifications?.replyTo,
        ccEmails: typeof body.emailNotifications.ccEmails === 'string' ? body.emailNotifications.ccEmails.trim() : settings.emailNotifications?.ccEmails,
        subjectPrefix: typeof body.emailNotifications.subjectPrefix === 'string' ? body.emailNotifications.subjectPrefix.trim() : settings.emailNotifications?.subjectPrefix,
      }
      : settings.emailNotifications;
    const nextEngineAvailabilityCacheMinutes = Number.isFinite(Number(body.engineAvailabilityCacheMinutes))
      ? Math.max(1, Math.min(24 * 60, Number(body.engineAvailabilityCacheMinutes)))
      : settings.engineAvailabilityCacheMinutes;
    const currentWorkspaceExperience = normalizeWorkspaceExperienceSettings(settings.workspaceExperience);
    const nextWorkspaceExperience = body.workspaceExperience && typeof body.workspaceExperience === 'object'
      ? normalizeWorkspaceExperienceSettings({
        ...currentWorkspaceExperience,
        mode: body.workspaceExperience.mode,
        defaultEntry: body.workspaceExperience.defaultEntry,
        onePersonCompanyOnboardingSeen: body.workspaceExperience.onePersonCompanyOnboardingSeen,
      })
      : settings.workspaceExperience;
    const currentAgentMemory = normalizeAgentMemorySettings(settings.agentMemory);
    const nextAgentMemory = body.agentMemory && typeof body.agentMemory === 'object'
      ? normalizeAgentMemorySettings({
        ...currentAgentMemory,
        runtimeEnabled: body.agentMemory.runtimeEnabled === true,
        persistMode: body.agentMemory.persistMode,
      })
      : settings.agentMemory;
    const currentRuntimeControls = settings.runtimeControls || {};
    const nextRuntimeControls = body.runtimeControls && typeof body.runtimeControls === 'object'
      ? {
        ...currentRuntimeControls,
        defaultPermissionPolicyId: normalizeRuntimePermissionPolicyId(body.runtimeControls.defaultPermissionPolicyId),
      }
      : currentRuntimeControls;
    const nextRuntimeDebug = body.runtimeDebug && typeof body.runtimeDebug === 'object'
      ? {
        ...settings.runtimeDebug,
        acpxTraceEnabled: body.runtimeDebug.acpxTraceEnabled === true,
      }
      : settings.runtimeDebug;
    await saveSystemSettings({
      ...settings,
      gitcodeToken: typeof body.gitcodeToken === 'string' ? body.gitcodeToken.trim() : settings.gitcodeToken,
      locale: body.locale === 'en' ? 'en' : body.locale === 'zh' ? 'zh' : settings.locale,
      engineAvailabilityCacheMinutes: nextEngineAvailabilityCacheMinutes,
      workspaceExperience: nextWorkspaceExperience,
      agentMemory: nextAgentMemory,
      runtimeControls: nextRuntimeControls,
      runtimeDebug: nextRuntimeDebug,
      emailNotifications: nextEmailSettings,
    });
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '保存系统设置失败' }, { status: 500 });
  }
}
