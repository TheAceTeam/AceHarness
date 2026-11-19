export function isCanvasTextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="combobox"],.monaco-editor,.cm-editor',
  ));
}
