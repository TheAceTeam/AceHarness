import { describe, expect, it } from "vitest"
import { treeCanResolvePath } from "@/components/workspace/WorkspaceEditor"
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
