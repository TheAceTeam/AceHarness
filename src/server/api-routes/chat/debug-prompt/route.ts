import { buildDashboardSystemPrompt } from '@/lib/chat/system-prompt';
import { loadChatSettings } from '@/lib/chat/settings';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const settings = await loadChatSettings();
    const enabled = Object.entries(settings.skills || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    const prompt = await buildDashboardSystemPrompt(enabled);
    return jsonOk({
      prompt,
      enabledSkills: enabled,
      skills: settings.skills,
    });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}
