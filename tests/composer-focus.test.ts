// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { isComposerEditorFocus } from '@/lib/chat/composer-focus';

test('only editor focus may create a draft, never model, effort or portal focus', () => {
  const area = document.createElement('div');
  area.innerHTML = '<div class="ProseMirror" contenteditable="true"><p>Draft</p></div><button>Model</button><div role="slider" tabindex="0"></div><input role="combobox">';
  expect(isComposerEditorFocus(area.querySelector('p'))).toBe(true);
  expect(isComposerEditorFocus(area.querySelector('button'))).toBe(false);
  expect(isComposerEditorFocus(area.querySelector('[role="slider"]'))).toBe(false);
  expect(isComposerEditorFocus(area.querySelector('input'))).toBe(false);
  expect(isComposerEditorFocus(null)).toBe(false);
});
