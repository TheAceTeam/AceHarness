/**
 * Commander Panel Types
 *
 * The CommanderPanelContext bundles all state and callbacks needed by the
 * commander tab. Uses a loose type to avoid maintaining 100+ field signatures
 * that mirror the parent component's internal types.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CommanderPanelContext {
  [key: string]: any;
}
