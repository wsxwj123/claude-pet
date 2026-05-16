# claude-pets

> 一个透明、永远置顶的桌面宠物，背后是个**统一 agent CLI 壳**：
> 你装了什么 CLI（Claude Code / Codex / opencode / aider …），pet 就能用什么。

<p align="center">
  <img src="build/icon.png" width="160" alt="claude-pets" />
</p>

<p align="center">
  <a href="https://github.com/wsxwj123/claude-pet/releases"><img alt="release" src="https://img.shields.io/github/v/release/wsxwj123/claude-pet?label=release"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="#installation"><img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey"></a>
</p>

---

## 简介

把一个会跑会跳的小宠物钉在桌面上。它头顶气泡显示**当前你所有 agent CLI 在做什么**（在思考、在读文件、在跑 bash），双击一下跳回那个 agent 的窗口；右键点开一个干净的悬浮菜单，里面是对话框、历史会话、模型选择、截图分析、语音输入。

它**不替你写一行代码**——它是把你已有的 agent CLI（Claude Code / Codex / opencode / openclaude / 任何你写过 JSON 配置的 CLI）整合到桌面侧，让你在任何 app 前台都能 1 个快捷键调出对话框。

### 它做的事

- 🐾 **桌面宠物** — 透明全屏覆盖窗口，可拖到任意位置/边缘，鼠标穿透（不挡 Bob / Raycast / 等浮层）
- 💬 **多 agent 对话框** — 同一个 chat 面板，下拉切 Claude Code / Codex / opencode / openclaude / 自定义 JSON provider
- 📸 **截图分析** — 拖拽选区截图 → 自动塞进对话框 → 发给当前 agent 分析
- 🎙 **语音输入** — 调用本地 `voice-bridge` (SenseVoice) 把麦克风音频转成文本
- ⌨️ **全局快捷键** — 在任何 app 前台一键召唤对话框/截图/显隐 pet（默认 `⌘⇧C` / `⌘⇧S` / `⌘⇧H`，可改）
- 🔔 **状态气泡** — pet 头顶实时显示「读取 utils.ts / 运行 git / 思考中…」，多 agent 同时跑会**叠多行**
- 📌 **置顶对话框** — 复制粘贴到外部 app 时不会被失焦关闭
- 🪟 **可调大小** — chat panel 8 方向 resize，尺寸持久化
- 🎨 **多宠物** — 自动加载 `~/.codex/pets/` / `~/.petdex/pets/` / `~/.claude/pets/` 下的所有 pet，缩略图切换

### 它不做的事

- 不发送任何数据到自己的服务器——所有 LLM 请求都走你已配置好的 CLI 自己的后端
- 不修改你的 Claude/Codex/opencode 全局配置（除了一次性注入 hook 让 pet 能监听状态）
- 不要求你额外配 API key——pet 调你已经能跑的 CLI

---

## Installation

### macOS

#### 方法一：下载 dmg（推荐）

