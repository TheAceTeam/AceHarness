import { createFileRoute } from '@tanstack/react-router';
import ChannelSettingsPage from '@/client/pages/AccountChannelsPage';

export const Route = createFileRoute('/account/channels')({
  component: ChannelSettingsPage,
});
