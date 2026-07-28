import { createFileRoute } from '@tanstack/react-router';
import KnowledgePage from '@/client/pages/KnowledgePage';

export const Route = createFileRoute('/knowledge')({
  component: KnowledgePage,
});
