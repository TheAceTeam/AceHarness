# 检查点匹配示例

说明如何把「检查点」当作审查 lens，在 diff 中发现问题并绑定 `rule_id`。

---

## 示例 1：命中检查点 #9（竞态）

**检查点**：信号量计数器递减时机存在竞态风险  
**rule_id**：`style-uncategorized-bfb4a3a6dfcd`

**diff 信号**：改动涉及 `semaphore`、`count--`、无锁读写的共享变量。

**要问的问题**：两个线程同时通过「检查计数 > 0」再「递减」，会不会都通过？

**证据写法**：

```json
{
  "checkpoint": 9,
  "rule_id": "style-uncategorized-bfb4a3a6dfcd",
  "file": "src/stdx/actors/semaphore.cj",
  "line": "88",
  "problem": "信号量在 check-then-act 间隙无同步，并发递减可能导致计数不准",
  "severity": "高"
}
```

**不报的情况**：递减已在同一临界区内，或使用原子操作保证顺序。

---

## 示例 2：命中检查点 #2（错误码不一致）

**检查点**：ERRNO 从 -2 改为 -4，上层仍把 -2 当 Operation not permitted  
**rule_id**：`style-uncategorized-5d7470ba55c5`

**diff 信号**：native 层改了返回值常量，或错误码枚举变更。

**要问的问题**：全仓库是否还有 `== -2`、`ERRNO_EPERM` 旧语义、注释里的旧值？

**操作**：对旧错误码 / 常量名做 **全局搜索**，而不只看 diff 单文件。

**证据写法**：

```json
{
  "checkpoint": 2,
  "rule_id": "style-uncategorized-5d7470ba55c5",
  "file": "stdlib/libs/std/fs/file_info.cj",
  "line": "171",
  "problem": "native 已改为 -4，但 callNativeFunc 仍把 ret==-2 视为 EPERM",
  "severity": "高"
}
```

---

## 示例 3：命中检查点 #1（空指针检查缺失）

**检查点**：空指针检查缺失  
**rule_id**：`style-uncategorized-193c6b18f3ba`

**diff 信号**：新增 public 函数、指针参数、未做 null 校验。

**要问的问题**：调用方传 null 时行为是什么？是否与其他同类 API 一致？

**证据写法**：

```json
{
  "checkpoint": 1,
  "rule_id": "style-uncategorized-193c6b18f3ba",
  "file": "runtime/src/Interpreter/InterpreterSpecific.cpp",
  "line": "412",
  "problem": "ObjectAllocate 未校验输入指针，与同类 API 的空指针防护不一致",
  "severity": "中"
}
```

---

## 示例 4：未命中任何检查点

diff 仅调整变量命名且无语义风险 → `issues: []`，**不上报**。

若确有 bug 但无对应检查点：仍可不报，或向用户说明「无匹配 rule_id，建议补充检查点表」。
