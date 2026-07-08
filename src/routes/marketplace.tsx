import { createFileRoute } from '@tanstack/react-router';
import MarketplacePage from '@/client/pages/MarketplacePage';

export const Route = createFileRoute('/marketplace')({
  component: MarketplacePage,
});
