import { createFileRoute } from '@tanstack/react-router';
import SkillsPage from '@/client/pages/SkillsPage';

export const Route = createFileRoute('/skills')({
  component: SkillsPage,
});
