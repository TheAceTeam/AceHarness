'use client';

import {
  Terminal,
  TerminalHeader,
  TerminalTitle,
  TerminalActions,
  TerminalCopyButton,
  TerminalContent,
} from '@/components/ai-elements/terminal';

export function AnsiLogBlock({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  return (
    <Terminal output={text || ''} className={className}>
      <TerminalHeader>
        <TerminalTitle>日志</TerminalTitle>
        <TerminalActions>
          <TerminalCopyButton />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-96 text-[12px] leading-5" />
    </Terminal>
  );
}
