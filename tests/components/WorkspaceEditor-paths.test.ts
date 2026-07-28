import { describe, expect, it } from "vitest"
import { resolveWorkspaceEditorTargetFile, treeCanResolvePath } from "@/components/workspace/WorkspaceEditor"
import type { TreeNode } from "@/lib/core/api"
import { parseWorkspaceFileLocation, resolveWorkspaceLinkTarget, resolveWorkspaceRootFromRoute } from "@/lib/workspace/link-target"

describe("treeCanResolvePath", () => {
  it("keeps deep files selectable while ancestor children are still unloaded", () => {
    const tree: TreeNode[] = [
      {
        name: ".android",
        path: ".android",
        type: "directory",
        children: [
          {
            name: "avd",
            path: ".android/avd",
            type: "directory",
            children: [
              {
                name: "Medium_Phone.avd",
                path: ".android/avd/Medium_Phone.avd",
                type: "directory",
              },
            ],
          },
        ],
      },
    ]

    expect(treeCanResolvePath(tree, ".android/avd/Medium_Phone.avd/config.ini")).toBe(true)
  })

  it("still rejects missing files when the tree has already loaded the full directory", () => {
    const tree: TreeNode[] = [
      {
        name: ".android",
        path: ".android",
        type: "directory",
        children: [
          {
            name: "avd",
            path: ".android/avd",
            type: "directory",
            children: [
              {
                name: "Medium_Phone.avd",
                path: ".android/avd/Medium_Phone.avd",
                type: "directory",
                children: [
                  {
                    name: "config.ini",
                    path: ".android/avd/Medium_Phone.avd/config.ini",
                    type: "file",
                  },
                ],
              },
            ],
          },
        ],
      },
    ]

    expect(treeCanResolvePath(tree, ".android/avd/Medium_Phone.avd/missing.ini")).toBe(false)
  })
})

describe("resolveWorkspaceEditorTargetFile", () => {
  it("prefers the requested initial absolute file over stale url state", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/project/docs/briefing.pptx",
      urlFilePath: "stale.md",
    })).toBe("docs/briefing.pptx")
  })

  it("keeps valid relative url selections inside the current workspace", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "/Users/shawn/project",
      urlFilePath: "docs/briefing.pptx",
    })).toBe("docs/briefing.pptx")
  })

  it("normalizes windows absolute paths case-insensitively", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "C:/Users/Shawn/project",
      initialFilePath: "c:/Users/Shawn/project/src/app.ts",
    })).toBe("src/app.ts")
  })

  it("strips line and column suffixes before selecting the workspace file", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/project/src/app.ts:42:7",
    })).toBe("src/app.ts")
  })

  it("rejects absolute files outside the current workspace", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/other/file.md",
      urlFilePath: "docs/briefing.pptx",
    })).toBe("docs/briefing.pptx")
  })
})

describe("parseWorkspaceFileLocation", () => {
  it("parses colon line and column suffixes", () => {
    expect(parseWorkspaceFileLocation("/Users/shawn/project/src/app.ts:42:7")).toEqual({
      path: "/Users/shawn/project/src/app.ts",
      lineNumber: 42,
      column: 7,
    })
  })

  it("parses hash line suffixes", () => {
    expect(parseWorkspaceFileLocation("/Users/shawn/project/src/app.ts#L42")).toEqual({
      path: "/Users/shawn/project/src/app.ts",
      lineNumber: 42,
      column: null,
    })
  })

  it("keeps windows drive paths intact when there is no line suffix", () => {
    expect(parseWorkspaceFileLocation("C:/Users/Shawn/project/src/app.ts")).toEqual({
      path: "C:/Users/Shawn/project/src/app.ts",
      lineNumber: null,
      column: null,
    })
  })
})

describe("resolveWorkspaceLinkTarget", () => {
  it("reuses the current workspace root for absolute files inside it", () => {
    expect(resolveWorkspaceLinkTarget({
      currentWorkspacePath: "/Users/shawn/project",
      linkWorkspacePath: "/Users/shawn/project/docs",
      absolutePath: "/Users/shawn/project/docs/briefing.pptx",
      filePath: "briefing.pptx",
    })).toEqual({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/project/docs/briefing.pptx",
      lineNumber: null,
      column: null,
    })
  })

  it("carries line and column metadata without treating it as part of the filename", () => {
    expect(resolveWorkspaceLinkTarget({
      currentWorkspacePath: "/Users/shawn/project",
      linkWorkspacePath: "/Users/shawn/project/src",
      absolutePath: "/Users/shawn/project/src/app.ts:42:7",
      filePath: "app.ts:42:7",
    })).toEqual({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/project/src/app.ts",
      lineNumber: 42,
      column: 7,
    })
  })

  it("falls back to the link workspace when the file is outside the current workspace", () => {
    expect(resolveWorkspaceLinkTarget({
      currentWorkspacePath: "/Users/shawn/project",
      linkWorkspacePath: "/Users/shawn/other/docs",
      absolutePath: "/Users/shawn/other/docs/briefing.pptx",
      filePath: "briefing.pptx",
    })).toEqual({
      workspacePath: "/Users/shawn/other/docs",
      initialFilePath: "briefing.pptx",
      lineNumber: null,
      column: null,
    })
  })
})

describe("resolveWorkspaceRootFromRoute", () => {
  it("restores a persisted run document directory instead of the project workspace", () => {
    expect(resolveWorkspaceRootFromRoute(
      "/Users/demo/ace-workspace",
      "/Users/demo/.aceharness/runs/run-123/outputs",
    )).toBe("/Users/demo/.aceharness/runs/run-123/outputs")
  })

  it("rejects a relative route root and falls back to the project workspace", () => {
    expect(resolveWorkspaceRootFromRoute(
      "/Users/demo/ace-workspace",
      "../../other",
    )).toBe("/Users/demo/ace-workspace")
  })
})
