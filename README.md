# CC GUI 提示词增强（prompt-enhancer）

为 CC GUI 桌面客户端的输入框增加“增强提示词”能力：点击按钮后由 DeepSeek 将普通需求润色为更严谨、可执行的提示词，预览确认后写回草稿，**永不自动发送**。

## 特性

- Composer 工具区一键“✦ 增强提示词”
- DeepSeek 直连增强，结果在弹窗中预览
- 保持原意与原语言；不补造事实；不改变 system/developer 层级
- 确认后通过 `composer.setDraft` 写回草稿，发送始终是用户动作
- 配置（Base URL / API Key / 模型）仅保存在本机插件私有存储，不上传、不同步
- 失败时给出简洁错误提示，原文不受影响

## 安装

1. 本仓库下载或克隆到本地目录。
2. CC GUI → 插件 → 从本地目录安装 → 选择包含 `manifest.json` 的这一层目录。
3. 打开插件设置页，填入你自己的 DeepSeek API Key（Base URL 默认为 `https://api.deepseek.com/v1`，模型默认 `deepseek-flash`），保存。
4. 在任意会话输入需求，点击“增强提示词”。

## 权限说明

- `events` / `composer:draft`：接收草稿事件、确认后写回草稿
- `ui:composer-status` / `ui:settings-section`：注册 Composer 按钮与设置页
- `theme`：注入界面样式
- `storage`：在本机保存你的 DeepSeek 配置
- `network:api.deepseek.com`：仅允许访问 DeepSeek API

## 隐私边界

- 不读取会话历史、不访问本地数据库、不读取任何密钥文件
- API Key 只保存在本机插件私有存储，源码中不包含任何密钥
- 点击增强时，当前草稿文本会发送至你配置的 DeepSeek 端点，请勿输入敏感信息
- 不自动发送任何消息

## 本地测试

```text
node tests/prompt-enhancer.test.mjs
```

## License

MIT
