# 自定义 Provider

claude-pets 自带 4 个内置 provider（`claude-cli`、`codex`、`opencode`、`openclaude`）。
第三方 agent CLI 可以通过一份 JSON 文件接入，无需改 pet 代码。

## 怎么加

把 JSON 放到 `~/.claude-pets/providers/` 下，文件名随意。
启动 pet，菜单「🤖 模型选择」里就会出现新选项。

```
~/.claude-pets/providers/
  ├─ aider.json
  ├─ llm-cli.json
  └─ my-custom-agent.json
```

每个 JSON 描述 1 个 provider。schema 见下文。

## Schema

```jsonc
{
  // 必填：唯一 id，会在 chat-store 里记录，改了会跟旧会话脱钩
  "id": "aider",

  // 必填：菜单里显示的名字
  "displayName": "Aider",

  // 必填：要 spawn 的二进制名（PATH 里找，或绝对路径）
  "binary": "aider",

  // 可选：参数模板。占位符：
  //   {prompt}     用户消息文本（如果 stdinPrompt:true 则替换成空串）
  //   {model}      当前会话选的 model id（来自 models[]）
  //   {sessionId}  之前 onSessionId 回调拿到的 native session id
  "args": ["--message", "{prompt}", "--no-pretty", "--stream"],

  // 可选：true 时 prompt 通过 stdin 传，false（默认）通过 {prompt} 替换
  "stdinPrompt": false,

  // 可选：该 agent 的配置目录（~ 会展开），用于「切换框架时
  // 切到该框架的全局配置」的语义。展示在菜单 hover tooltip 里。
  "configDir": "~/.aider.conf.d",

  // 可选：注入环境变量（spawn 时）
  "env": {
    "OPENAI_API_BASE": "https://api.deepseek.com/v1"
  },

  // 可选：可选的 model 列表，会出现在「模型选择」子菜单里
  "models": ["deepseek-chat", "deepseek-coder"],

  // 可选：默认选哪个 model
  "defaultModel": "deepseek-chat",

  // 可选：stdout 事件解析模式（默认 text-stream）
  "events": {
    "kind": "text-stream"
  }
}
```

## 两种事件解析模式

CLI 输出形式不同，event 解析方式不同。

### `text-stream`（默认，最简单）

CLI 直接把回复文本流式打到 stdout（无任何 JSON）。
适合：`aider`、`simonw/llm`、`mods`、ChatGPT-style 简单 CLI。

```json
"events": { "kind": "text-stream" }
```

行为：stdout 的每个 chunk 直接转发到 pet chat panel。
进程退出 = turn 完成。

### `json-events`（每行 JSON）

CLI 用 `--format json` 之类，每行是一个事件 JSON。
适合：`opencode run --format json`、`claude -p --output-format stream-json`。

```json
"events": {
  "kind": "json-events",
  "textPath": "part.text",
  "donePath": "type"
}
```

`textPath`：从每个事件里抽 assistant 文本块的 dotted 路径
（`part.text` 表示 `event.part.text`）。

`donePath`：当前实现里仅做占位，未来用于完成事件判定。

### 我该选哪个？

- 看 CLI 的 `--help`，找有没有 `--format json` / `--output-format` 类参数
- 有 → `json-events`，挑出哪个字段是 assistant 文本
- 没有 → `text-stream`

## 状态推送

pet 头顶气泡会自动显示这个 provider 的「思考中…」/「完成」状态：

| 时机 | pet 显示 |
|---|---|
| Spawn 子进程 | `<displayName> · 收到` 闪一下 → `· 思考中…` |
| 子进程退出 | `<displayName> · 完成` 闪一下 → 隐藏 |

工具调用细节（「读取 foo.ts」「运行 git」）暂不支持自定义 provider，
要这种粒度的状态请去看内置的 `OpenCodeProvider.ts` 的写法。

## 完整示例

见 `docs/examples/`：

- [`aider.json`](examples/aider.json) — Aider, text-stream 模式
- [`llm-cli.json`](examples/llm-cli.json) — Simon Willison 的 `llm`, text-stream

复制到 `~/.claude-pets/providers/` 就生效（重启 pet）。

## 避坑指南（来自内置 provider 的血泪经验）

### 1. CLI 自带的 plugin 系统可能锁死 model

如 opencode 1.14.28：用户全局装的 `oh-my-opencode-slim` plugin 通过 preset
把所有 agent 的 `model` 字段 hardcoded，CLI `--model` flag 完全被忽略。

**对策**：如果遇到「pet 切 model 没效果」，检查目标 CLI 的：
- 全局 config 里有没有 `model` 字段被插件覆盖
- 是不是支持 `--pure` 之类的「禁 plugin」模式
- 内置 `OpenCodeProvider.ts` 默认开 `--pure` 就是为这个

参考：[`learnings 2026-05-14 opencode model-lock`](https://github.com/sst/opencode/issues/26901)

### 2. plugin 可能只在某个 mode 触发 hook

opencode 1.14.28：plugin 的 `tool.execute.*` / `chat.message` 在
`opencode run` 触发，在 `opencode web` 不触发。

**对策**：写完 provider 后在 pet 的 dev log 里搜 `[HookServer]` 看推送有没有到，
没有就用 stdout 事件流自己 parse（参考 OpenCodeProvider.ts 的 stdout 解析）。

### 3. spawn 时 stdin 处理

如果 CLI 不需要 stdin 输入（prompt 走 args），**显式关 stdin**：
否则可能 hang。JsonProvider 默认会 `proc.stdin?.end()`，但 `stdinPrompt: false`
仍然是更稳的选择（除非你的 CLI 是交互式 REPL）。

### 4. 远程 API endpoint 可能慢

如果你接一个走自定义 baseURL 的 provider（如 OpenAI-compat 代理），
第一次响应可能要 10-30 秒。pet 头顶气泡有「(Xs)」计数和 30s 后变黄警告，
用户不会误以为卡死。

### 5. PATH 问题

Electron 启动时 PATH 不全。JsonProvider 自动 prepend 了
`/opt/homebrew/bin:/usr/local/bin:` 到 spawn 的 PATH 里。
其他位置的 binary 用绝对路径 (`/Users/me/.cargo/bin/my-cli`)。

## TODO（未来加强）

- [ ] `tool.use` 事件解析（让自定义 provider 也能显示「读取 foo.ts」）
- [ ] permission/confirm bubble 集成（危险工具调用要用户确认）
- [ ] session resume（`{sessionId}` 模板已经支持，但需要 provider 上报 native id）
- [ ] 图片附件支持（目前 JsonProvider 只传文本 prompt）
