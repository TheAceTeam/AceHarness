# Archive

Updated: 2026-07-09

## Superseded Direction

- Earlier wrapper-compatible approaches are superseded. The active plan is destructive Runtime-first migration.
- Old SDK/ACP dual-driver support is superseded. Non-Magic agents should route through acpx, and Magic should use `MagicAdapter`.

## Review Notes Folded Into Active Tasks

- Compact/fork required adapter optional methods and saga schema support. This is covered by Task 1, Task 2, and Task 7.
- Agent runtime state required SQLite backing. This is covered by Task 2 and Task 3.
- Projection needed a rebuildable cache boundary. This is covered by Task 2, Task 7, and Task 9.
- TanStack integration should reuse existing Query/DB/Virtual patterns. This is covered by Task 9 and Task 10.
