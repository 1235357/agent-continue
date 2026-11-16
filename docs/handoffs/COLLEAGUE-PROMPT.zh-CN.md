# 可直接复制给接手同事

请接手 AgentContinue，先阅读：

`D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo\docs\handoffs\2026-11-10-PROJECT-HANDOFF.zh-CN.md`

唯一工作仓库是 `D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`，唯一分支main。已推送基线是c00499f8f0285890cedb39aea0c4b4cf564038f7，但当前有10个文件的未提交后续修复；务必保留并审阅，不要reset、覆盖或将旧dist3.0.12 ZIP直接发布。交接包source是工作树快照，pending-tracked.patch相对于上述基线。

最高优先级：修好ChatGPT/Dot的全自动后台发送。准确覆盖配置prompt、移除待发composer附件；同会话内容变化、重挂载和慢Send不能结束已知未提交的本轮。无应用级prompt上限、无总等待时限；Pause、准确目标和已尝试/未知提交不盲重放仍保留。手动发送后不能继续灌入。不要把DOM已填、在线图标或零计数当作实际发送证据。

当前源码已复现并修复多条真实问题：最终许可ACK丢失、授权/dispatch混淆、手动发送后remount漏监听；本轮WIP进一步修复旧activity日志挡住控制队列、非发送Enter误设manual fence、新view漏准备通知、Clear双屏障和健康日志闭包积累。交接快照重新运行background-v2为80/80、editor单测102/102；PM新增53-55有独立RED/GREEN报告，但最终组合全套和当前真实用户实例仍未验收。Windows云端42875069957失败，本机夹具修复11pass/1skip不代替新CI。

产品总目标仍包括普通ChatGPT/Dot经官方OpenAI MCP隧道实际控制Windows：当前账户/管理员文件、PowerShell、自建进程、Pause/Revoke和保存running意图的浏览器重开恢复。采用Node/PowerShell/CMD命令安装，可经同意获取官方Node；不再做自定义EXE/MSI。Windows优先，不要先扩Linux，不动生产VPN/MCP/IDE/科研和外部Chrome原任务。

先读实际代码与手册，再冻结源代码、完整测试、重构成对制品、真实普通chat后台验收，再完成对应管理员生命周期、GitHubRelease和Chrome商店审核提交。商店最近读回3.0.11 Pending review；manifest3.0.12尚未发布。英文默认+中文切换，突出邮箱zhentongye2028@u.northwestern.edu、GitHubIssues和LinkedIn。Google曾以YellowArgon拒绝文件格式关键词堆砌，勿恢复旧描述。

已授权使用内置浏览器/必要工具，避免重复泛泛请示。但如果工具明确拒绝chrome-extension页面，不得用CDP、OS GUI或资料文件绕过；应仅交由用户完成那个具体按钮动作。历史r11已撤销，旧Ready和旧测试不能授权新连接，也不能重复未知Start/Bind。原goal当前usageLimited，不要标记完成、擅自恢复或新建替代目标。

请先给出基于当前git状态的接手判断、最短修复/验证顺序，然后实际推进；所有“测试通过、已安装、已发布、已提交审核”必须各有对应版本/快照的真实回执。
