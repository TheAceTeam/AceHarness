/**
 * Theme Capability Implementation
 *
 * Manages conditional CSS class injection based on active theme.
 */

import type { ThemeCapability } from './types';
import type { PluginThemeConfig } from '../types';

export function createThemeCapability(
  getActiveTheme: () => PluginThemeConfig | null,
  setActiveThemeId: (id: string | null) => void,
  themes: Map<string, PluginThemeConfig>,
): ThemeCapability {
  return {
    activate(themeId: string) {
      setActiveThemeId(themeId);
    },
    deactivate() {
      setActiveThemeId(null);
    },
    getClass(element: string): string {
      const theme = getActiveTheme();
      if (!theme) return '';
      return (theme.classes as Record<string, string | undefined>)[element] || '';
    },
  };
}
