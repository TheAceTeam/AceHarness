/**
 * Commander Panel Types
 *
 * The CommanderPanelContext bundles all state and callbacks needed by the
 * commander tab. Uses a loose type to avoid maintaining 100+ field signatures
 * that mirror the parent component's internal types.
 */

export type CommanderPanelContext = Record<string, any>;
