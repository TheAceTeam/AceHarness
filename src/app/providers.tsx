'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/ui/toast';

const OnboardingPortal = dynamic(() => import('@/components/onboarding/OnboardingPortal'), {
  ssr: false,
  loading: () => null,
});

// 动态导入 ChatModalWrapper 避免阻塞首屏
const ChatModalWrapper = dynamic(() => import('@/components/ChatModalWrapper'), {
  ssr: false,
  loading: () => null,
});

// 动态导入 ChatProvider - 登录页不需要聊天功能
const ChatProvider = dynamic(() => import('@/contexts/ChatContext').then(m => m.ChatProvider), {
  ssr: false,
  loading: () => null,
});

// 登录页不需要 ChatProvider
const NO_CHAT_PATHS = ['/login', '/setup'];

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isNoChatPage = NO_CHAT_PATHS.some(p => pathname?.startsWith(p));
  const isChatLikePage = pathname === '/' || pathname === '/chat';

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <div className="sci-fi-grid" aria-hidden="true" />
      <div className="siri-glow" aria-hidden="true">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="orb orb-4" />
      </div>
      {isNoChatPage ? (
        <ToastProvider>
          {children}
        </ToastProvider>
      ) : (
        <ChatProvider>
          <ToastProvider>
            {children}
            {!isChatLikePage && (
              <>
                <OnboardingPortal />
                <ChatModalWrapper />
              </>
            )}
          </ToastProvider>
        </ChatProvider>
      )}
    </ThemeProvider>
  );
}
