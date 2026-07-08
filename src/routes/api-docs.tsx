import { createFileRoute } from '@tanstack/react-router';
import ApiDocsPage from '@/client/pages/ApiDocsPage';

export const Route = createFileRoute('/api-docs')({
  component: ApiDocsPage,
});
