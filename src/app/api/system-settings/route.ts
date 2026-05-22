import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { loadSystemSettings, saveSystemSettings } from '@/lib/config/system-settings';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const settings = await loadSystemSettings();
  return NextResponse.json({
    gitcodeTokenConfigured: Boolean(settings.gitcodeToken),
    locale: settings.locale || 'zh',
    engineAvailabilityCacheMinutes: Number.isFinite(settings.engineAvailabilityCacheMinutes)
      ? Math.max(1, Math.min(24 * 60, Number(settings.engineAvailabilityCacheMinutes)))
      : 30,
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

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
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
    await saveSystemSettings({
      ...settings,
      gitcodeToken: typeof body.gitcodeToken === 'string' ? body.gitcodeToken.trim() : settings.gitcodeToken,
      locale: body.locale === 'en' ? 'en' : body.locale === 'zh' ? 'zh' : settings.locale,
      engineAvailabilityCacheMinutes: nextEngineAvailabilityCacheMinutes,
      emailNotifications: nextEmailSettings,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '保存系统设置失败' }, { status: 500 });
  }
}
