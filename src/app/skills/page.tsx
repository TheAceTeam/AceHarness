'use client';

import SkillsManager from '@/components/skills/SkillsManager';
import { useSearchParams } from 'next/navigation';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';

export default function SkillsPage() {
  const searchParams = useSearchParams();
  return <SkillsManager returnTarget={getOfficeAwareReturnTarget(searchParams.get('from'))} />;
}
