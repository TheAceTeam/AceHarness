import { createFileRoute } from '@tanstack/react-router';
import LoginPage from '@/client/pages/LoginPage';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});
