import { describe, expect, it } from "vitest"
import { resolveWorkspaceEditorTargetFile, treeCanResolvePath } from "@/components/workspace/WorkspaceEditor"
import type { TreeNode } from "@/lib/core/api"

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

  it("rejects absolute files outside the current workspace", () => {
    expect(resolveWorkspaceEditorTargetFile({
      workspacePath: "/Users/shawn/project",
      initialFilePath: "/Users/shawn/other/file.md",
      urlFilePath: "docs/briefing.pptx",
    })).toBe("docs/briefing.pptx")
  })
})
