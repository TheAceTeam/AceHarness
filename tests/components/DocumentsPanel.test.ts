import { describe, expect, test } from 'vitest';
import { getDocumentFolderGroup } from '@/components/DocumentsPanel';

describe('DocumentsPanel folder grouping', () => {
  test('normalizes spaces around filename hyphens for fallback folder labels', () => {
    const compact = getDocumentFolderGroup({
      filename: '根因定位-定位空指针路径.md',
      phaseName: '',
    });
    const spaced = getDocumentFolderGroup({
      filename: '根因定位 - 定位空指针路径.md',
      phaseName: '',
    });

    expect(compact.label).toBe('根因定位');
    expect(spaced.label).toBe('根因定位');
    expect(spaced.key).toBe(compact.key);
  });

  test('uses workflow phase or state metadata before parsing filenames', () => {
    const spaceLabel = getDocumentFolderGroup({
      filename: '2026-03-20T14-30-00-ArkUI DSL 获取-解析 UX DSL.md',
      phaseName: 'ArkUI DSL 获取',
    });
    const hyphenLabel = getDocumentFolderGroup({
      filename: '2026-03-20T14-30-00-ArkUI-DSL 获取-解析 UX DSL.md',
      phaseName: 'ArkUI-DSL 获取',
    });

    expect(spaceLabel.label).toBe('ArkUI DSL 获取');
    expect(hyphenLabel.label).toBe('ArkUI-DSL 获取');
    expect(hyphenLabel.key).toBe(spaceLabel.key);
  });
});
