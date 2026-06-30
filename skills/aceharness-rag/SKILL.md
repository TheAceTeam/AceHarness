---
name: aceharness-rag
description: 使用 ACEHarness 内置 RAG/LanceDB 知识库进行只读检索。
capabilities:
  rag:
    read: true
---

# 使用场景

当任务需要查找项目知识、历史资料、导入文档或外部 RAG bundle 内容时，使用本 Skill。

# 调用方式

只能使用本 Skill 的 Python 脚本调用 ACEHarness runtime API。不要直接读取 LanceDB 文件，也不要尝试写入、导入或删除 RAG 数据。

列出当前授权知识库：

```bash
python .agents/skills/aceharness-rag/scripts/rag_list.py
```

检索知识库：

```bash
python .agents/skills/aceharness-rag/scripts/rag_search.py --kb default --query "要检索的问题" --top-k 8
```

# 返回字段

- `id`
- `knowledgeBaseId`
- `documentId`
- `chunkIndex`
- `text`
- `sourceTitle`
- `sourceSystem`
- `externalId`
- `metadataJson`
- `_distance`

# 约束

- 只能查询 runtime prompt 中列出的知识库。
- 不允许写入、删除、导入或重建 RAG 数据。
- 回答中引用检索结果时，应说明来源标题或 `sourceSystem`。
- 权限错误不要反复重试，应向用户说明当前 workflow/chat 未授权该能力。
