const configuredCodegenieCommand = () => process.env.ACEH_CODEGENIE_COMMAND?.trim() || 'codegenie';

/**
 * argv arrays, not command strings: acpx only derives `agentArgv` from the array
 * form, and win32 rejects raw agent command strings outright. Keep in sync with
 * getAcpxAgentRegistryOverrides in src/lib/runtime-agent/adapters/acpx-adapter.ts.
 *
 * These are bare names — unlike the TypeScript side, this script cannot reach the
 * configured search paths, so a CLI installed outside the process PATH is reported
 * unavailable here even though the runtime can launch it.
 */
export function getAcpxAgentRegistryOverrides() {
  return {
    nga: ['ngagent', '--disable-update', 'acp'],
    codeagent: ['codeagent', 'acp'],
    codegenie: [configuredCodegenieCommand(), 'acp'],
  };
}
