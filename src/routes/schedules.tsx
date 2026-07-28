import { createFileRoute } from '@tanstack/react-router';
import SchedulesPage from '@/client/pages/SchedulesPage';

export const Route = createFileRoute('/schedules')({
  component: SchedulesPage,
});
