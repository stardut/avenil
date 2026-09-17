# IDE 导入验收记录

本记录对应 `outputs/rundock-ide-import-verification.md`，用于记录 RunDock IDE 导入的 production discovery/parser/apply 验收边界。

验收使用真实 `rundock::ide_import::{preview,store_preview,apply}` 与 `AppState`，harness 位于 `work/ide-import-verification`。没有复制解析逻辑，没有启动 AgentStory，也没有执行 fixture 中的命令。

`cargo check` 和前端 `npm run build` 均通过。目录选择流程改造后，harness 24/24 通过：从实际 AgentStory 项目根目录自动发现 `.vscode/launch.json`；混合 JSONC 候选完整返回；动态变量、`envFile`、attach 和 compound 保持 non-ready；参数 quoting、literal env 脱敏与快照恢复、自动发现 `.run/*.xml`、lowerCamel Maven/Gradle、目标项目的 Java Spring Boot 与 npm script launch、selection 校验、追加不覆盖和 active operation 拒绝均通过。

Java Application 只有 main class、缺少 classpath 时返回 `needsInput`；带可识别 Maven Spring Boot 项目的 VS Code Java launch 转换为 `mvn spring-boot:run`，并保留入口类、JVM 参数和环境变量；Java 非空 `args` 不自动转换；未知 IDEA 类型返回 `unsupported`。Import apply 只消费服务器 snapshot，不重读 source、不启动服务，并沿用现有 atomic config save 和“只保护本次变更涉及的 active/operation 服务”规则。
