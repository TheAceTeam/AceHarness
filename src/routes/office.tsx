import { createFileRoute } from '@tanstack/react-router';
import OfficePage from '@/client/pages/OfficePage';

export const Route = createFileRoute('/office')({
  component: OfficePage,
});
