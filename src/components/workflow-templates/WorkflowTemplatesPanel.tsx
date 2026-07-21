'use client';

import WorkflowTemplateBrowser from './WorkflowTemplateBrowser';

export interface WorkflowTemplatesPanelProps {
  onInstantiated: (filename: string) => void;
}

export default function WorkflowTemplatesPanel({ onInstantiated }: WorkflowTemplatesPanelProps) {
  return <WorkflowTemplateBrowser onInstantiated={onInstantiated} />;
}
