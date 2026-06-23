# 模板：Bug 修复

适用于 bug 修复、crash 分析、性能问题排查。

默认每个非终止状态使用 defender、attacker、judge 三步；judge 输出当前状态 verdict，transitions 再据此流转。`conditional_pass` 表示当前状态仍需迭代，通常回到当前状态。

```yaml
workflow:
  name: Bug 修复
  description: 一句话描述
  mode: state-machine
  maxTransitions: 30
  supervisor:
    enabled: true
    agent: default-supervisor
    stageReviewEnabled: true
    checkpointAdviceEnabled: true

  states:
    - name: 复现确认
      description: 构造最小复现，确认问题存在
      requireHumanApproval: true
      isInitial: true
      isFinal: false
      steps:
        - id: reproduce-case
          name: 构造复现
          agent: developer
          role: defender
          specTaskBinding:
            taskIds: [T1.1]
            requirementIds: [R1]
            artifactKeys: [requirements, tasks]
          task: |
            构造最小复现用例：
            1. 确认复现环境和条件
            2. 编写最小复现步骤
            3. 记录实际行为 vs 预期行为
        - id: reproduce-challenge
          name: 质疑复现
          agent: code-hunter
          role: attacker
          specTaskBinding:
            taskIds: [T1.2]
            requirementIds: [R1]
            artifactKeys: [requirements, tasks]
          task: 质疑复现用例是否过窄、是否遗漏环境变量、是否把偶发现象误判为稳定复现
        - id: reproduce-judge
          name: 复现裁决
          agent: tester
          role: judge
          specTaskBinding:
            taskIds: [T1.3]
            requirementIds: [R1]
            artifactKeys: [tasks]
          task: |
            验证复现用例，输出裁决 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 根因分析
          condition: { verdict: pass }
          priority: 1
          label: 复现确认
        - to: 复现确认
          condition: { verdict: conditional_pass }
          priority: 2
          label: 复现不充分，补充用例
        - to: 终止
          condition: { verdict: fail }
          priority: 3
          label: 无法复现

    - name: 根因分析
      description: 深度分析根本原因
      requireHumanApproval: true
      isInitial: false
      isFinal: false
      steps:
        - id: root-cause-analysis
          name: 分析根因
          agent: developer
          role: defender
          specTaskBinding:
            taskIds: [T2.1]
            requirementIds: [R2]
            artifactKeys: [design, tasks]
          task: |
            深度分析根本原因：
            1. 从复现用例出发，定位问题代码路径
            2. 分析触发条件和影响范围
            3. 给出根因结论和修复方向
        - id: root-cause-challenge
          name: 质疑分析
          agent: code-hunter
          role: attacker
          specTaskBinding:
            taskIds: [T2.2]
            requirementIds: [R2]
            artifactKeys: [design]
          task: 质疑根因分析结论，检查是否遗漏其他可能原因、是否只看到表象
        - id: root-cause-judge
          name: 根因裁决
          agent: fix-judge
          role: judge
          specTaskBinding:
            taskIds: [T2.3]
            requirementIds: [R2]
            artifactKeys: [design, tasks]
          task: |
            评估根因分析和质疑，输出裁决 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 修复实现
          condition: { verdict: pass }
          priority: 1
          label: 根因确认
        - to: 根因分析
          condition: { verdict: conditional_pass }
          priority: 2
          label: 分析不充分，继续深挖
        - to: 终止
          condition: { verdict: fail }
          priority: 3
          label: 无法定位根因

    - name: 修复实现
      description: 编码修复
      requireHumanApproval: true
      isInitial: false
      isFinal: false
      steps:
        - id: implement-fix
          name: 编码修复
          agent: developer
          role: defender
          specTaskBinding:
            taskIds: [T3.1]
            requirementIds: [R3]
            artifactKeys: [design, tasks]
          task: |
            根据根因分析实现修复：
            1. 编写修复代码
            2. 确保修复不引入新问题
            3. 添加针对性测试用例
        - id: fix-attack
          name: 修复攻击
          agent: code-hunter
          role: attacker
          specTaskBinding:
            taskIds: [T3.2]
            requirementIds: [R3]
            artifactKeys: [tasks]
          task: 攻击修复代码，检查是否真正修复、是否引入新 bug、边界条件是否覆盖
        - id: fix-judge
          name: 修复裁决
          agent: fix-judge
          role: judge
          specTaskBinding:
            taskIds: [T3.3]
            requirementIds: [R3]
            artifactKeys: [tasks]
          task: |
            裁决修复质量，输出 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 回归验证
          condition: { verdict: pass }
          priority: 1
          label: 修复通过
        - to: 修复实现
          condition: { verdict: conditional_pass }
          priority: 2
          label: 需继续修复
        - to: 根因分析
          condition: { verdict: fail }
          priority: 3
          label: 修复方向错误，返回分析

    - name: 回归验证
      description: 回归测试确认无副作用
      isInitial: false
      isFinal: false
      steps:
        - id: regression-test
          name: 回归测试
          agent: developer
          role: defender
          preCommands:
            - npm test
            - npm run build
          specTaskBinding:
            taskIds: [T4.1]
            requirementIds: [R4]
            artifactKeys: [tasks]
          task: |
            执行回归验证：
            1. 运行原始复现用例，确认已修复
            2. 运行相关模块测试，确认无回归
            3. 执行全量构建
        - id: regression-challenge
          name: 回归质疑
          agent: code-hunter
          role: attacker
          specTaskBinding:
            taskIds: [T4.2]
            requirementIds: [R4]
            artifactKeys: [tasks]
          task: 质疑回归覆盖范围，检查是否遗漏失败路径、边界输入、兼容性和性能副作用
        - id: regression-judge
          name: 回归裁决
          agent: tester
          role: judge
          specTaskBinding:
            taskIds: [T4.3]
            requirementIds: [R4]
            artifactKeys: [tasks]
          task: |
            验证回归测试结果，输出 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 完成
          condition: { verdict: pass }
          priority: 1
          label: 回归通过
        - to: 修复实现
          condition: { verdict: fail }
          priority: 2
          label: 回归失败，返回修复
        - to: 回归验证
          condition: { verdict: conditional_pass }
          priority: 3
          label: 验证信息不足，补充回归

    - name: 完成
      description: 修复完成
      isInitial: false
      isFinal: true
      steps:
        - id: fix-report
          name: 修复报告
          agent: documentation-writer
          role: defender
          specTaskBinding:
            taskIds: [T5.1]
            requirementIds: [R5]
            artifactKeys: [requirements, design, tasks]
          task: 生成修复报告，包含根因、修复方案和验证结果
      transitions: []

    - name: 终止
      description: 异常终止
      isInitial: false
      isFinal: true
      steps:
        - id: abort-report
          name: 终止记录
          agent: documentation-writer
          role: defender
          task: 记录终止原因
      transitions: []

context:
  projectRoot: /absolute/path/to/project
  workspaceMode: in-place
  requirements: |
    Bug 描述和复现步骤
  timeoutMinutes: 180
```