去 [Releases](https://github.com/wsxwj123/claude-pet/releases) 下载 `claude-pets-<version>-mac-arm64.dmg` (Apple Silicon) 或 `claude-pets-<version>-mac-x64.dmg` (Intel)，拖入 Applications。

第一次打开会提示「未签名」，按住 `Ctrl` 点击图标 → 打开 → 同意。或在终端：

```bash
xattr -dr com.apple.quarantine /Applications/claude-pets.app
```

#### 方法二：从源码编译

```bash
git clone https://github.com/wsxwj123/claude-pet.git
cd claude-pet
npm install
npm run package:mac
open release/mac-arm64/claude-pets.app
```

### Linux

```bash
# 从 Releases 下载 AppImage
chmod +x claude-pets-<version>.AppImage
./claude-pets-<version>.AppImage
```

或源码编译：`npm install && npm run package:linux`。

### Windows

从 Releases 下载 `.exe` installer。或 `npm install && npm run package:win`。

---

## 装好之后

pet 会自动：

1. 扫描你 `~/.codex/pets/` / `~/.petdex/pets/` / `~/.claude/pets/` 下的宠物 sprite
2. 检测 `claude`、`codex`、`opencode`、`openclaude` 二进制（PATH + 常用安装路径 + macOS .app bundles）
3. 给所有 detected agent 注入 hook（让它们的状态推到 pet 的 `:7779`）
4. 启动 Tray 图标，pet 出现在屏幕

**首次启动不需要任何配置**。

---

## Supported Providers

| Provider | 安装命令 | 检测路径 |
|---|---|---|
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` 或 brew | `claude` in PATH |
| **Codex** | `npm i -g @openai/codex` 或 `brew install --cask codex` | `codex` in PATH or `/Applications/Codex.app/Contents/Resources/codex` |
| **opencode** | `curl -fsSL https://opencode.ai/install \| bash` | `~/.opencode/bin/opencode` 或 PATH |
| **openclaude** | `npm i -g @gitlawb/openclaude` | `openclaude` in PATH |
| **自定义** | 把 JSON 文件丢到 `~/.claude-pets/providers/` | 见 [docs/CUSTOM_PROVIDERS.md](docs/CUSTOM_PROVIDERS.md) |

未安装的 provider 在「模型选择」菜单里显示「未安装」灰禁用，不影响其他 provider 使用。

---

## Quick Start

1. 拖动 pet 到屏幕喜欢的位置（试试角落 / 边缘，自动贴边）
2. 单击 pet → 弹出悬浮菜单
3. 「新对话」→ 顶部下拉选 provider + model → 输入消息 → Enter
4. 或者按 `⌘⇧S`（全局）→ 拖一个区域截图 → 自动塞进新对话 → 描述你想问什么

更多快捷键和设置：菜单 → ⚙️ 设置 → 快捷键。

---

## Custom Providers

任何 CLI 只要能用 stdin/args 接 prompt + stdout 出文本（或 JSON 事件流），都能 30 秒接入。在 `~/.claude-pets/providers/` 放一个 JSON：

```json
{
  "id": "aider",
  "displayName": "Aider",
  "binary": "aider",
  "args": ["--message", "{prompt}", "--no-pretty", "--stream", "--yes-always"],
  "configDir": "~/.aider.conf.d",
  "models": ["openai/gpt-5.5", "anthropic/claude-opus-4-6"],
  "defaultModel": "openai/gpt-5.5",
  "events": { "kind": "text-stream" }
}
```

详细 schema + JSON 事件解析模式 + 避坑指南：**[docs/CUSTOM_PROVIDERS.md](docs/CUSTOM_PROVIDERS.md)**

---

## Pet Sprites

每个 pet 是一张 `1536×1872` 的 spritesheet（8 列 × 9 行，每帧 192×208）+ `pet.json` 元数据。

- 现成宠物：用 `petdex` 下载，自动放到 `~/.petdex/pets/`，pet 会立刻看到
- 自己造：用 Claude 的 `hatch-pet` skill，9 行 prompt 一步步喂 ChatGPT 出图，工具脚本自动拼图打包到 `~/.claude/pets/`

教程：[docs/GENERATING_PET_ASSETS.md](docs/GENERATING_PET_ASSETS.md)

---

## 配置文件位置

| 文件 | 用途 |
|---|---|
| `~/.claude-pets/config.json` | pet 自己的设置（位置、大小、快捷键、默认 provider） |
| `~/.claude-pets/chat.json` | 历史会话 |
| `~/.claude-pets/providers/*.json` | 自定义 provider |
| `~/.claude/settings.json` 等 | pet 注入的 hook（让 CLI 推状态给 :7779）；其他字段不动 |

**清空全部 pet 数据**：`rm -rf ~/.claude-pets/`（不影响 Claude/Codex 自己的配置）。

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│  ├─ BrowserWindow (transparent always-on-top overlay)       │
│  ├─ HookServer :7779 ←── Claude/Codex/opencode hooks         │
│  ├─ ProviderRegistry                                         │
│  │   ├─ ClaudeCliProvider   (spawns `claude -p`)             │
│  │   ├─ CodexProvider       (spawns `codex exec --json`)     │
│  │   ├─ OpenCodeProvider    (spawns `opencode run --pure`)   │
│  │   ├─ OpenClaudeProvider  (spawns `openclaude -p`)         │
│  │   └─ JsonProvider×N      (any CLI declared in JSON)       │
│  ├─ ChatStore (JSON, ~/.claude-pets/chat.json)               │
│  ├─ ConfigStore (~/.claude-pets/config.json)                 │
│  ├─ ScreenCapture (macOS `screencapture`)                    │
│  └─ Voice transcription (POST → :7788 voice-bridge)          │
└──────────── IPC ───────────────────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────────────┐
│ Renderer (React + Tailwind)                                 │
│  ├─ PetWidget   pet sprite + drag + edge clamp              │
│  ├─ HoverMenu   chat / history / agent picker / settings    │
│  ├─ StatusLabel multi-line bubble (multi-agent)             │
│  └─ Icon         inline SVG icon set (no emoji)             │
└─────────────────────────────────────────────────────────────┘
```

---

## Development

```bash
git clone https://github.com/wsxwj123/claude-pet.git
cd claude-pet
npm install
npm run dev          # 开发模式，热重载
npm run typecheck    # tsc --noEmit
npm run package      # 打 dmg 到 release/
```

主要源码：

- `src/main/`  Electron 主进程
- `src/main/services/providers/`  Provider 系统（各 CLI 适配器）
- `src/renderer/`  React UI
- `src/preload/`  IPC bridge
- `src/shared/`  共享类型
- `bin/claude-pets-hook.js`  agent hook 接收 helper

详细 review、避坑见 `docs/`。

---

## Roadmap

- [x] 多 provider 抽象 + 内置 4 个（Claude Code / Codex / opencode / openclaude）
- [x] 自定义 JSON provider
- [x] 多会话历史 + 流式 + 多图附件 + 跨 session 隔离
- [x] 截图分析（macOS / Windows / Linux 各平台原生）
- [x] 语音输入（local SenseVoice STT）
- [x] 全局快捷键 + chat panel resize + pin
- [x] 跨平台 binary auto-detect（含 macOS .app bundle / Linux AppImage）
- [x] 多 agent 同时状态显示
- [x] 跨平台打包（macOS arm64/x64 · Windows x64 · Linux x64/arm64 AppImage+deb）
- [x] GitHub Actions 自动 release workflow
- [ ] **D2 边缘吸附 sprite**（需要美术，prompt 已写在 [docs/GENERATING_PET_ASSETS.md](docs/GENERATING_PET_ASSETS.md)）
- [ ] 危险工具调用确认弹窗
- [ ] 代码签名（macOS Developer ID + Windows EV cert，消除 Gatekeeper / SmartScreen 警告）
- [ ] auto-update（electron-updater）
- [ ] 开机自启 toggle
- [ ] 国际化（i18n 英文 UI）

当前版本：v0.1.9。版本历史见 [Releases](https://github.com/wsxwj123/claude-pet/releases)。

---

## License

MIT © 2026 wsxwj123. See [LICENSE](LICENSE).

特别鸣谢：[petdex](https://github.com/wsxwj/petdex) 的 pet 资源系统、Anthropic Claude / OpenAI Codex / sst opencode / Gitlawb openclaude 各自的 CLI 工具。
