# GitCode to GitHub mirror

GitCode is the only writable source of truth for this repository. GitHub is a
read-only mirror of GitCode's branches and tags.

## Behavior

- A merge into GitCode's `main` runs `.gitlab-ci.yml` and immediately mirrors
  every branch and tag to GitHub when `GITHUB_MIRROR_TOKEN` is configured.
- The GitHub workflow at `.github/workflows/sync-from-gitcode.yml` runs every
  15 minutes and repairs drift for every branch and tag, including branches
  that predate this configuration.
- A compatible webhook relay can send a `repository_dispatch` event with type
  `gitcode-sync` to run the GitHub workflow immediately after any GitCode push.
- The mirror uses force-updating, pruning refspecs. A branch or tag removed
  from GitCode is removed from GitHub on the next mirror run. Do not create
  GitHub-only branches or tags in this repository.

GitHub Issues, pull requests, releases, Actions secrets, and repository
settings are not Git refs and are not mirrored.

## One-time administrator setup

1. Create a dedicated GitHub machine account or GitHub App for this mirror.
   Grant it write access to `TheAceTeam/AceHarness`. Its fine-grained token
   needs `Contents: Read and write` for this repository. Grant workflow write
   permission as well, because the initial mirror updates `.github/workflows`.
2. Add the token as a masked, protected GitCode CI/CD variable named
   `GITHUB_MIRROR_TOKEN`. It must be available to the protected `main` branch.
3. Add the same token to GitHub Actions secrets as `GITHUB_MIRROR_TOKEN`.
   The workflow falls back to `github.token`, but a dedicated token is required
   when a GitHub ruleset does not allow `github-actions[bot]` to force-push.
4. In GitHub branch rulesets, prohibit direct writes for normal users and give
   only the mirror identity bypass and force-push permission. GitHub remains a
   destination, never a merge target.
5. Merge this change in GitCode. With the GitCode variable configured, the
   resulting `main` pipeline performs the first full branch/tag synchronization.
   Otherwise, run the GitHub `Sync from GitCode` workflow once to bootstrap the
   mirror, then confirm both mechanisms complete successfully.

Protect changes to `.gitlab-ci.yml` with maintainer review: the protected
GitCode job has access to the GitHub write token.

## Pull requests

Open and merge pull requests in GitCode. A merge is a push to `main`, so the
GitCode pipeline mirrors the merged commit immediately. Feature branches are
also picked up by the scheduled GitHub workflow. Do not merge GitHub pull
requests into this repository; their commits will be overwritten by the next
GitCode mirror run.
