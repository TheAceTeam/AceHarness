import { createFileRoute } from '@tanstack/react-router';
import ResetPasswordPage from '@/client/pages/LoginResetPage';

export const Route = createFileRoute('/login/reset')({
  component: ResetPasswordPage,
});
