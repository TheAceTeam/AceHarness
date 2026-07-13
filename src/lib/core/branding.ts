export function formatLegacyProductPathForDisplay(value: string): string {
  return String(value || '').replace(/aceharness/gi, (match) => {
    if (match === match.toUpperCase()) return 'CSIHARNESS';
    if (match[0] === match[0].toUpperCase()) return 'CSIHarness';
    return 'csiharness';
  });
}
