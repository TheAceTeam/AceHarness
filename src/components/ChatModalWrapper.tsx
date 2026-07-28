'use client';

import { startTransition, useEffect, useState } from 'react';
import { usePathname } from '@/lib/navigation/client';
import ChatModal from '@/components/ChatModal';

export default function ChatModalWrapper() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    startTransition(() => {
      setMounted(true);
    });
  }, []);

  if (!mounted) return null;

  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const isDashboardShell = pathname === '/' && (params.has('panel') || params.has('route'));
  // Hide the floating chat modal on dedicated chat-like pages
  if ((pathname === '/' && !isDashboardShell) || pathname === '/chat') return null;
  return <ChatModal />;
}
