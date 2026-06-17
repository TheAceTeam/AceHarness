'use client';

import AgentsManager from '@/components/agents/AgentsManager';
import { useSearchParams } from 'next/navigation';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';

export default function AgentsPage() {
  const searchParams = useSearchParams();
  return <AgentsManager returnTarget={getOfficeAwareReturnTarget(searchParams.get('from'))} />;
}
