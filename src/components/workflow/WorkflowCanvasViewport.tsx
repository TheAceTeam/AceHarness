'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function WorkflowCanvasViewport({ fullscreen, onExit, children }: {
  fullscreen: boolean;
  onExit: () => void;
  children: ReactNode;
}) {
  if (!fullscreen) return children;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onExit(); }}>
      <DialogContent fullscreen aria-describedby={undefined}>
        <DialogTitle className="sr-only">工作流编排画布</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
