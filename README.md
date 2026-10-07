# 提示词增强 0.5.1

默认使用专用文本 API，只提交输入框草稿。预览后确认写回，不自动发送。旧 Base URL、API Key、模型和各引擎模型设置原样保留；未设置增强方式的旧配置自动使用 API。

安装包不内置任何作者密钥或可用 token。每位安装者必须在设置中填写自己的 API Key；输入框按密码遮盖，接口错误不展示原始正文，返回文本若反射当前密钥会在预览及写回前脱敏。密钥经宿主私有 storage 保存，未宣称加密保险箱；不提交或随 Release 分发。

## 配置与验收

在插件设置里填写服务商提供的 Base URL、API Key、模型，点击“测试连接”。成功后点击“保存”，回到输入框点击“增强提示词”。测试使用当前表单，发送一条短文本并消耗少量额度，不自动保存配置。

支持普通 API、Token Plan、Coding Plan，前提是该套餐提供可供此客户端使用的文本 API。套餐额度由地址、密钥和账号权限决定，不由插件标签决定。ChatGPT / Claude / Gemini 网页会员登录不是 API Key。不会读取其他引擎的密钥，不伪造客户端标识。

| 服务 | Base URL 示例 | 自动协议 |
|---|---|---|
| DeepSeek | https://api.deepseek.com/v1 | Chat Completions |
| Kimi Coding | https://api.kimi.com/coding/v1 | Chat Completions |
| Kimi Coding Anthropic | https://api.kimi.com/coding/ | Messages |
| OpenAI API（GPT） | https://api.openai.com/v1 | Responses |
| Anthropic API（Claude） | https://api.anthropic.com/v1 | Messages |
| Google Gemini API | https://generativelanguage.googleapis.com/v1beta | generateContent |
| 兼容中转 / 国内套餐 | 使用服务商给的套餐专用地址 | 默认 Chat Completions；可手动改协议 |

模型填写服务商提供的模型 ID，名称存在不代表当前账号有权限。Kimi Coding 保留用户已有的 k3；Kimi 模型及会员权限以官方文档和真实请求为准。DeepSeek 预设为 deepseek-flash。国外服务预设不猜测账号可用模型，需自行填写。

完整的 /chat/completions、/responses、/messages、:generateContent 接口地址也可识别。中转服务不按模型名字猜协议；若其使用 Anthropic / Responses / Gemini 原生协议，在“API 协议”里明确选择。

## 响应与错误

默认 API 不启动 CLI、不读取引擎目录、不等待引擎失败。使用宿主 HTTP bridge，连接上限 10 秒、单次请求上限 30 秒；宿主只返回完整响应，没有流式或 HTTP 取消接口。超时不自动重试，不并行发送多次 API 请求。普通改写建议使用快速、低推理开销的模型。DeepSeek 官方请求关闭 thinking，Kimi 官方请求使用 low reasoning，其他参数按协议适配。

设置中的测试会显示模型、协议和用时。HTTP 400/401/402/403/404/429 分别提示参数、密钥、余额/套餐、权限、地址/模型、限流/额度问题；不展示原始错误正文、密钥或请求头。拒绝空结果、被截断、被拦截和仅有推理的结果。

## 可选引擎模式

“增强方式”选择“引擎优先，失败后使用 API”，可跟随当前对话引擎，也可指定单个引擎。填写本机现有空目录的绝对路径作为“引擎工作目录”，再读取模型列表并选择模型；未设置模型时用目录首个模型。Windows、macOS、Linux 使用各自本机路径；不内置作者电脑目录。未填写有效绝对路径时直接转 API。宿主 SDK 未公开当前对话具体模型/供应商，因此这是引擎默认通道，不承诺与会话绑定供应商或额度完全相同。

引擎首正文预算 30 秒（含目录读取），完整生成上限 120 秒，失败后使用配置 API。失败引擎冷却 60 秒，修改配置清除冷却。工具事件会中断增强任务并转 API；旧任务后台尽力停止，晚到事件丢弃，停止不及时可能短暂并行计费。新引擎任务可能出现在 CLI 会话历史里，插件不删除这些记录。

## 域名授权

官方 DeepSeek、Kimi / Moonshot、OpenAI、Anthropic、Google，以及常见国内套餐域名已声明精确网络权限。其他自定义域名受宿主权限限制，不能仅填地址就获得授权：

```powershell
& './authorize-host.ps1' -BaseUrl 'https://your-api.example/v1'
```

先下载或克隆本仓库，在仓库目录运行上述 PowerShell 脚本，再从插件页面重新安装该目录并保存配置。脚本只为该域名修改 manifest，不读取密钥。其他平台可手动向 manifest.permissions 添加精确的 network:域名后本地安装。没有 network:* 通配授权。修改后的授权是本地定制，后续市场更新可能替换 manifest，届时需重新授权。

## 安装与回滚

优先使用 CCGUI 插件市场安装和更新；也可克隆本仓库，CCGUI → 插件 → 从本地目录安装 → 选择仓库根目录，会热重载，无需重启宿主。每位用户自行配置密钥，发布包不包含本机配置、数据库、日志或验收材料。

需要回滚时，从可信的旧 Release 下载产物，放入一个目录后本地安装；不要选择“删除插件数据”。新增 mode/protocol/engineId/engineWorkspace 字段不改变既有地址、密钥和模型。

插件 id 与私有存储键保持稳定，代码只使用官方公开 SDK，最低宿主 1.1.0、SDK ^0.3.15；已对照官方 1.1.1 / SDK 0.3.15 核查能力和权限。常规宿主升级保留同一数据目录时，插件配置仍在该数据目录中。未来宿主破坏性变更需重新验收，不能承诺所有未来版本。0.3.3 升级新增 agent 和精确网络域名权限，市场需要人工审核及用户确认权限变化。

## 草稿保护与验证边界

重复点击不叠加请求；关闭、切换会话、禁用后丢弃旧结果；草稿被修改后旧结果不能写回。HTTP 取消只停止等待，服务端可能继续生成计费。连接测试不写草稿；表单变化或离开设置取消测试结果等待。

npm test 覆盖协议/鉴权、路径、原生响应解析、旧配置迁移、默认 API 不启动引擎、引擎选择和回退、错误脱敏、取消和草稿保护。模拟测试不能代替每个服务商账号的真实请求。“支持协议”不等于保证每个账号、网络、套餐都可用。

发布流程先执行 npm test 和 npm run check:secrets，扫描工作树及 Git 历史中的常见凭据模式。GitHub Action 从源码生成 main.js、manifest.json、checksums.txt；不会上传配置或测试材料。main 分支版本变更触发发版；也支持与 manifest.version 完全一致、无 v 前缀的 tag。所有检查通过才创建对应 Release，再登记中央索引的版本和产物 SHA256。

官方依据：
- https://developers.openai.com/api/docs/guides/text
- https://docs.anthropic.com/en/api/messages
- https://ai.google.dev/api/generate-content
- https://api-docs.deepseek.com/api/create-chat-completion
- https://www.kimi.com/code/docs/en/
