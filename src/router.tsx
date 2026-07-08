import { createRouter } from '@tanstack/react-router';
import { getBasePath, installBasePathFetchPatch } from './client/base-url';
import { routeTree } from './routeTree.gen';

installBasePathFetchPatch();

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: getBasePath() || '/',
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
