import { createFileRoute, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import WorkbenchClient from '@/client/pages/workbench/WorkbenchClient';

export const Route = createFileRoute('/workbench/$config')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: WorkbenchRoute,
});

function WorkbenchRoute() {
  const { config } = useParams({ from: '/workbench/$config' });
  const search = useSearch({ from: '/workbench/$config' });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        正在加载工作台...
      </div>
    );
  }

  return (
    <WorkbenchClient
      embeddedConfig={config}
      embeddedSearch={new URLSearchParams(
        Object.entries(search).reduce<Record<string, string>>((params, [key, value]) => {
          if (value !== undefined && value !== null) params[key] = String(value);
          return params;
        }, {}),
      ).toString()}
    />
  );
}
