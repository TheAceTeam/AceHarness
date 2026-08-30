# Out Of Scope

- 不实现 DeepSeek provider SDK 的 ACEHarness 直连适配器。
- 不复制、迁移或改写用户的 DSH_HOME、credentials、settings、profiles、插件或 session 数据。
- 不在运行期间安装 npm 依赖、运行 `dsh plugin add` 或自动更新第三方包。
- 不修改 ACPX 通用权限模型或全局 runtime event schema。
- 不承诺第三方 OpenMA 项目的长期维护周期；版本升级需通过 package lock 和协议回归验证。
