'use client';

import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ChannelIntegrationsContent from '@/components/settings/ChannelIntegrationsContent';
import { Button } from '@/components/ui/button';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft } from 'lucide-react';

function ChannelSettingsPageContent() {
  useDocumentTitle('微信接入');
  const { isDashboardShell } = useDashboardShellHeader({
    title: '微信接入',
    subtitle: '生成地址、接桥接器并在线测试工作流运行时消息',
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
        <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
          <div className="container mx-auto px-6 py-4 flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回仪表盘</Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-2xl font-bold">微信接入</h1>
              <p className="text-sm text-muted-foreground mt-1">生成地址、接桥接器并在线测试工作流运行时消息。</p>
            </div>
          </div>
        </header>
      ) : null}

      <main className="container mx-auto max-w-6xl px-6 py-8">
        <ChannelIntegrationsContent />
      </main>
    </div>
  );
}

export default function ChannelSettingsPage() {
  return <AuthGuard><ChannelSettingsPageContent /></AuthGuard>;
}
