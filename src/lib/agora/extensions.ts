import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import werewolfAgoraExtension from '@/plugins/werewolf';

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

const modules: AgoraExtensionModule[] = [
  werewolfAgoraExtension as AgoraExtensionModule,
];

export function getAgoraTopicExtensionActions(): AgoraTopicExtensionAction[] {
  return modules.flatMap((module) => module.topicActions || []);
}
