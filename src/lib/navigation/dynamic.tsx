'use client';

import React, { lazy, Suspense, useMemo } from 'react';

type Loader<TProps> = () => Promise<{ default: React.ComponentType<TProps> } | React.ComponentType<TProps>>;
type DynamicOptions<TProps> = {
  ssr?: boolean;
  loading?: React.ComponentType<TProps> | (() => React.ReactNode);
};

export default function dynamic<TProps extends object = Record<string, never>>(
  loader: Loader<TProps>,
  options: DynamicOptions<TProps> = {},
): React.ComponentType<any> {
  const DynamicComponent = React.forwardRef<any, any>((props, ref) => {
    const Component = useMemo(() => lazy(async () => {
      const loaded = await loader();
      if (typeof loaded === 'function') return { default: loaded };
      if (loaded && typeof loaded === 'object' && 'default' in loaded) {
        return loaded as { default: React.ComponentType<TProps> };
      }
      return { default: loaded as React.ComponentType<TProps> };
    }), []);
    const Loading = options.loading;
    const fallback = Loading ? React.createElement(Loading as React.ComponentType<any>, props) : null;
    if (options.ssr === false && typeof window === 'undefined') return fallback;
    return (
      <Suspense fallback={fallback}>
        {React.createElement(Component as React.ComponentType<any>, { ...props, ref })}
      </Suspense>
    );
  });
  DynamicComponent.displayName = 'DynamicComponent';
  return DynamicComponent;
}
