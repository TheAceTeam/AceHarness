import type { ButtonHTMLAttributes, ReactNode } from 'react';

type MutationButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: ReactNode;
  error?: unknown;
  errorLabel?: ReactNode;
  errorClassName?: string;
};

export function MutationButton({
  pending,
  pendingLabel,
  error,
  errorLabel,
  errorClassName = 'text-xs text-destructive',
  disabled,
  children,
  ...props
}: MutationButtonProps) {
  const errorMessage = getErrorMessage(error);

  return (
    <>
      <button
        {...props}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        aria-invalid={errorMessage ? true : undefined}
        data-pending={pending ? 'true' : undefined}
        data-error={errorMessage ? 'true' : undefined}
      >
        {pending ? pendingLabel ?? '处理中...' : children}
      </button>
      {errorMessage && (
        <span className={errorClassName} role="alert">
          {errorLabel ?? errorMessage}
        </span>
      )}
    </>
  );
}

function getErrorMessage(error: unknown) {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '操作失败';
}
