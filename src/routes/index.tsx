import { createFileRoute } from '@tanstack/react-router';
import DashboardPageShell from '@/components/dashboard/DashboardPageShell';

export const Route = createFileRoute('/')({
  component: DashboardPageShell,
});
