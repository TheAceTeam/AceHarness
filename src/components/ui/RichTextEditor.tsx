'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { ListKit } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import { Markdown } from '@tiptap/markdown';
import { Extension } from '@tiptap/core';
import { useEffect, forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { createPortal } from 'react-dom';
import { uploadImageFile } from '@/lib/client-image-upload';

export interface RichTextEditorHandle {
  clear: () => void;
  getText: () => string;
  getHTML: () => string;
  getMarkdown: () => string;
  focus: () => void;
  isEmpty: () => boolean;
  setFullscreen: (value: boolean) => void;
  setContent: (content: string) => void;
}

interface RichTextEditorProps {
  content?: string;
  onChange?: (markdown: string, text: string) => void;
  onEnter?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  showFullscreenToggle?: boolean;
  showToolbar?: boolean;
  footerContent?: React.ReactNode;
}

const SingleLineEnter = Extension.create({
  name: 'singleLineEnter',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const textarea = document.querySelector('[data-single-line-enter]') as HTMLElement;
        if (textarea?.dataset.onEnter) {
          const text = editor.getMarkdown().trim();
          if (text) {
            try {
              const callback = JSON.parse(textarea.dataset.onEnter);
              callback(text);
            } catch {}
          }
        }
        return true;
      },
      'Shift-Enter': ({ editor }) => {
        editor.commands.setHardBreak();
        return true;
      },
    };
  },
});

