import { describe, expect, test } from 'vitest';
import {
  forgetRemoteCredentials,
  getRemoteCredentials,
  putRemoteCredentials,
} from '@/lib/core/remote-credential-vault';
import { normalizeRemoteWorkspaceUrl } from '@/lib/core/remote-workspace';

function expectMissingCredential(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ status: 428 });
    return;
  }
  throw new Error('expected missing credential error');
}

describe('remote credential vault', () => {
  test('keeps credentials isolated per user and workspace', () => {
    const workspace = 'sftp://alice:secret@192.168.1.20:22/home/project?passphrase=hidden';
    putRemoteCredentials({
      userId: 'user-a',
      workspace,
      credentials: { username: 'alice', password: 'secret' },
    });

    expect(getRemoteCredentials({ userId: 'user-a', workspace })).toMatchObject({
      username: 'alice',
      password: 'secret',
    });

    expectMissingCredential(() => getRemoteCredentials({ userId: 'user-b', workspace }));

    forgetRemoteCredentials({ userId: 'user-a', workspace });
    expectMissingCredential(() => getRemoteCredentials({ userId: 'user-a', workspace }));
  });

  test('normalizes remote workspace URLs without embedded secrets', () => {
    expect(normalizeRemoteWorkspaceUrl('sftp://alice:secret@192.168.1.20:22/home/project?passphrase=hidden&timeoutMs=1000')).toBe(
      'sftp://alice@192.168.1.20:22/home/project?timeoutMs=1000',
    );
  });
});
