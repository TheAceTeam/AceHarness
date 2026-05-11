'use client';

import { InstallProgress as InstallProgressType } from '@/types/marketplace';
import { INSTALL_STATUS_TEXT } from '@/constants/marketplace';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface InstallProgressProps {
  progress: InstallProgressType;
  onClose: () => void;
}

export function InstallProgress({ progress, onClose }: InstallProgressProps) {
  const isError = progress.status === 'error';
  const isSuccess = progress.status === 'success';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
      <div className="bg-card rounded-lg p-6 max-w-md w-full shadow-lg">
        <h3 className="text-lg font-semibold mb-4">
          安装 {progress.skillName}
        </h3>

        <div className="mb-4">
          <Progress value={progress.progress} className="h-2" />
        </div>

        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-muted-foreground">
            {INSTALL_STATUS_TEXT[progress.status]}
          </span>
          <span className="text-sm font-medium">
            {progress.progress}%
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {progress.message}
        </p>

        {(isError || isSuccess) && (
          <Button
            onClick={onClose}
            className="w-full"
            variant={isError ? 'destructive' : 'default'}
          >
            {isError ? '关闭' : '完成'}
          </Button>
        )}
      </div>
    </div>
  );
}