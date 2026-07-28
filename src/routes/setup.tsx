import { createFileRoute } from '@tanstack/react-router';
import SetupPage from '@/client/pages/SetupPage';

export const Route = createFileRoute('/setup')({
  component: SetupPage,
});
