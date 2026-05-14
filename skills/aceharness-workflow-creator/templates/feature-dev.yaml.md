# 模板：功能开发（红蓝对抗）

适用于新功能开发、重构、迁移等需要设计→实施→验证的场景。

```yaml
workflow:
  name: 功能名称
  description: 一句话描述
  mode: state-machine
  maxTransitions: 30
  supervisor:
    enabled: true
    agent: default-supervisor
    stageReviewEnabled: true
    checkpointAdviceEnabled: true

  states:
    - name: 设计
      description: 设计方案
      requireHumanApproval: true
      isInitial: true
      isFinal: false
      steps:
        - id: design-plan
          name: 方案设计
          agent: architect
          role: defender
          specTaskBinding:
            taskIds: [T1.1]
            requirementIds: [R1]
            artifactKeys: [requirements, design]
          task: |
            设计完整方案：
            1. 模块划分和职责
            2. 接口定义和数据结构
            3. 关键流程和边界处理
        - id: design-attack
          name: 方案攻击
          agent: design-breaker
          role: attacker
          specTaskBinding:
            taskIds: [T1.2]
            requirementIds: [R1]
            artifactKeys: [design]
          task: 攻击设计方案，寻找缺陷、遗漏、安全问题、边界条件
        - id: design-judge
          name: 方案裁决
          agent: design-judge
          role: judge
          specTaskBinding:
            taskIds: [T1.3]
            requirementIds: [R1]
            artifactKeys: [design, tasks]
          task: |
            评估方案和攻击发现，输出裁决 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 实施
          condition: { verdict: pass }
          priority: 1
          label: 方案通过
        - to: 设计
          condition: { verdict: conditional_pass }
          priority: 2
          label: 需修复设计
        - to: 终止
          condition: { verdict: fail }
          priority: 3
          label: 设计不可行

    - name: 实施
      description: 编码实现
      requireHumanApproval: true
      isInitial: false
      isFinal: false
      steps:
        - id: implement-code
          name: 编码
          agent: developer
          role: defender
          specTaskBinding:
            taskIds: [T2.1]
            requirementIds: [R2]
            artifactKeys: [design, tasks]
          task: 根据设计方案实现功能
        - id: implement-attack
          name: 代码攻击
          agent: code-hunter
          role: attacker
          specTaskBinding:
            taskIds: [T2.2]
            requirementIds: [R2]
            artifactKeys: [design, tasks]
          task: 攻击代码，寻找 bug、安全漏洞、边界问题
        - id: implement-judge
          name: 代码裁决
          agent: fix-judge
          role: judge
          specTaskBinding:
            taskIds: [T2.3]
            requirementIds: [R2]
            artifactKeys: [tasks]
          task: |
            裁决代码质量，输出 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 验证
          condition: { verdict: pass }
          priority: 1
          label: 代码通过
        - to: 实施
          condition: { verdict: conditional_pass }
          priority: 2
          label: 需继续修复
        - to: 终止
          condition: { verdict: fail }
          priority: 3
          label: 实施不可接受

    - name: 验证
      description: 构建和测试
      isInitial: false
      isFinal: false
      steps:
        - id: verify-build-test
          name: 构建测试
          agent: developer
          role: defender
          preCommands:
            - npm test
            - npm run build
          specTaskBinding:
            taskIds: [T3.1]
            requirementIds: [R3]
            artifactKeys: [tasks]
          task: 执行构建和测试
        - id: verify-judge
          name: 验证裁决
          agent: tester
          role: judge
          specTaskBinding:
            taskIds: [T3.2]
            requirementIds: [R3]
            artifactKeys: [tasks]
          task: |
            验证结果，输出 JSON：
            {"verdict":"pass|conditional_pass|fail","summary":"..."}
      transitions:
        - to: 完成
          condition: { verdict: pass }
          priority: 1
          label: 验证通过
        - to: 实施
          condition: { verdict: fail }
          priority: 2
          label: 验证失败，返回修复
        - to: 验证
          condition: { verdict: conditional_pass }
          priority: 3
          label: 验证信息不足，补充测试

    - name: 完成
      description: 开发完成
      isInitial: false
      isFinal: true
      steps:
        - id: delivery-report
          name: 交付报告
          agent: documentation-writer
          role: defender
          specTaskBinding:
            taskIds: [T4.1]
            requirementIds: [R4]
            artifactKeys: [requirements, design, tasks]
          task: 生成交付报告
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
    需求描述和验收标准
  timeoutMinutes: 180
```
