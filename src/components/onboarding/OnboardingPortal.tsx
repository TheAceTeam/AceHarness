'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { StoryOnboarding } from '@/components/onboarding/StoryOnboarding';
import { Button } from '@/components/ui/button';
import { useChat } from '@/contexts/ChatContext';

type Role = 'admin' | 'user';
type ProgressPayload = {
  done: boolean;
  phase: 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done';
  introIndex: number;
  selectedModule: any;
  moduleStepIndex: number;
  visitedModules: any[];
  memberChecks: {
    homeGuideDone: boolean;
    engineModelDone: boolean;
    notebookDone: boolean;
    personalDirConfirm: boolean;
  };
  adminChecks: {
    engineReady: boolean;
    defaultModel: boolean;
    agentGroup: boolean;
    personalDirReady: boolean;
  };
  maximized: boolean;
};

export default function OnboardingPortal() {
  const pathname = usePathname();
  const { isOpen: chatOpen } = useChat();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);

  const getAuthToken = () => (typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null);

  const loadProgress = async () => {
    const token = getAuthToken();
    if (!token) return;
    setLoadingProgress(true);
    try {
      const res = await fetch('/api/onboarding/progress', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.role === 'admin' || data?.role === 'user') setRole(data.role);
      if (data?.progress) {
        setProgress(data.progress);
        setOpen(!data.progress.done);
      }
    } catch {
      // ignore
    } finally {
      setLoadingProgress(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem('auth-user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.role === 'admin') setRole('admin');
      } catch {
        // ignore
      }
    }
    void loadProgress();
  }, []);

  const persistProgress = async (nextProgress: ProgressPayload, options?: { markCompleted?: boolean }) => {
    setProgress(nextProgress);
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch('/api/onboarding/progress', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          progress: nextProgress,
          markCompleted: options?.markCompleted === true,
        }),
      });
    } catch {
      // ignore
    }
  };

  const openWithRefresh = async () => {
    await loadProgress();
    setOpen(true);
  };

  if (pathname === '/' || pathname === '/chat') {
    return null;
  }

  return (
    <>
      {!open && (
        <div className={`fixed bottom-6 z-[50] transition-all ${chatOpen ? 'right-[420px]' : 'right-24'}`}>
          <Button
            className="w-14 h-14 rounded-full shadow-lg"
            variant="outline"
            onClick={() => {
              void openWithRefresh();
            }}
            title="打开新手引导"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>school</span>
          </Button>
        </div>
      )}
      <StoryOnboarding
        open={open}
        role={role}
        initialProgress={progress}
        loadingProgress={loadingProgress}
        onPersist={persistProgress}
        onClose={(completed) => {
          if (completed && progress) {
            void persistProgress({ ...progress, done: true, phase: 'done' }, { markCompleted: true });
          }
          setOpen(false);
        }}
      />
    </>
  );
}
