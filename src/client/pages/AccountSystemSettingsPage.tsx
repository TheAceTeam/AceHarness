'use client';

import Link from '@/lib/navigation/client';
import { useSearchParams } from '@/lib/navigation/client';
import AuthGuard from '@/components/AuthGuard';
import SystemSettingsContent from '@/components/settings/SystemSettingsContent';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft } from 'lucide-react';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';

function SystemSettingsPageContent() {
  useDocumentTitle('系统设置');
  const searchParams = useSearchParams();
  const returnTarget = getOfficeAwareReturnTarget(searchParams.get('from'));

  return (
    <div className="min-h-screen bg-[#F7F7F4] dark:bg-[#0D0E14]">
      <div className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="container mx-auto flex items-center gap-4 px-6 py-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={returnTarget.href}><ArrowLeft className="w-4 h-4 mr-2" />{returnTarget.label}</Link>
          </Button>
        </div>
        <PageHeader
          className="container mx-auto border-b-0 bg-card px-6"
          eyebrow="SYSTEM"
          title="系统设置"
          subtitle="集中管理系统运行环境、SDK、Token、安全通知和 CLI 配置。"
          status={<StatusPill tone="accent">Runtime</StatusPill>}
        />
      </div>

      <main className="container mx-auto max-w-5xl px-6 py-8">
        <SystemSettingsContent />
      </main>
    </div>
  );
}

export default function SystemSettingsPage() {
  return <AuthGuard><SystemSettingsPageContent /></AuthGuard>;
}
