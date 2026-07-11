import type { StateMachineState } from '@/lib/core/schemas';

export function renameStateAndReferences(
  states: StateMachineState[],
  previousName: string,
  nextName: string,
): StateMachineState[] {
  if (previousName === nextName) return states;
  return states.map((state) => ({
    ...state,
    name: state.name === previousName ? nextName : state.name,
    transitions: (state.transitions || []).map((transition) => (
      transition.to === previousName
        ? { ...transition, to: nextName }
        : transition
    )),
  }));
}
