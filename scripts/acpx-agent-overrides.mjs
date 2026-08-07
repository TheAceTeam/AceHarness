const configuredCodegenieCommand = () => process.env.ACEH_CODEGENIE_COMMAND?.trim() || 'codegenie';

const quoteCommandPart = (part) => /[\s"'`]/u.test(part)
  ? `"${part.replace(/(["\\])/gu, '\\$1')}"`
  : part;

/**
 * acpx 0.13 accepts command strings and resolves Windows .cmd shims itself.
 * Keep this helper aligned with the runtime package locked by ACEHarness.
 */
export function getAcpxAgentRegistryOverrides() {
  return {
    nga: 'ngagent --disable-update acp',
    codeagent: 'codeagent acp',
    codegenie: `${quoteCommandPart(configuredCodegenieCommand())} acp`,
  };
}
