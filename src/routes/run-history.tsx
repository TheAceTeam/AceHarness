import { createFileRoute } from '@tanstack/react-router';
import RunHistoryPage from '@/client/pages/RunHistoryPage';

export const Route = createFileRoute('/run-history')({
  component: RunHistoryPage,
});
