import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';

export type AgoraTopicExtensionAction = {
  id: string;
  label: string;
  icon: string;
  title?: string;
  createTopic: () => {
    title: string;
    sessionWorkbenchState: SessionWorkbenchState;
  };
};

type AgoraExtensionModule = {
  topicActions?: readonly AgoraTopicExtensionAction[];
};

const modules: AgoraExtensionModule[] = [];

export function getAgoraTopicExtensionActions(): AgoraTopicExtensionAction[] {
  return modules.flatMap((module) => module.topicActions || []);
}
