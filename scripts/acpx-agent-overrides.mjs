const configuredCodegenieCommand = () => process.env.ACEH_CODEGENIE_COMMAND?.trim() || 'codegenie';

/**
 * ACPX accepts argv arrays as well as command strings. Arrays are required on
 * Windows because ACPX can resolve .cmd shims and launch them through cmd.exe.
 */
export function getAcpxAgentRegistryOverrides() {
  return {
    nga: ['ngagent', '--disable-update', 'acp'],
    codeagent: ['codeagent', 'acp'],
    codegenie: [configuredCodegenieCommand(), 'acp'],
  };
}
