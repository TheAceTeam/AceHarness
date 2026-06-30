---
name: aceharness-sqlite
description: 使用 ACEHarness 运行时提供的 workspace SQLite 能力创建和维护 Skill 数据库。
capabilities:
  sqlite:
    read: true
    write: true
    createDatabase: true
    deleteDatabase: true
---

# 使用场景

当 Skill 需要维护结构化状态、缓存、索引、任务记录或跨步骤数据表时，使用本 Skill。

# 调用方式

只能使用本 Skill 的 Python 脚本调用 ACEHarness runtime API。不要访问 ACEHarness 内部 SQLite，不要访问 runtime prompt 未列出的数据库文件。

```bash
python .agents/skills/aceharness-sqlite/scripts/sqlite_list.py
python .agents/skills/aceharness-sqlite/scripts/sqlite_create.py --db workflow-cache
python .agents/skills/aceharness-sqlite/scripts/sqlite_query.py --db workflow-cache --sql "SELECT * FROM items WHERE id = ?" --params "[\"id-1\"]"
python .agents/skills/aceharness-sqlite/scripts/sqlite_exec.py --db workflow-cache --sql "INSERT INTO items(id, value) VALUES(?, ?)" --params "[\"id-1\", \"value\"]"
python .agents/skills/aceharness-sqlite/scripts/sqlite_transaction.py --db workflow-cache --file .aceharness/sqlite/init.json
python .agents/skills/aceharness-sqlite/scripts/sqlite_delete_db.py --db workflow-cache
```

# 约束

- 只能使用 runtime prompt 中列出的逻辑数据库名。
- 数据库文件必须位于当前 workspace 内。
- 不允许 `ATTACH`、`DETACH`、`load_extension`、`VACUUM INTO`、`.read`、`.shell`。
- 查询只允许 `SELECT` 或 `WITH ... SELECT`。
- 写操作应使用参数绑定，避免拼接用户输入。
- 写操作应尽量幂等，避免重复执行造成脏数据。
