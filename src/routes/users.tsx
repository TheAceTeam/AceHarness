import { createFileRoute } from '@tanstack/react-router';
import UsersPage from '@/client/pages/UsersPage';

export const Route = createFileRoute('/users')({
  component: UsersPage,
});
