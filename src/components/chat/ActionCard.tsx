'use client';

import { ActionState, RISK_MAP } from '@/lib/chat/actions';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/navigation/client';
import ResultRenderer from './ResultRenderer';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from '@/components/ai-elements/tool';
import type { ToolPart } from '@/components/ai-elements/tool';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';

/** Map ACEHarness ActionState.status → ai-elements ToolPart['state'] */
function toToolState(status: ActionState['status']): ToolPart['state'] {
  switch (status) {
    case 'pending': return 'approval-requested';
    case 'executing':
    case 'auto_executing': return 'input-available';
    case 'success': return 'output-available';
    case 'error': return 'output-error';
    case 'undone': return 'approval-responded';
    default: return 'input-streaming';
  }
}

interface ActionCardProps {
  action: ActionState;
  onConfirm: () => void;
  onReject: () => void;
  onUndo: () => void;
  onRetry: () => void;
  onReloadResult?: () => void;
  onAction?: (prompt: string) => void;
}

export default function ActionCard({ action, onConfirm, onReject, onUndo, onRetry, onReloadResult, onAction }: ActionCardProps) {
  const router = useRouter();
  const risk = RISK_MAP[action.action.type];

  // Handle navigate result
  if (action.status === 'success' && action.action.type === 'navigate' && action.result?.url) {
    return (
      <div className="border rounded-lg p-3 bg-muted/30 my-2">
        <div className="flex items-center gap-2 text-sm text-green-500 mb-2">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <span>{action.action.description}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push(action.result.url)}>
          <span className="material-symbols-outlined text-sm mr-1">open_in_new</span>
          跳转到 {action.result.url}
        </Button>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-3 my-2 ${
      action.status === 'success' ? 'border-green-500/30 bg-green-500/5' :
      action.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
      action.status === 'undone' ? 'border-yellow-500/30 bg-yellow-500/5' :
      'border-border bg-muted/30'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 text-sm mb-1">
        {action.status === 'pending' && (
          <span className="material-symbols-outlined text-base text-yellow-500">pending</span>
        )}
        {(action.status === 'executing' || action.status === 'auto_executing') && (
          <svg className="animate-spin w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {action.status === 'success' && (
          <span className="material-symbols-outlined text-base text-green-500">check_circle</span>
        )}
        {action.status === 'error' && (
          <span className="material-symbols-outlined text-base text-red-500">error</span>
        )}
        {action.status === 'undone' && (
          <span className="material-symbols-outlined text-base text-yellow-500">undo</span>
        )}
        <span className="font-medium">{action.action.description}</span>
        <span className="text-xs text-muted-foreground ml-auto">{action.action.type}</span>
      </div>

      {/* Error message */}
      {action.status === 'error' && action.error && (
        <div className="text-xs text-red-500 mb-2 pl-6">{action.error}</div>
      )}

      {/* Result */}
      {action.status === 'success' && action.result && (
        <div className="pl-6">
          <ResultRenderer type={action.action.type} result={action.result} onAction={onAction} onReloadResult={onReloadResult} />
        </div>
      )}

      {/* Undone notice */}
      {action.status === 'undone' && (
        <div className="text-xs text-yellow-600 pl-6">已撤销</div>
      )}

      {/* Pending: Confirmation component */}
      {action.status === 'pending' && (
        <Confirmation
          state="approval-requested"
          approval={{ id: action.action.type }}
          className="mt-2"
        >
          <ConfirmationTitle>确认执行 {action.action.description}</ConfirmationTitle>
          <ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction variant="outline" onClick={onReject}>
                拒绝
              </ConfirmationAction>
              <ConfirmationAction onClick={onConfirm}>
                确认执行
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
        </Confirmation>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-2 pl-6">
        {action.status === 'success' && action.snapshot && (
          <Button size="sm" variant="ghost" onClick={onUndo}>
            <span className="material-symbols-outlined text-sm mr-1">undo</span>
            撤销
          </Button>
        )}
        {action.status === 'error' && action.error !== '用户已拒绝' && (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <span className="material-symbols-outlined text-sm mr-1">refresh</span>
            重试
          </Button>
        )}
      </div>
    </div>
  );
}