const MenuBar = ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 pb-1 border-b mb-1 flex-wrap">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBold().run()} title="粗体 (Ctrl+B)">
        <span className={`text-xs font-bold ${editor.isActive('bold') ? 'text-primary' : ''}`}>B</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体 (Ctrl+I)">
        <span className={`text-xs italic ${editor.isActive('italic') ? 'text-primary' : ''}`}>I</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
        <span className={`text-xs ${editor.isActive('strike') ? 'text-primary' : ''}`} style={{ textDecoration: 'line-through' }}>S</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码">
        <span className={`text-xs font-mono ${editor.isActive('code') ? 'text-primary' : ''}`}>`</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="一级标题">
        <span className={`text-[11px] font-semibold ${editor.isActive('heading', { level: 1 }) ? 'text-primary' : ''}`}>H1</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="二级标题">
        <span className={`text-[11px] font-semibold ${editor.isActive('heading', { level: 2 }) ? 'text-primary' : ''}`}>H2</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用">
        <span className={`material-symbols-outlined text-sm ${editor.isActive('blockquote') ? 'text-primary' : ''}`}>format_quote</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分隔线">
        <span className="material-symbols-outlined text-sm">horizontal_rule</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表">
        <span className="material-symbols-outlined text-sm">format_list_bulleted</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表">
        <span className="material-symbols-outlined text-sm">format_list_numbered</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleTaskList().run()} title="任务列表">
        <span className={`material-symbols-outlined text-sm ${editor.isActive('taskList') ? 'text-primary' : ''}`}>checklist</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().undo().run()} title="撤销 (Ctrl+Z)">
        <span className="material-symbols-outlined text-sm">undo</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().redo().run()} title="重做 (Ctrl+Shift+Z)">
        <span className="material-symbols-outlined text-sm">redo</span>
      </Button>
    </div>
  );
};

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
  content = '',
  onChange,
  onEnter,
  placeholder = '输入消息...',
  maxLength = 10000,
  minHeight = 60,
  maxHeight = 120,
  disabled = false,
  className = '',
  autoFocus = false,
  showFullscreenToggle = false,
  showToolbar = false,
  footerContent,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRuntimeRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(0);

  const getMarkdownWithImageLocalPaths = useCallback(() => {
    if (!editorRuntimeRef.current) return '';
    const editor = editorRuntimeRef.current;
    const markdown = editor.getMarkdown();
    const localPathLines: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'image') return true;
      const title = String((node.attrs as any)?.title || '');
      const prefix = 'local-path::';
      if (title.startsWith(prefix)) {
        const localPath = title.slice(prefix.length).trim();
        if (localPath) localPathLines.push(`[image_local_path]: ${localPath}`);
      }
      return true;
    });
    if (localPathLines.length === 0) return markdown;
    const uniqueLines = Array.from(new Set(localPathLines));
    return `${markdown.trimEnd()}\n\n${uniqueLines.join('\n')}`;
  }, []);

  const insertUploadedImage = useCallback(async (file: File, atPos?: number) => {
    setUploadingImages((prev) => prev + 1);
    try {
      const uploaded = await uploadImageFile(file);
      const safeName = uploaded.fileName?.replace(/\]/g, '') || 'image';
      const chain = editorRuntimeRef.current?.chain().focus();
      if (!chain) return;
      const nodes = [
        {
          type: 'image' as const,
          attrs: {
            src: uploaded.url,
            alt: safeName,
            title: `local-path::${uploaded.absolutePath}`,
          },
        },
        { type: 'paragraph' as const },
      ];
      if (typeof atPos === 'number' && Number.isFinite(atPos)) {
        chain.insertContentAt(atPos, nodes).run();
      } else {
        chain.insertContent(nodes).run();
      }
    } catch (error) {
      console.error('[RichTextEditor] 图片上传失败', error);
    } finally {
      setUploadingImages((prev) => Math.max(0, prev - 1));
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Markdown,
      Typography,
      Image,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount.configure({
        limit: maxLength,
      }),
      ListKit.configure({
        taskItem: { nested: true },
      }),
    ],
    content,
    contentType: 'markdown',
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'outline-none prose prose-sm max-w-none',
      },
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        const files = Array.from(clipboard.files || []).filter((file) => file.type?.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((file) => {
          void insertUploadedImage(file);
        });
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const dt = event.dataTransfer;
        if (!dt) return false;
        const files = Array.from(dt.files || []).filter((file) => file.type?.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = typeof (_view as any)?.posAtCoords === 'function'
          ? (_view as any).posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          : undefined;
        files.forEach((file) => {
          void insertUploadedImage(file, pos);
        });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      const text = editor.getText();
      onChange?.(markdown, text);
    },
  });

  useEffect(() => {
    editorRuntimeRef.current = editor || null;
  }, [editor]);

  const safeFocus = useCallback((delayMs = 0) => {
    if (!editor) return;
    const run = () => {
      if (!editor || (editor as any).isDestroyed) return;
      try {
        // Prefer native view focus to avoid dispatching a transaction in unstable windows.
        editor.view?.focus();
      } catch {
        try {
          editor.commands.focus();
        } catch {
          // no-op: avoid crashing caller effects
        }
      }
    };

    const schedule = () => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    };

    if (delayMs > 0) {
      setTimeout(schedule, delayMs);
    } else {
      schedule();
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    clear: () => {
      editor?.commands.clearContent();
    },
    getText: () => editor?.getText() || '',
    getHTML: () => editor?.getHTML() || '',
    getMarkdown: () => getMarkdownWithImageLocalPaths(),
    focus: () => {
      safeFocus();
    },
    isEmpty: () => {
      if (!editor) return true;
      return editor.isEmpty;
    },
    setFullscreen: (value: boolean) => {
      setIsFullscreen(value);
      if (value) {
        safeFocus(100);
      }
    },
    setContent: (content: string) => {
      if (editor) {
        editor.commands.setContent(content, { contentType: 'markdown' });
      }
    },
  }), [editor, safeFocus]);

  const editorWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !editorWrapperRef.current) return;

    const wrapper = editorWrapperRef.current;
    const shouldTreatEnterAsImeConfirm = (event: KeyboardEvent) => {
      const keyCode = event.keyCode || (event as any).which || 0;
      if (event.isComposing) return true;
      if (isComposingRef.current) return true;
      if (keyCode === 229) return true;
      // Some macOS IMEs dispatch Enter right after compositionend.
      if (Date.now() - lastCompositionEndAtRef.current < 80) return true;
      return false;
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      lastCompositionEndAtRef.current = Date.now();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldTreatEnterAsImeConfirm(event)) return;
      if (event.key === 'Enter') {
        event.preventDefault();

        if (isFullscreen) {
          if (event.shiftKey) {
            const markdown = editor.getMarkdown().trim();
            const markdownWithPaths = getMarkdownWithImageLocalPaths().trim();
            if (markdownWithPaths && onEnterRef.current) {
              onEnterRef.current(markdownWithPaths);
            }
          } else {
            editor.commands.setHardBreak();
          }
        } else {
          if (!event.shiftKey) {
            const markdownWithPaths = getMarkdownWithImageLocalPaths().trim();
            if (markdownWithPaths && onEnterRef.current) {
              onEnterRef.current(markdownWithPaths);
            }
          } else {
            editor.commands.setHardBreak();
          }
        }
        return false;
      }
    };

    wrapper.addEventListener('compositionstart', handleCompositionStart);
    wrapper.addEventListener('compositionend', handleCompositionEnd);
    wrapper.addEventListener('keydown', handleKeyDown);
    return () => {
      wrapper.removeEventListener('compositionstart', handleCompositionStart);
      wrapper.removeEventListener('compositionend', handleCompositionEnd);
      wrapper.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, getMarkdownWithImageLocalPaths, isFullscreen]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    if (content === editor.getMarkdown()) return;
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    if (autoFocus && editor) {
      safeFocus();
    }
  }, [autoFocus, editor, safeFocus]);

  useEffect(() => {
    if (isFullscreen && editor) {
      safeFocus(150);
    }
  }, [isFullscreen, editor, safeFocus]);

  if (!editor) {
    return null;
  }

  const charCount = editor.storage.characterCount.characters();
  const isNearLimit = charCount > maxLength * 0.9;

  if (isFullscreen) {
    const fullscreenContent = (
      <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
        <div className="flex-1 flex flex-col p-4 md:p-6">
          <div className="flex-1 flex flex-col rounded-xl md:rounded-2xl border border-input bg-background overflow-hidden shadow-2xl">
            <div className="px-4 md:px-6 py-3 md:py-4 border-b bg-muted/50 flex items-center justify-between">
              <span className="font-medium">全屏编辑</span>
              <div className="flex items-center gap-3 md:gap-4">
                <span className="text-xs md:text-sm text-muted-foreground hidden sm:block">Enter 换行 · Shift+Enter 发送</span>
                <Button size="sm" variant="outline" onClick={() => setIsFullscreen(false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>close_fullscreen</span>
                  <span className="hidden sm:inline">退出全屏</span>
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4 md:p-6">
              {showToolbar && <MenuBar editor={editor} />}
              <EditorContent editor={editor} className="outline-none h-full [&_.ProseMirror]:!outline-none [&_.ProseMirror]:!min-h-[300px] [&_.ProseMirror]:focus:!outline-none [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-3 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-primary/50 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-border [&_.ProseMirror_img]:my-3 [&_.ProseMirror_img]:max-h-[300px] [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-md [&_.ProseMirror_img]:border [&_.ProseMirror_img]:border-border [&_.ProseMirror_img]:object-contain" />
            </div>
          </div>
        </div>
      </div>
    );
    if (typeof document !== 'undefined') {
      return createPortal(fullscreenContent, document.body);
    }
    return null;
  }

  return (
    <div ref={editorContainerRef} className={`relative ${className}`}>
      <div ref={editorWrapperRef} className="overflow-hidden rounded-lg border border-input bg-background" style={{ maxHeight: `${maxHeight}px`, minHeight: `${minHeight}px` }}>
        <div className="px-2 py-1.5 flex items-start gap-1">
          <div className="flex-1 min-h-[32px] overflow-y-auto">
            {showToolbar && <MenuBar editor={editor} />}
            <EditorContent editor={editor} className="outline-none [&_.ProseMirror]:!outline-none [&_.ProseMirror:focus]:!outline-none [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-2 [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-primary/50 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_hr]:my-3 [&_.ProseMirror_hr]:border-border [&_.ProseMirror_img]:my-2 [&_.ProseMirror_img]:max-h-36 [&_.ProseMirror_img]:max-w-[260px] [&_.ProseMirror_img]:rounded-md [&_.ProseMirror_img]:border [&_.ProseMirror_img]:border-border [&_.ProseMirror_img]:object-contain" style={{ maxHeight: `${maxHeight - 16}px` }} />
          </div>
          {showFullscreenToggle && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 hover:opacity-100" onClick={() => setIsFullscreen(true)} title="全屏编辑">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_full</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5 px-1">
        <div className="min-w-0 flex items-center gap-2">
          {uploadingImages > 0 ? (
            <span className="text-[10px] text-muted-foreground">图片上传中...</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">Shift+Enter 换行</span>
          )}
        </div>
        <div className="min-w-0 flex items-center justify-end gap-2">
          {footerContent}
        {maxLength < 50000 && (
          <span className={`text-[10px] ${isNearLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
            {charCount}/{maxLength}
          </span>
        )}
        </div>
      </div>
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
