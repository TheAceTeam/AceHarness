# Workflow template packages

ACEHarness discovers versioned workflow template packages from two roots:

- Built in: `<install-root>/templates/workflows`
- Local: `<ACE_HOME>/templates/workflows` (defaults to `~/.aceharness/templates/workflows`)

Each immutable package uses this layout:

```text
<template-id>/<semantic-version>/
  manifest.yaml
  workflow.yaml
```

`manifest.yaml` uses `apiVersion: aceharness.io/v1alpha1` and `kind: WorkflowTemplate`.
Its `spec.parameters` entries bind typed values to `workflow.yaml` through JSON Pointer paths.
Template instances are validated and saved as independent workflow configs; later template versions do not mutate existing instances.

Local packages created through the UI also have ownership and visibility metadata in
`<ACE_HOME>/templates/workflows/.metadata.json`. Versions are immutable: publish a new semantic version instead of overwriting an existing package.
