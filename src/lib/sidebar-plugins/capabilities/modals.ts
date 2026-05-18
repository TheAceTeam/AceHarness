/**
 * Modals Capability Implementation
 *
 * Manages modal registration, opening, and closing.
 */

import type { ModalsCapability } from './types';

export function createModalsCapability(
  openModal: (modalId: string, props?: Record<string, any>) => void,
  closeModal: (modalId: string) => void,
  registerModal: (modalId: string, component: React.ComponentType<any>) => void,
): ModalsCapability {
  return {
    open(modalId: string, props?: Record<string, any>) {
      openModal(modalId, props);
    },
    close(modalId: string) {
      closeModal(modalId);
    },
    register(modalId: string, component: React.ComponentType<any>) {
      registerModal(modalId, component);
    },
  };
}
