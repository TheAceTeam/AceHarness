'use client';

import Link from '@/lib/navigation/client';
import AuthGuard from '@/components/AuthGuard';
import ChannelIntegrationsContent from '@/components/settings/ChannelIntegrationsContent';
import { Button } from '@/components/ui/button';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft } from 'lucide-react';

function ChannelSettingsPageContent() {
  useDocumentTitle('Channel Integrations');
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'Channel Integrations',
    subtitle: 'OPERATE 集成管理：Webhook、桥接器、会话绑定和测试发送',
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
        <header className="sticky top-0 z-50 border-b border-border bg-card">
          <div className="container mx-auto px-6 py-4 flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回仪表盘</Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-xl font-semibold">Channel Integrations</h1>
              <p className="text-sm text-muted-foreground mt-1">OPERATE 集成管理页，保留 /account/channels 入口。</p>
            </div>
          </div>
        </header>
      ) : null}

      <main className={isDashboardShell ? '' : 'container mx-auto max-w-7xl px-6 py-8'}>
        <ChannelIntegrationsContent />
      </main>
    </div>
  );
}

export default function ChannelSettingsPage() {
  return <AuthGuard><ChannelSettingsPageContent /></AuthGuard>;
}
