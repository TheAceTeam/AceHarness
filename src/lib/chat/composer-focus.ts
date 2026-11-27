/** Toolbar and portal focus must not create a conversation. */
export function isComposerEditorFocus(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.ProseMirror[contenteditable="true"]'));
}
