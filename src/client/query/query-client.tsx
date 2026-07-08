import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

function createAceQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = error instanceof ApiError ? error.status : undefined;
          if (status === 401 || status === 403 || status === 404) {
            return false;
          }
          return failureCount < 2;
        },
        staleTime: 10_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function AceQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createAceQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
