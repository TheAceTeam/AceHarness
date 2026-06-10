# 规则索引（125 条）

评审时配合 `scripts/select_rules.py` 按需加载详情卡片。

| id | tier | dim | category | 规则摘要 | triggers |
|----|------|-----|----------|----------|----------|
| `style-comment-0bef34cfc1dd` | soft | style | comment | 注释应准确且必要：补充难理解逻辑的意图说明，删除冗余、过时或与代码不符的注释。 | 注释, 过时 |
| `style-formatting-6773dec86010` | soft | style | formatting | 遵循统一的排版规范：运算符/关键字/括号周围留必要空格，缩进、换行、空行保持一致。 | 空格, 缩进, 换行, 运算符, 括号, 排版 |
| `style-naming-c24e74ff15fe` | soft | style | naming | 标识符命名应准确表意、与其类型和语义一致；发现误导性或拼写错误的命名应及时重命名。 | 命名, 标识符, 表意, 拼写 |
| `style-complexity-b6e12fb8d482` | soft | style | complexity | 过长或嵌套过深的函数/判断条件应拆分或提取子函数，降低复杂度、提升可读性。 | 过长, 嵌套, 拆分, 子函数 |
| `style-dead_code-5b6627ee013e` | soft | style | dead_code | 及时清理冗余、重复或无用的代码、导入和声明，保持改动最小且聚焦。 | 冗余, 无用, 导入, 声明 |
| `style-magic_number-e700f43662cd` | soft | style | magic_number | 避免散落的魔法数字/字面量，抽取为有语义的命名常量。 | 魔法, 字面量, 常量 |
| `style-error_message-742c0bbdf440` | soft | style | error_message | 错误信息和用户可见文案应准确、清晰、可定位，避免含糊或误导性表达。 | 错误信息, 文案, 用户可见, 误导 |
| `spec-encapsulation-e77882aafb7d` | soft | spec | encapsulation | 对外能力应通过良好封装的接口暴露，隐藏实现细节，保持接口稳定清晰。 | 封装, 暴露, 隐藏实现 |
| `spec-api_abi_compat-8d1ab0c1db8d` | soft | spec | api_abi_compat | 改动 public API/成员需评估 API/ABI 兼容性；破坏性变更须经评审并在说明中标注。 | public, ABI |
| `spec-layer_boundary-af6500b3ea84` | soft | spec | layer_boundary | 遵守模块/分层职责边界：类型与逻辑放在恰当的层和文件，避免跨层耦合与不当依赖。 | 模块, 分层, 依赖 |
| `spec-dependency_mgmt-1133877dd326` | soft | spec | dependency_mgmt | 控制不必要的依赖引入，避免为小功能引入过多包或加重耦合。 | 依赖, 耦合 |
| `spec-uncategorized-30c6fea5cfa4` | soft | spec | uncategorized | 保持与既有代码一致的规范与约定，相关改动需在同类位置统一处理，避免遗漏。 |  |
| `spec-reuse_dry-00bbb1c58359` | soft | spec | reuse_dry | 优先复用已有的常量/函数/工具，相似逻辑提取公共实现，避免重复定义。 | 复用, 重复定义, 公共 |
| `spec-config_hardcode-1594350a5740` | soft | spec | config_hardcode | 禁止硬编码绝对/临时路径、写死的偏移等环境相关值，应参数化或使用相对路径/配置。 | 硬编码 |
| `spec-uncategorized-afb4dbb06bdd` | soft | spec | uncategorized | 涉及跨平台、目标架构或构建选项的改动，应覆盖各平台差异并避免引入平台专属假设。 |  |
| `spec-uncategorized-c01644888289` | soft | spec | uncategorized | 新增或修复行为应补充能覆盖关键路径、边界条件和回归场景的测试。 |  |
| `function-logic_correctness-30b0b3a9bc9c` | hard | function | logic_correctness | 校验逻辑正确性，关注不可达分支、状态不一致、死循环及遗漏的边界场景。 | 分支, 不可达, 遗漏, 逻辑 |
| `function-exception_error-d719a9234974` | soft | function | exception_error | 统一错误码/异常语义，检查并妥善处理返回值与异常路径，不吞掉错误。 | 异常, 错误码 |
| `function-concurrency-13fe18275149` | hard | function | concurrency | 多线程访问的共享状态必须保证并发安全，识别竞态条件并加适当同步。 | 线程, 竞态, 同步, 并发 |
| `function-assertion_precondition-5be8f689e42d` | soft | function | assertion_precondition | 对指针/可空值进行判空校验，避免空引用导致的崩溃。 | 校验 |
| `function-resource_lifecycle-37e9303104c0` | hard | function | resource_lifecycle | 成对管理资源生命周期，所有错误路径都要正确释放，避免泄漏、重复释放或释放后使用。 | 释放, 泄漏, 资源 |
| `function-security_input-1ec9f0bf2b87` | hard | function | security_input | 对外部/不可信输入做校验与边界防护，关注安全风险（注入、越权、敏感信息泄露等）。 | 注入, 不可信, 校验, 安全 |
| `function-boundary_overflow-1e49af60351d` | soft | function | boundary_overflow | 数值比较/类型转换需考虑精度、符号与溢出，遵循正确的数值与边界语义。 | 溢出, 精度, 类型转换 |
| `function-performance-1c835df0718e` | soft | function | performance | 关注热点路径性能，避免在高频循环中重复创建/释放资源或进行冗余计算。 | 循环, 高频, 性能 |
| `function-assertion_precondition-ad97b9c2bf7f` | soft | function | assertion_precondition | 对数组/缓冲区索引与长度做边界校验，防止越界读写。 | 校验 |
| `function-boundary_overflow-2dbdace8dc27` | soft | function | boundary_overflow | 编码/序列化处理应遵循规范语义，正确处理多字节、边界与异常输入。 | 异常, Option, Monad, 抛出, 错误码 |
| `function-compiler_internal-b8bd44a550d9` | soft | function | compiler_internal | 编译器相关改动需验证 AST/Sema/IR/类型系统等阶段的一致性，避免前后端语义漂移。 | AST, Sema, 类型系统 |
| `function-resource_lifecycle-2029bd3adf51` | hard | function | resource_lifecycle | 引入缓存、全局状态或单例初始化时，应明确失效、并发和资源释放语义。 | 释放, 资源 |
| `style-uncategorized-193c6b18f3ba` | soft | style | uncategorized | 公开 API 空指针检查不一致：ObjectAllocate/ArrayAllocate 等缺少输入参数 nullptr 校验 | ArrayAllocate, ObjectAllocate, nullptr, 公开, 校验, 空指针检查不一致 |
| `style-uncategorized-5d7470ba55c5` | soft | style | uncategorized | ERRNO_EPERM 从 -2 改为 -4 后，上层仍将 ret==-2 当作 Operation not permitted，需同步错误码处理 | ERRNO_EPERM, Operation, not, permitted, ret, 上层仍将 |
| `style-uncategorized-1aab327ab818` | soft | style | uncategorized | GetStdHandle 失败返回 INVALID_HANDLE_VALUE 而非 nullptr，对 hStdout/hStderr 的 nullptr 检… | GetStdHandle, INVALID_HANDLE_VALUE, hStderr, hStdout, nullptr, 失败返回 |
| `style-uncategorized-9044faf3e0b7` | soft | style | uncategorized | isIdempotentMethod 大小写敏感：method("get") 等小写不会被识别为幂等方法，影响自动重试 | get, isIdempotentMethod, method, 为幂等方法, 大小写敏感, 影响自动重试 |
| `style-naming-5e3a78b2b32b` | soft | style | naming | maxCapacity 取 Int64.Max-8 缺少注释，未说明为何预留 8 字节 | Int64.Max, maxCapacity, 字节, 未说明为何预留, 缺少注释 |
| `style-formatting-01cb1ac25f9b` | soft | style | formatting | Content-Length 前导零校验 s[0]<b'1' 同时拒绝非数字开头字符串，建议在注释中明确设计意图 | Content, Content-Length, Length, 前导零校验, 同时拒绝非数字开, 头字符串 |
| `style-uncategorized-6f6b1763cde2` | soft | style | uncategorized | 移除 readStringUnquoted 为非标准 JSON（如 {admin:true}）的破坏性变更，需评估兼容性或提供选项 | admin, readStringUnquoted, true, 为非标准, 供选项, 的破坏性变更 |
| `style-uncategorized-58e1e6208a97` | soft | style | uncategorized | String.fromJson 现支持 bool/null/number 转字符串，可能改变现有解析行为 | String.fromJson, bool, null, number, 可能改变现有解析, 现支持 |
| `style-uncategorized-bfb4a3a6dfcd` | soft | style | uncategorized | Semaphore cnt.fetchSub(1) 在 synchronized 块外执行，高并发下计数可能与实际信号不匹配 | Semaphore, cnt.fetchSub, synchronized, 与实际信号不匹配, 块外执行, 高并发下计数可能 |
| `style-uncategorized-a167a8eefd0c` | soft | style | uncategorized | nextInt8/16/32/64(upper) 过滤负数后直接取模，存在与无符号函数相同的模偏移偏差 | nextInt8, upper, 存在与无符号函数, 相同的模偏移偏差, 过滤负数后直接取 |
| `style-comment-d348e2fbf996` | soft | style | comment | validateHandle 新增 lazy init 与「非并发安全」注释矛盾，多线程可能重复 createExportHandle | createExportHandle, init, lazy, synchronized, validateHandle, 多线程可能重复 |
| `style-uncategorized-d013f62c1188` | soft | style | uncategorized | Random 安全/线程警告仅在文档，random.cj 源码缺少对应类级注释 | Random, random.cj, 安全, 注释, 源码缺少对应类级, 线程警告仅在文档 |
| `spec-api_abi_compat-7857a90a806a` | soft | spec | api_abi_compat | CPointerResource value 改 private 修复 UAF 可能破坏直接访问字段的现有代码，需迁移路径 | CPointerResource, UAF, private, value, 修复, 可能破坏直接访问 |
| `spec-uncategorized-c7e307b8a7d7` | soft | spec | uncategorized | Branch.trueTarget 对 operands[1] 直接 as Block + getOrThrow，类型不符时公开 API 会抛异常 | Block, Branch.trueTarget, getOrThrow, operands, 会抛异常, 直接 |
| `style-uncategorized-4d85e11d535a` | soft | style | uncategorized | resource_pool 使用 synchronized(mux) 语法，需确认仓颉互斥锁规范是否与 lock/unlock 一致 | lock, mux, resource_pool, synchronized, unlock, 一致 |
| `function-exception_error-ca2be0ebd46f` | hard | function | exception_error | cjpm_openssl_strong.toml 硬编码 /tmp/stdx 等临时 link 路径，影响可移植构建 | cjpm_openssl_strong.toml, link, stdx, tmp, 影响可移植构建, 硬编码 |
| `function-compiler_internal-4240cf1f14dc` | soft | function | compiler_internal | JsonParserPool.acquire 在 cache 不足时仍保留池中 parser 不清理，可能导致资源滞留 | JsonParserPool.acquire, cache, mutex, parser, synchronized, 不清理 |
| `function-resource_lifecycle-5864e5a96d4a` | hard | function | resource_lifecycle | SM4 解密用 ArrayList 缓存全量明文，GB 级文件有 OOM 风险（GCM 需先验 tag 的权衡） | ArrayList, GCM, OOM, SM4, tag, 的权衡 |
| `function-uncategorized-39fefcc7e6a9` | soft | function | uncategorized | isIdempotentMethod 未含 RFC 7231 中的 TRACE，严格遵循规范时可补充 | TRACE, isIdempotentMethod, 严格遵循规范时可, 中的, 未含, 补充 |
| `function-boundary_overflow-12952a94e41b` | soft | function | boundary_overflow | keys.c PEM 密码回调 memcpy 含终止符但返回 len-1，需确认 OpenSSL 边界与缓冲区写入 | OpenSSL, PEM, keys.c, len, memcpy, 含终止符但返回 |
| `style-uncategorized-fd030da0fabf` | soft | style | uncategorized | ColorSingleton 单例构造无线程安全保护，多线程首次访问可能竞态导致 ANSI 颜色未初始化 | ANSI, ColorSingleton, 全保护, 单例构造无线程安, 多线程首次访问可, 能竞态导致 |
| `style-uncategorized-9e4d7f0d548f` | soft | style | uncategorized | Exception init(causedBy) 分支可能未初始化 detailMessage 即用于 fillInStackTrace | Exception, causedBy, detailMessage, fillInStackTrace, init, 分支可能未初始化 |
| `style-uncategorized-2050d1498a29` | soft | style | uncategorized | AddIndirectExtend TypeMatchingImpl 多个 unordered_map 临时映射未见析构清理，有泄漏风险 | AddIndirectExtend, TypeMatchingImpl, unordered_map, 临时映射未见析构, 多个, 有泄漏风险 |
| `style-uncategorized-975529c1ce05` | soft | style | uncategorized | TreeMap quickEquals 改为仅 refEq，原 entrySize 内容比较语义变更需确认意图 | TreeMap, entrySize, quickEquals, refEq, 内容比较语义变更, 改为仅 |
| `style-uncategorized-7c01a1a87bda` | soft | style | uncategorized | float16.isnormal 曾错误分类 denormalized 数，需补充 NaN/Inf/denormal 测试 | Inf, NaN, denormal, denormalized, float16.isnormal, 曾错误分类 |
| `style-uncategorized-cefd4bbd08d2` | soft | style | uncategorized | isValidContentLengthFormat 除空串和 "0" 外直接 return true，未校验纯数字格式 | Content-Length, isValidContentLengthFormat, return, true, 外直接, 未校验纯数字格式 |
| `style-uncategorized-6826810dfc2d` | soft | style | uncategorized | CPointer 减法移除 @OverflowWrapping 改手动检查，需确认 addPointer 内部仍有溢出防护 | CPointer, OverflowWrapping, addPointer, overflow, 内部仍有溢出防护, 减法移除 |
| `style-uncategorized-a43193a05d51` | soft | style | uncategorized | HTTP isValidContentLengthFormat 对 "abc" 等非数字直接通过，格式校验名实不符 | Content-Length, abc, isValidContentLengthFormat, 格式校验名实不符, 等非数字直接通过 |
| `style-uncategorized-ee69df2c5063` | soft | style | uncategorized | CJ_JSON_ParseFloat64 用 512 字节栈缓冲，超长数字会被静默截断导致精度损失 | CJ_JSON_ParseFloat64, 字节栈缓冲, 截断导致精度损失, 超长数字会被静默 |
| `style-magic_number-c399c57774a8` | soft | style | magic_number | HTTP 体大小三处硬编码 10MB，与 constants DEFAULT_MAX_BODY_SIZE(2MB) 不一致且分散 | DEFAULT_MAX_BODY_SIZE, constants, 不一致且分散, 体大小三处硬编码 |
| `style-uncategorized-f5b29fbff363` | soft | style | uncategorized | CPointerResource.use 先 isFree.load 再 action(value)，存在 TOCTOU 竞态可 UAF | CPointerResource.use, TOCTOU, UAF, action, isFree.load, value |
| `style-uncategorized-2140261d2672` | soft | style | uncategorized | LibC.mallocCString 对 str.size==Int64.Max 时 length+1 溢出，应前置边界检查 | Int64.Max, LibC.mallocCString, length, malloc, str.size, 应前置边界检查 |
| `style-formatting-0506a640d9f4` | soft | style | formatting | isValidContentLengthFormat 只查首字符>=1，"abc"/"123abc" 会通过但 parse 失败且报错不准 | Content-Length, abc, isValidContentLengthFormat, parse, 会通过但, 只查首字符 |
| `style-uncategorized-ab7d7ec5b28b` | soft | style | uncategorized | getScheduler 对 id<0 用 (0-id)%COUNT，需确认 Timer ID 是否可能为负 | COUNT, Timer, getScheduler, 是否可能为负, 需确认 |
| `style-uncategorized-4eb7f474af97` | soft | style | uncategorized | Array.splitAt left 的 len 参数从 start+mid 改为 mid，语义变更需确认是否为 bugfix | Array.splitAt, bugfix, left, len, mid, start |
| `style-uncategorized-e132aa328d0f` | soft | style | uncategorized | logBase 声称修复 NaN 绕过校验，但可能仍未覆盖 base 为 NaN 等边界 | NaN, base, logBase, 但可能仍未覆盖, 声称修复, 等边界 |
| `style-uncategorized-6d987850e488` | soft | style | uncategorized | Semaphore release 用 newValue 作 notify 次数，唤醒线程数与释放许可数可能不匹配 | Semaphore, newValue, notify, release, 唤醒线程数与释放, 次数 |
| `style-uncategorized-12552b6de041` | soft | style | uncategorized | priority_queue 遍历 queuePool 查非空队列无整体同步，并发下索引选择可能过时 | Semaphore, priority_queue, queuePool, synchronized, 同步, 并发下索引选择可 |
| `style-uncategorized-c546dd3718fa` | soft | style | uncategorized | 文件上传移除 exists 检查改 File.create，需确认文件已存在时的抛错/覆盖行为 | File.create, exists, 文件上传移除, 时的抛错, 检查改, 覆盖行为 |
| `style-uncategorized-e82770f393ad` | soft | style | uncategorized | dns.cj 移除 hints.ai_flags=AI_PASSIVE|AI_ALL，可能改变解析/绑定地址类型行为 | AI_ALL, AI_PASSIVE, dns.cj, hints.ai_flags, 可能改变解析, 移除 |
| `style-uncategorized-473d265aa578` | soft | style | uncategorized | env.getVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致 | env.getVariable, key, setVariable, 一样拒绝, 未像, 校验不一致 |
| `style-uncategorized-a4fafbc14291` | soft | style | uncategorized | env.removeVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致 | env.removeVariable, key, setVariable, 一样拒绝, 未像, 校验不一致 |
| `style-uncategorized-8717b58609d1` | soft | style | uncategorized | HttpNormalBody remainingLength 初始化为 contentLength 而非 data.size，可能越界读 | Content-Length, HttpNormalBody, contentLength, data.size, remainingLength, 初始化为 |
| `style-uncategorized-8b9f9fbc19e7` | soft | style | uncategorized | BinaryExpression Div 构造抛错英文 "maybe div 0" 表述不准，应为 division by zero | BinaryExpression, Div, div, division, maybe, overflow |
| `style-complexity-c2db77040f06` | soft | style | complexity | ActorMacro.cd 已 refactor 为 let+match，ReceiverModification.fd 仍 var+zeroValue 不一致 | ActorMacro.cd, ReceiverModification.fd, let, match, refactor, var |
| `style-uncategorized-7ca7ffa35e8e` | soft | style | uncategorized | Expression::OperandsToString 硬编码多个 ExprKind 判断 hasException，扩展性差 | ExprKind, Expression, OperandsToString, hasException, 判断, 扩展性差 |
| `style-uncategorized-bcf6249094fd` | soft | style | uncategorized | interpreted_frame_info_t 中 char* 字段生命周期/释放责任未在 API 文档说明 | char, interpreted_frame_info_t, 字段生命周期, 文档说明, 释放责任未在 |
| `style-magic_number-7cb1576d56df` | soft | style | magic_number | parseFormat 用 MAX_FORMAT_WIDTH 限制 precision，浮点应使用 MAX_FLOAT_PRECISION | MAX_FLOAT_PRECISION, MAX_FORMAT_WIDTH, parseFormat, precision, 浮点应使用, 限制 |
| `function-compiler_internal-5889d4737881` | soft | function | compiler_internal | OptionLikeNonRef enum 构造误用 chirEnumType 类型参数作关联值类型，可能导致 ABI/布局不兼容 | ABI, OptionLikeNonRef, chirEnumType, enum, 可能导致, 布局不兼容 |
| `spec-uncategorized-5108b80470b2` | soft | spec | uncategorized | normalize 函数约 65 行含三平台逻辑，建议拆分为各平台辅助函数便于维护 | normalize, 函数约, 建议拆分为各平台, 行含三平台逻辑, 辅助函数便于维护 |
| `function-performance-3e889f2b2930` | soft | function | performance | 编译器产物二进制兼容策略变更，混用旧版 cjo 可能导致运行错误，需在 PR/文档说明 | cjo, 兼容策略变更, 可能导致运行错误, 文档说明, 混用旧版, 编译器产物二进制 |
| `function-uncategorized-ed59d7c3ab1c` | soft | function | uncategorized | cjmp 下 fileId 取 hash 常为负，原 -1 表无效的 GetFileID 语义失效，需 optional 或重构 | GetFileID, cjmp, fileId, hash, optional, 常为负 |
| `function-uncategorized-ea735f593352` | soft | function | uncategorized | Print.cpp 将 TERM getenv 转 std::string 可能抛 bad_alloc，初始化路径应避免未捕获异常 | Print.cpp, TERM, bad_alloc, getenv, nullptr, std |
| `function-performance-cece5b61e9a9` | soft | function | performance | Exception 允许任意 cause 链，A→B→A 循环引用可导致打印栈时无限递归 | Exception, cause, 允许任意, 印栈时无限递归, 循环引用可导致打 |
| `function-resource_lifecycle-03610bb8eff9` | hard | function | resource_lifecycle | DynPopFree 在 STRONG 模式仅 strcmp 少数符号，其他 free 函数缺少动态查找回退 | DynPopFree, STRONG, free, strcmp, 其他, 函数缺少动态查找 |
| `function-security_input-fc7cb92884c6` | hard | function | security_input | Interpreter initialized 非原子，多线程可能竞态使用未初始化 interpreter_interface | Interpreter, initialized, interpreter_interface, nullptr, 多线程可能竞态使, 用未初始化 |
| `function-null_safety-780fa5557e3b` | hard | function | null_safety | IsPendingSafePoint 遇 null tlData 仅 LOG 后 return false，关键路径应终止或抛错 | IsPendingSafePoint, LOG, false, null, nullptr, return |
| `function-uncategorized-49e140871229` | soft | function | uncategorized | ConcurrentHashMap getHash 末尾表达式缺显式 return，可读性与风格不佳 | ConcurrentHashMap, getHash, return, 可读性与风格不佳, 末尾表达式缺显式 |
| `function-logic_correctness-815bea14ae27` | hard | function | logic_correctness | libc.malloc(count=0) 改返回 null 替代 UB，依赖旧行为的调用点需回归 | count, libc.malloc, malloc, null, 依赖旧行为的调用, 改返回 |
| `function-resource_lifecycle-7271895c88da` | hard | function | resource_lifecycle | thread.state 曾存在 UAF，需确认修复完整并加压力测试 | UAF, thread.state, 加压力测试, 曾存在, 需确认修复完整并 |
| `function-uncategorized-eebadd60cef3` | soft | function | uncategorized | Error pcArray/traceElementArray 改 protected var，外部直接访问字段的代码会编译失败 | Error, pcArray, protected, traceElementArray, var, 外部直接访问字段 |
| `function-boundary_overflow-e9406d11082a` | soft | function | boundary_overflow | tar_reader paxGlobalDataBytes 累加 global pax 大小，需防 Int64 溢出 | Int64, global, pax, paxGlobalDataBytes, tar_reader, 大小 |
| `function-uncategorized-e6f39fae0f81` | soft | function | uncategorized | Comparable 将 NaN 视为大于非 NaN，与 IEEE totalOrder 不同，排序可能不符合预期 | Comparable, IEEE, NaN, totalOrder, 不同, 排序可能不符合预 |
| `function-uncategorized-eb65d4062e24` | soft | function | uncategorized | HTTP isIdempotentMethod 未含 TRACE（RFC 7231），与 #4/#19 同类规范缺口 | TRACE, isIdempotentMethod, 同类规范缺口, 未含 |
| `function-resource_lifecycle-ba2db5b5eaa7` | hard | function | resource_lifecycle | JSON unittest cache 溢出条件用 cacheSize+1>=size，边界语义需确认是否应为 > | cache, cacheSize, size, unittest, 否应为, 溢出条件用 |
| `function-boundary_overflow-8b1889127f2c` | soft | function | boundary_overflow | CPointer minus 仅检查 offset==Int64.Min，(-1)*offset 乘法溢出路径可能未覆盖 | CPointer, Int64.Min, minus, offset, overflow, 乘法溢出路径可能 |
| `function-resource_lifecycle-f9f76974dd3d` | hard | function | resource_lifecycle | fork 后父进程立即 FreeTwoDimensionalArray(arguments/environment)，需确认子进程 Exec 是否仍安全 | Exec, FreeTwoDimensionalArray, arguments, environment, fork, 后父进程立即 |
| `function-performance-685e7c1facd9` | soft | function | performance | Random 拒绝采样 while(r>threshold) 理论上可无限循环（概率极低），大 upper 时更明显 | Random, threshold, upper, while, 拒绝采样, 时更明显 |
| `function-uncategorized-02b1b8fe6116` | soft | function | uncategorized | Windows OpenSSL 动态加载缺 SSL 库版本校验，仅检查 OS 版本不足 | OpenSSL, SSL, Windows, 仅检查, 动态加载缺, 库版本校验 |
| `function-performance-b38d515cec65` | soft | function | performance | HttpNormalBody 用 ArrayList 逐块 add 再 toArray，多次扩容+最终拷贝有性能开销 | ArrayList, Content-Length, HttpNormalBody, add, toArray, 多次扩容 |
| `function-resource_lifecycle-13f974d57002` | hard | function | resource_lifecycle | ColorSingleton Windows 早退路径下部分 ANSI 颜色成员可能未初始化，应构造开头设默认值 | ANSI, ColorSingleton, Windows, 始化, 应构造开头设默认, 早退路径下部分 |
| `function-uncategorized-266260545cc0` | soft | function | uncategorized | process Windows 命令行转义需覆盖 ^ % 等特殊字符，确认规则完整 | Windows, process, 命令行转义需覆盖, 确认规则完整, 等特殊字符 |
| `function-uncategorized-54257e8962b4` | soft | function | uncategorized | fork 子进程 ChildProcess 中 opendir/readdir 等未必 async-signal-safe | ChildProcess, async, fork, opendir, readdir, safe |
| `function-exception_error-028dfaa2e18b` | soft | function | exception_error | CMakeLists 硬编码 ~/dev/cangjie/include，应改用环境变量或可发现路径 | CMakeLists, cangjie, dev, include, 可发现路径, 应改用环境变量或 |
| `style-complexity-1d0c41cbaabc` | soft | style | complexity | ParserImpl 顶层 decl 检查条件过长，建议提取命名函数提升可读性 | ParserImpl, decl, 建议提取命名函数, 提升可读性, 检查条件过长, 顶层 |
| `function-uncategorized-b3d39bd86f8a` | soft | function | uncategorized | ParseHeapDump 等解析失败仅打印仍返回 void，调用方无法感知不完整数据 | ParseHeapDump, void, 仍返回, 完整数据, 等解析失败仅打印, 调用方无法感知不 |
| `style-uncategorized-9544e751ea1d` | soft | style | uncategorized | 循环内 std::move(funcInfo) 后 funcInfo 处于 moved-from 状态，后续迭代需注释或改迭代方式 | from, funcInfo, move, moved, nullptr, std |
| `style-uncategorized-b368d0527e57` | soft | style | uncategorized | 结果选择逻辑在 result 已设时仍可能被 class 覆盖，行为需文档或重构 | class, nullptr, result, 已设时仍可能被, 结果选择逻辑在, 行为需文档或重构 |
| `function-logic_correctness-f13ac96b1ab5` | hard | function | logic_correctness | IntroduceParameter 对含局部变量引用的选中项改签名但不 UpdateCallSites，会导致调用点编译失败 | IntroduceParameter, UpdateCallSites, 会导致调用点编译, 失败, 对含局部变量引用, 的选中项改签名但 |
| `spec-uncategorized-75a41abe39ed` | soft | spec | uncategorized | IsPublicMember() 恒 true 会把 private 成员抽进 public interface，语义风险高 | IsPublicMember, interface, private, public, true, 会把 |
| `style-naming-0867462524a9` | soft | style | naming | 参数名 virtualFunc 实为 vector<VirtualMethodInfo>，建议改为 virtualMethods | VirtualMethodInfo, vector, virtualFunc, virtualMethods, 参数名, 实为 |
| `style-uncategorized-ad4edc883d30` | soft | style | uncategorized | ObjCId 文档应说明其在 objc.lang 作为 @ObjCMirror 标记接口/ObjC id 对应类型 | ObjC, ObjCId, ObjCMirror, objc.lang, 作为, 对应类型 |
| `style-uncategorized-9e5582c879da` | soft | style | uncategorized | ObjCInt128/ObjCUint128 建议提供默认 init() 与统一 public 构造写法 | ObjCInt128, ObjCUint128, init, public, 与统一, 建议提供默认 |
| `style-uncategorized-662c50d2cad6` | soft | style | uncategorized | stdx 构建文档应列出除 deveco 外所需 C 库、工具链与环境变量 | deveco, stdx, 外所需, 工具链与环境变量, 构建文档应列出除 |
| `style-uncategorized-b563bafaeb02` | soft | style | uncategorized | VArray/jumpState 初始化错误触发 CJC ICE（#884），需用正确 _NSHandler 初始化形式 | CJC, ICE, VArray, _NSHandler, jumpState, 初始化形式 |
| `spec-uncategorized-e67707e4ef0b` | soft | spec | uncategorized | shell 脚本应据 source/direct 执行方式选择 return 或 exit，避免误退出整个 shell | direct, exit, return, shell, source, 执行方式选择 |
| `style-uncategorized-ff39840defbf` | soft | style | uncategorized | leftExpr/rightExpr 的 Clear 应分别 if 判断，避免一侧 nullptr 时漏清另一侧 | Clear, leftExpr, nullptr, rightExpr, 判断, 应分别 |
| `style-uncategorized-e1a7c6aa05b9` | soft | style | uncategorized | args 循环应对 arg 用 CJC_ASSERT(arg!=nullptr) 而非 if 跳过，且避免 auto& 悬挂引用 | CJC_ASSERT, arg, args, auto, nullptr, 且避免 |
| `style-uncategorized-fef0b3d616f4` | soft | style | uncategorized | NSOrderedSet @ForeignName initWithObjects 重载冲突，需修复 constructor overloading | ForeignName, NSOrderedSet, constructor, initWithObjects, overloading, 重载冲突 |
| `style-dead_code-870ce6cfcf12` | soft | style | dead_code | SerializePackageToFb 可直接返回 buffer+size 结构体，GetPackage 不必单独 foreign | GetPackage, SerializePackageToFb, buffer, foreign, nullptr, size |
| `style-uncategorized-d110db4d066c` | soft | style | uncategorized | if 语句应加大括号（here and below），符合项目风格规范 | and, below, here, 符合项目风格规范, 语句应加大括号 |
| `style-uncategorized-5bc774408dc8` | soft | style | uncategorized | paramDftValHostFuncDecl 赋值可用 if-init 简化，避免重复 DynamicCast 与 nullptr 中间变量 | DynamicCast, init, nullptr, paramDftValHostFuncDecl, 中间变量, 简化 |
| `style-uncategorized-99f0ce513307` | soft | style | uncategorized | ClassLoading initialized 标志可改为计算属性，从设计上禁止无效实例 | ClassLoading, initialized, 从设计上禁止无效, 实例, 标志可改为计算属 |
| `style-uncategorized-23243f2ea440` | soft | style | uncategorized | 希腊字母 toLower 需 @TestCase 覆盖 standalone/final sigma 等 Unicode 规则 | TestCase, Unicode, final, sigma, standalone, toLower |
| `style-uncategorized-60fb0ea303a4` | soft | style | uncategorized | FindSerializationFile 应优先查 cjoFilePaths 缓存，避免包管理后重复磁盘查找 | FindSerializationFile, cjoFilePaths, 应优先查, 磁盘查找, 缓存, 避免包管理后重复 |
| `style-uncategorized-808cd5b9f8f2` | soft | style | uncategorized | tar checksum 编码可简化为 encodeChecksumTo(target) 直接写入目标数组 | checksum, encodeChecksumTo, tar, target, 直接写入目标数组, 编码可简化为 |
| `style-uncategorized-e23baf737efb` | soft | style | uncategorized | mayThrow 应写 targetTy->IsInteger()&&ofs==THROWING；noException 为其逻辑否定 | IsInteger, THROWING, mayThrow, noException, ofs, overflow |
