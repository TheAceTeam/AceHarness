const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[a-zA-Z]:\//;
const UNC_ABSOLUTE_PATH = /^\/\/[^/]+\/[^/]+/;

function normalizeWorkspacePathValue(value: string | null | undefined): string {
  return String(value || "").replace(/\\/g, "/").trim();
}

function isWorkspaceAbsolutePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATH.test(value) || UNC_ABSOLUTE_PATH.test(value);
}

function resolveWorkspaceSelectionCandidate(
  workspacePath: string,
  candidatePath?: string | null,
): string | null {
  const normalizedWorkspace = normalizeWorkspacePathValue(workspacePath).replace(/\/+$/g, "");
  const normalizedCandidate = normalizeWorkspacePathValue(candidatePath)
    .replace(/^\.\//, "");

  if (!normalizedWorkspace || !normalizedCandidate) return null;
  if (normalizedCandidate === normalizedWorkspace) return null;

  if (!isWorkspaceAbsolutePath(normalizedCandidate)) {
    return normalizedCandidate.replace(/^\/+/, "") || null;
  }

  const compareAsCaseInsensitive = WINDOWS_DRIVE_ABSOLUTE_PATH.test(normalizedWorkspace)
    || UNC_ABSOLUTE_PATH.test(normalizedWorkspace);
  const comparableWorkspace = compareAsCaseInsensitive
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace;
  const comparableCandidate = compareAsCaseInsensitive
    ? normalizedCandidate.toLowerCase()
    : normalizedCandidate;

  if (!comparableCandidate.startsWith(`${comparableWorkspace}/`)) {
    return null;
  }

  return normalizedCandidate.slice(normalizedWorkspace.length + 1) || null;
}

export function resolveWorkspaceLinkTarget(payload: {
  currentWorkspacePath?: string | null;
  linkWorkspacePath?: string | null;
  absolutePath?: string | null;
  filePath?: string | null;
}): {
  workspacePath: string;
  initialFilePath: string | null;
} {
  const currentWorkspacePath = normalizeWorkspacePathValue(payload.currentWorkspacePath).replace(/\/+$/g, "");
  const linkWorkspacePath = normalizeWorkspacePathValue(payload.linkWorkspacePath).replace(/\/+$/g, "");
  const absolutePath = normalizeWorkspacePathValue(payload.absolutePath);
  const relativePathInCurrentWorkspace = currentWorkspacePath && absolutePath
    ? resolveWorkspaceSelectionCandidate(currentWorkspacePath, absolutePath)
    : null;

  if (currentWorkspacePath && absolutePath && relativePathInCurrentWorkspace) {
    return {
      workspacePath: currentWorkspacePath,
      initialFilePath: absolutePath,
    };
  }

  return {
    workspacePath: linkWorkspacePath || currentWorkspacePath,
    initialFilePath: payload.filePath || absolutePath || null,
  };
}
