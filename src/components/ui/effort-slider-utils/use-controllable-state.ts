import * as React from 'react';
export function useControllableState<T>({ value, defaultValue, onChange }: { value?: T; defaultValue: T; onChange?: (value: T) => void }) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value === undefined ? internal : value;
  const latest = React.useRef(current);
  latest.current = current;
  const set = (update: React.SetStateAction<T>) => {
    const next = typeof update === 'function' ? (update as (previous: T) => T)(latest.current) : update;
    if (Object.is(next, latest.current)) return;
    latest.current = next;
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  return [current, set] as const;
}
