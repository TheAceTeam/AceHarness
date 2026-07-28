import { createFileRoute } from '@tanstack/react-router';
import SystemSettingsPage from '@/client/pages/AccountSystemSettingsPage';

export const Route = createFileRoute('/account/system-settings')({
  component: SystemSettingsPage,
});
