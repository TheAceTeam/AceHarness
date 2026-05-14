/**
 * Persistence Capability Implementation
 *
 * Provides scoped read/write access to plugin state within sessionWorkbenchState.
 */

import type { PersistenceCapability } from './types';
import type { CollaborationRoomState } from '@/lib/core/home-sidebar-state';

export function createPersistenceCapability(
  pluginId: string,
  getWorkbenchState: () => any,
  setWorkbenchState: (updater: (prev: any) => any) => void,
): PersistenceCapability {
  return {
    get<T>(key?: string): T | undefined {
      const state = getWorkbenchState();
      const pluginState = state?.plugins?.[pluginId];
      if (!key) return pluginState as T | undefined;
      return pluginState?.[key] as T | undefined;
    },
    set<T>(updater: (prev: T | undefined) => T, key?: string) {
      setWorkbenchState((prev: any) => {
        const plugins = prev?.plugins || {};
        const pluginState = plugins[pluginId];
        if (key) {
          return {
            ...prev,
            plugins: {
              ...plugins,
              [pluginId]: {
                ...pluginState,
                [key]: updater(pluginState?.[key]),
              },
            },
          };
        }
        return {
          ...prev,
          plugins: {
            ...plugins,
            [pluginId]: updater(pluginState),
          },
        };
      });
    },
    getRoom(): CollaborationRoomState | undefined {
      return getWorkbenchState()?.collaborationRoom;
    },
    updateRoom(updater: (room: CollaborationRoomState) => CollaborationRoomState) {
      setWorkbenchState((prev: any) => ({
        ...prev,
        collaborationRoom: updater(prev?.collaborationRoom || { messages: [], rounds: [] }),
      }));
    },
  };
}
