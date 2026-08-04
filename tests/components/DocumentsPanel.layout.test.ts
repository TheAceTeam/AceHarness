import { describe, expect, test } from 'vitest';
import { getDocumentsPanelLayout } from '@/components/DocumentsPanel';

describe('DocumentsPanel layout contract', () => {
  test('uses two columns for inline lightweight tasklist documents', () => {
    expect(getDocumentsPanelLayout({ lightweightTasklistLayout: true, previewPresentation: 'inline' })).toBe('two-column');
  });

  test('keeps the ordinary state-machine document layout unchanged', () => {
    expect(getDocumentsPanelLayout({ lightweightTasklistLayout: false, previewPresentation: 'inline' })).toBe('three-column');
    expect(getDocumentsPanelLayout({ lightweightTasklistLayout: false, previewPresentation: 'drawer' })).toBe('three-column');
  });
});
