'use client';

import { usePathname } from 'next/navigation';
import ChatModal from '@/components/ChatModal';

export default function ChatModalWrapper() {
  const pathname = usePathname();
  // Hide the floating chat modal on dedicated chat-like pages
  if (pathname === '/' || pathname === '/chat') return null;
  return <ChatModal />;
}
