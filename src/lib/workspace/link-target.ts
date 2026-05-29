const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[a-zA-Z]:\//;
const UNC_ABSOLUTE_PATH = /^\/\/[^/]+\/[^/]+/;

function normalizeWorkspacePathValue(value: string | null | undefined): string {
  return String(value || "").replace(/\\/g, "/").trim();
}

export type WorkspaceFileLocation = {
  path: string;
  lineNumber: number | null;
  column: number | null;
};

function isWorkspaceAbsolutePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATH.test(value) || UNC_ABSOLUTE_PATH.test(value);
}

function toPositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseWorkspaceFileLocation(value: string | null | undefined): WorkspaceFileLocation {
  const normalized = normalizeWorkspacePathValue(value);
  if (!normalized) {
    return { path: "", lineNumber: null, column: null };
  }

  const hashMatch = normalized.match(/^(.*)#L?([1-9]\d*)(?::([1-9]\d*))?$/i);
  if (hashMatch?.[1]) {
    return {
      path: hashMatch[1],
      lineNumber: toPositiveInteger(hashMatch[2]),
      column: toPositiveInteger(hashMatch[3]),
    };
  }

  const colonMatch = normalized.match(/^(.+?):([1-9]\d*)(?::([1-9]\d*))?$/);
  if (!colonMatch?.[1]) {
    return { path: normalized, lineNumber: null, column: null };
  }

  return {
    path: colonMatch[1],
    lineNumber: toPositiveInteger(colonMatch[2]),
    column: toPositiveInteger(colonMatch[3]),
  };
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
  lineNumber: number | null;
  column: number | null;
} {
  const currentWorkspacePath = normalizeWorkspacePathValue(payload.currentWorkspacePath).replace(/\/+$/g, "");
  const linkWorkspacePath = normalizeWorkspacePathValue(payload.linkWorkspacePath).replace(/\/+$/g, "");
  const absoluteLocation = parseWorkspaceFileLocation(payload.absolutePath);
  const fileLocation = parseWorkspaceFileLocation(payload.filePath);
  const absolutePath = absoluteLocation.path;
  const filePath = fileLocation.path;
  const lineNumber = absoluteLocation.lineNumber ?? fileLocation.lineNumber;
  const column = absoluteLocation.column ?? fileLocation.column;
  const relativePathInCurrentWorkspace = currentWorkspacePath && absolutePath
    ? resolveWorkspaceSelectionCandidate(currentWorkspacePath, absolutePath)
    : null;

  if (currentWorkspacePath && absolutePath && relativePathInCurrentWorkspace) {
    return {
      workspacePath: currentWorkspacePath,
      initialFilePath: absolutePath,
      lineNumber,
      column,
    };
  }

  return {
    workspacePath: linkWorkspacePath || currentWorkspacePath,
    initialFilePath: filePath || absolutePath || null,
    lineNumber,
    column,
  };
}
