export type RuntimeToolStatus = 'running' | 'completed' | 'failed';

export type RuntimeToolChange = {
  filePath?: string;
  kind?: string;
  changedLines?: number;
  addedLines?: number;
  removedLines?: number;
};

/**
 * A structured projection of an adapter tool event. It keeps the tool's
 * standard output and error output in the tool channel, never in the agent
 * message channel.
 */
export type RuntimeToolEvent = {
  id: string;
  toolName: string;
  title: string;
  status: RuntimeToolStatus;
  /** First observed lifecycle timestamp. Keeps an inline card anchored in the transcript. */
  createdAt?: string;
  updatedAt?: string;
  input?: {
    command?: string;
    filePath?: string;
    path?: string;
    pattern?: string;
    include?: string;
    url?: string;
    query?: string;
    name?: string;
    changes?: RuntimeToolChange[];
  };
  result?: {
    exitCode?: number;
    filePath?: string;
    changes?: RuntimeToolChange[];
    output?: unknown;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
};

export function mergeRuntimeToolEvents(
  current: readonly RuntimeToolEvent[],
  incoming: RuntimeToolEvent,
): RuntimeToolEvent[] {
  const index = current.findIndex((event) => event.id === incoming.id);
  if (index < 0) return [...current, incoming];

  const previous = current[index];
  const previousIsTerminal = previous.status === 'completed' || previous.status === 'failed';
  const incomingIsTerminal = incoming.status === 'completed' || incoming.status === 'failed';
  const next = {
    ...previous,
    ...incoming,
    // A terminal update belongs to the original call position, not to the
    // point where its result arrived.
    createdAt: previous.createdAt || incoming.createdAt,
    // Replayed or delayed running updates must not turn a finished card back
    // into a permanently running one.
    status: previousIsTerminal && !incomingIsTerminal ? previous.status : incoming.status,
    input: { ...previous.input, ...incoming.input },
    result: { ...previous.result, ...incoming.result },
  };
  return current.map((event, eventIndex) => (eventIndex === index ? next : event));
}
