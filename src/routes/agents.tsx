import { createFileRoute } from '@tanstack/react-router';
import AgentsPage from '@/client/pages/AgentsPage';

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
});
