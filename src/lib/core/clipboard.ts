import copy from 'copy-to-clipboard';

export async function copyText(text: string): Promise<boolean> {
  const value = text ?? '';

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    return copy(value);
  } catch {
    return false;
  }
}
