# 检查点规则表（97 条）

与 `rules_registry.json` 实例规则同步；评审以 registry 为准。

| # | rule_id | 检查点 |
|---|---------|--------|
| 1 | `style-uncategorized-193c6b18f3ba` | 公开 API 空指针检查不一致：ObjectAllocate/ArrayAllocate 等缺少输入参数 nullptr 校验 |
| 2 | `style-uncategorized-5d7470ba55c5` | ERRNO_EPERM 从 -2 改为 -4 后，上层仍将 ret==-2 当作 Operation not permitted，需同步错误码处理 |
| 3 | `style-uncategorized-1aab327ab818` | GetStdHandle 失败返回 INVALID_HANDLE_VALUE 而非 nullptr，对 hStdout/hStderr 的 nullptr 检查冗余且 API 用法不正确 |
| 4 | `style-uncategorized-9044faf3e0b7` | isIdempotentMethod 大小写敏感：method("get") 等小写不会被识别为幂等方法，影响自动重试 |
| 5 | `style-naming-5e3a78b2b32b` | maxCapacity 取 Int64.Max-8 缺少注释，未说明为何预留 8 字节 |
| 6 | `style-formatting-01cb1ac25f9b` | Content-Length 前导零校验 s[0]<b'1' 同时拒绝非数字开头字符串，建议在注释中明确设计意图 |
| 7 | `style-uncategorized-6f6b1763cde2` | 移除 readStringUnquoted 为非标准 JSON（如 {admin:true}）的破坏性变更，需评估兼容性或提供选项 |
| 8 | `style-uncategorized-58e1e6208a97` | String.fromJson 现支持 bool/null/number 转字符串，可能改变现有解析行为 |
| 9 | `style-uncategorized-bfb4a3a6dfcd` | Semaphore cnt.fetchSub(1) 在 synchronized 块外执行，高并发下计数可能与实际信号不匹配 |
| 10 | `style-uncategorized-a167a8eefd0c` | nextInt8/16/32/64(upper) 过滤负数后直接取模，存在与无符号函数相同的模偏移偏差 |
| 11 | `style-comment-d348e2fbf996` | validateHandle 新增 lazy init 与「非并发安全」注释矛盾，多线程可能重复 createExportHandle |
| 12 | `style-uncategorized-d013f62c1188` | Random 安全/线程警告仅在文档，random.cj 源码缺少对应类级注释 |
| 13 | `spec-api_abi_compat-7857a90a806a` | CPointerResource value 改 private 修复 UAF 可能破坏直接访问字段的现有代码，需迁移路径 |
| 14 | `spec-uncategorized-c7e307b8a7d7` | Branch.trueTarget 对 operands[1] 直接 as Block + getOrThrow，类型不符时公开 API 会抛异常 |
| 15 | `style-uncategorized-4d85e11d535a` | resource_pool 使用 synchronized(mux) 语法，需确认仓颉互斥锁规范是否与 lock/unlock 一致 |
| 16 | `function-exception_error-ca2be0ebd46f` | cjpm_openssl_strong.toml 硬编码 /tmp/stdx 等临时 link 路径，影响可移植构建 |
| 17 | `function-compiler_internal-4240cf1f14dc` | JsonParserPool.acquire 在 cache 不足时仍保留池中 parser 不清理，可能导致资源滞留 |
| 18 | `function-resource_lifecycle-5864e5a96d4a` | SM4 解密用 ArrayList 缓存全量明文，GB 级文件有 OOM 风险（GCM 需先验 tag 的权衡） |
| 19 | `function-uncategorized-39fefcc7e6a9` | isIdempotentMethod 未含 RFC 7231 中的 TRACE，严格遵循规范时可补充 |
| 20 | `function-boundary_overflow-12952a94e41b` | keys.c PEM 密码回调 memcpy 含终止符但返回 len-1，需确认 OpenSSL 边界与缓冲区写入 |
| 21 | `style-uncategorized-fd030da0fabf` | ColorSingleton 单例构造无线程安全保护，多线程首次访问可能竞态导致 ANSI 颜色未初始化 |
| 22 | `style-uncategorized-9e4d7f0d548f` | Exception init(causedBy) 分支可能未初始化 detailMessage 即用于 fillInStackTrace |
| 23 | `style-uncategorized-2050d1498a29` | AddIndirectExtend TypeMatchingImpl 多个 unordered_map 临时映射未见析构清理，有泄漏风险 |
| 24 | `style-uncategorized-975529c1ce05` | TreeMap quickEquals 改为仅 refEq，原 entrySize 内容比较语义变更需确认意图 |
| 25 | `style-uncategorized-7c01a1a87bda` | float16.isnormal 曾错误分类 denormalized 数，需补充 NaN/Inf/denormal 测试 |
| 26 | `style-uncategorized-cefd4bbd08d2` | isValidContentLengthFormat 除空串和 "0" 外直接 return true，未校验纯数字格式 |
| 27 | `style-uncategorized-6826810dfc2d` | CPointer 减法移除 @OverflowWrapping 改手动检查，需确认 addPointer 内部仍有溢出防护 |
| 28 | `style-uncategorized-a43193a05d51` | HTTP isValidContentLengthFormat 对 "abc" 等非数字直接通过，格式校验名实不符 |
| 29 | `style-uncategorized-ee69df2c5063` | CJ_JSON_ParseFloat64 用 512 字节栈缓冲，超长数字会被静默截断导致精度损失 |
| 30 | `style-magic_number-c399c57774a8` | HTTP 体大小三处硬编码 10MB，与 constants DEFAULT_MAX_BODY_SIZE(2MB) 不一致且分散 |
| 31 | `style-uncategorized-f5b29fbff363` | CPointerResource.use 先 isFree.load 再 action(value)，存在 TOCTOU 竞态可 UAF |
| 32 | `style-uncategorized-2140261d2672` | LibC.mallocCString 对 str.size==Int64.Max 时 length+1 溢出，应前置边界检查 |
| 33 | `style-formatting-0506a640d9f4` | isValidContentLengthFormat 只查首字符>=1，"abc"/"123abc" 会通过但 parse 失败且报错不准 |
| 34 | `style-uncategorized-ab7d7ec5b28b` | getScheduler 对 id<0 用 (0-id)%COUNT，需确认 Timer ID 是否可能为负 |
| 35 | `style-uncategorized-4eb7f474af97` | Array.splitAt left 的 len 参数从 start+mid 改为 mid，语义变更需确认是否为 bugfix |
| 36 | `style-uncategorized-e132aa328d0f` | logBase 声称修复 NaN 绕过校验，但可能仍未覆盖 base 为 NaN 等边界 |
| 37 | `style-uncategorized-6d987850e488` | Semaphore release 用 newValue 作 notify 次数，唤醒线程数与释放许可数可能不匹配 |
| 38 | `style-uncategorized-12552b6de041` | priority_queue 遍历 queuePool 查非空队列无整体同步，并发下索引选择可能过时 |
| 39 | `style-uncategorized-c546dd3718fa` | 文件上传移除 exists 检查改 File.create，需确认文件已存在时的抛错/覆盖行为 |
| 40 | `style-uncategorized-e82770f393ad` | dns.cj 移除 hints.ai_flags=AI_PASSIVE\|AI_ALL，可能改变解析/绑定地址类型行为 |
| 41 | `style-uncategorized-473d265aa578` | env.getVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致 |
| 42 | `style-uncategorized-a4fafbc14291` | env.removeVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致 |
| 43 | `style-uncategorized-8717b58609d1` | HttpNormalBody remainingLength 初始化为 contentLength 而非 data.size，可能越界读 |
| 44 | `style-uncategorized-8b9f9fbc19e7` | BinaryExpression Div 构造抛错英文 "maybe div 0" 表述不准，应为 division by zero |
| 45 | `style-complexity-c2db77040f06` | ActorMacro.cd 已 refactor 为 let+match，ReceiverModification.fd 仍 var+zeroValue 不一致 |
| 46 | `style-uncategorized-7ca7ffa35e8e` | Expression::OperandsToString 硬编码多个 ExprKind 判断 hasException，扩展性差 |
| 47 | `style-uncategorized-bcf6249094fd` | interpreted_frame_info_t 中 char* 字段生命周期/释放责任未在 API 文档说明 |
| 48 | `style-magic_number-7cb1576d56df` | parseFormat 用 MAX_FORMAT_WIDTH 限制 precision，浮点应使用 MAX_FLOAT_PRECISION |
| 49 | `function-compiler_internal-5889d4737881` | OptionLikeNonRef enum 构造误用 chirEnumType 类型参数作关联值类型，可能导致 ABI/布局不兼容 |
| 50 | `spec-uncategorized-5108b80470b2` | normalize 函数约 65 行含三平台逻辑，建议拆分为各平台辅助函数便于维护 |
| 51 | `function-performance-3e889f2b2930` | 编译器产物二进制兼容策略变更，混用旧版 cjo 可能导致运行错误，需在 PR/文档说明 |
| 52 | `function-uncategorized-ed59d7c3ab1c` | cjmp 下 fileId 取 hash 常为负，原 -1 表无效的 GetFileID 语义失效，需 optional 或重构 |
| 53 | `function-uncategorized-ea735f593352` | Print.cpp 将 TERM getenv 转 std::string 可能抛 bad_alloc，初始化路径应避免未捕获异常 |
| 54 | `function-performance-cece5b61e9a9` | Exception 允许任意 cause 链，A→B→A 循环引用可导致打印栈时无限递归 |
| 55 | `function-resource_lifecycle-03610bb8eff9` | DynPopFree 在 STRONG 模式仅 strcmp 少数符号，其他 free 函数缺少动态查找回退 |
| 56 | `function-security_input-fc7cb92884c6` | Interpreter initialized 非原子，多线程可能竞态使用未初始化 interpreter_interface |
| 57 | `function-null_safety-780fa5557e3b` | IsPendingSafePoint 遇 null tlData 仅 LOG 后 return false，关键路径应终止或抛错 |
| 58 | `function-uncategorized-49e140871229` | ConcurrentHashMap getHash 末尾表达式缺显式 return，可读性与风格不佳 |
| 59 | `function-logic_correctness-815bea14ae27` | libc.malloc(count=0) 改返回 null 替代 UB，依赖旧行为的调用点需回归 |
| 60 | `function-resource_lifecycle-7271895c88da` | thread.state 曾存在 UAF，需确认修复完整并加压力测试 |
| 61 | `function-uncategorized-eebadd60cef3` | Error pcArray/traceElementArray 改 protected var，外部直接访问字段的代码会编译失败 |
| 62 | `function-boundary_overflow-e9406d11082a` | tar_reader paxGlobalDataBytes 累加 global pax 大小，需防 Int64 溢出 |
| 63 | `function-uncategorized-e6f39fae0f81` | Comparable 将 NaN 视为大于非 NaN，与 IEEE totalOrder 不同，排序可能不符合预期 |
| 64 | `function-uncategorized-eb65d4062e24` | HTTP isIdempotentMethod 未含 TRACE（RFC 7231），与 #4/#19 同类规范缺口 |
| 65 | `function-resource_lifecycle-ba2db5b5eaa7` | JSON unittest cache 溢出条件用 cacheSize+1>=size，边界语义需确认是否应为 > |
| 66 | `function-boundary_overflow-8b1889127f2c` | CPointer minus 仅检查 offset==Int64.Min，(-1)*offset 乘法溢出路径可能未覆盖 |
| 67 | `function-resource_lifecycle-f9f76974dd3d` | fork 后父进程立即 FreeTwoDimensionalArray(arguments/environment)，需确认子进程 Exec 是否仍安全 |
| 68 | `function-performance-685e7c1facd9` | Random 拒绝采样 while(r>threshold) 理论上可无限循环（概率极低），大 upper 时更明显 |
| 69 | `function-uncategorized-02b1b8fe6116` | Windows OpenSSL 动态加载缺 SSL 库版本校验，仅检查 OS 版本不足 |
| 70 | `function-performance-b38d515cec65` | HttpNormalBody 用 ArrayList 逐块 add 再 toArray，多次扩容+最终拷贝有性能开销 |
| 71 | `function-resource_lifecycle-13f974d57002` | ColorSingleton Windows 早退路径下部分 ANSI 颜色成员可能未初始化，应构造开头设默认值 |
| 72 | `function-uncategorized-266260545cc0` | process Windows 命令行转义需覆盖 ^ % 等特殊字符，确认规则完整 |
| 73 | `function-uncategorized-54257e8962b4` | fork 子进程 ChildProcess 中 opendir/readdir 等未必 async-signal-safe |
| 74 | `function-exception_error-028dfaa2e18b` | CMakeLists 硬编码 ~/dev/cangjie/include，应改用环境变量或可发现路径 |
| 75 | `style-complexity-1d0c41cbaabc` | ParserImpl 顶层 decl 检查条件过长，建议提取命名函数提升可读性 |
| 76 | `function-uncategorized-b3d39bd86f8a` | ParseHeapDump 等解析失败仅打印仍返回 void，调用方无法感知不完整数据 |
| 77 | `style-uncategorized-9544e751ea1d` | 循环内 std::move(funcInfo) 后 funcInfo 处于 moved-from 状态，后续迭代需注释或改迭代方式 |
| 78 | `style-uncategorized-b368d0527e57` | 结果选择逻辑在 result 已设时仍可能被 class 覆盖，行为需文档或重构 |
| 79 | `function-logic_correctness-f13ac96b1ab5` | IntroduceParameter 对含局部变量引用的选中项改签名但不 UpdateCallSites，会导致调用点编译失败 |
| 80 | `spec-uncategorized-75a41abe39ed` | IsPublicMember() 恒 true 会把 private 成员抽进 public interface，语义风险高 |
| 81 | `style-naming-0867462524a9` | 参数名 virtualFunc 实为 vector<VirtualMethodInfo>，建议改为 virtualMethods |
| 82 | `style-uncategorized-ad4edc883d30` | ObjCId 文档应说明其在 objc.lang 作为 @ObjCMirror 标记接口/ObjC id 对应类型 |
| 83 | `style-uncategorized-9e5582c879da` | ObjCInt128/ObjCUint128 建议提供默认 init() 与统一 public 构造写法 |
| 84 | `style-uncategorized-662c50d2cad6` | stdx 构建文档应列出除 deveco 外所需 C 库、工具链与环境变量 |
| 85 | `style-uncategorized-b563bafaeb02` | VArray/jumpState 初始化错误触发 CJC ICE（#884），需用正确 _NSHandler 初始化形式 |
| 86 | `spec-uncategorized-e67707e4ef0b` | shell 脚本应据 source/direct 执行方式选择 return 或 exit，避免误退出整个 shell |
| 87 | `style-uncategorized-ff39840defbf` | leftExpr/rightExpr 的 Clear 应分别 if 判断，避免一侧 nullptr 时漏清另一侧 |
| 88 | `style-uncategorized-e1a7c6aa05b9` | args 循环应对 arg 用 CJC_ASSERT(arg!=nullptr) 而非 if 跳过，且避免 auto& 悬挂引用 |
| 89 | `style-uncategorized-fef0b3d616f4` | NSOrderedSet @ForeignName initWithObjects 重载冲突，需修复 constructor overloading |
| 90 | `style-dead_code-870ce6cfcf12` | SerializePackageToFb 可直接返回 buffer+size 结构体，GetPackage 不必单独 foreign |
| 91 | `style-uncategorized-d110db4d066c` | if 语句应加大括号（here and below），符合项目风格规范 |
| 92 | `style-uncategorized-5bc774408dc8` | paramDftValHostFuncDecl 赋值可用 if-init 简化，避免重复 DynamicCast 与 nullptr 中间变量 |
| 93 | `style-uncategorized-99f0ce513307` | ClassLoading initialized 标志可改为计算属性，从设计上禁止无效实例 |
| 94 | `style-uncategorized-23243f2ea440` | 希腊字母 toLower 需 @TestCase 覆盖 standalone/final sigma 等 Unicode 规则 |
| 95 | `style-uncategorized-60fb0ea303a4` | FindSerializationFile 应优先查 cjoFilePaths 缓存，避免包管理后重复磁盘查找 |
| 96 | `style-uncategorized-808cd5b9f8f2` | tar checksum 编码可简化为 encodeChecksumTo(target) 直接写入目标数组 |
| 97 | `style-uncategorized-e23baf737efb` | mayThrow 应写 targetTy->IsInteger()&&ofs==THROWING；noException 为其逻辑否定 |
