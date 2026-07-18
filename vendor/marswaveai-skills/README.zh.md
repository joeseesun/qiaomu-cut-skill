<h1 align="center">MarsWave Skills</h1>

<p align="center">
<a href="https://github.com/marswaveai"><img alt="MarsWave" src="https://img.shields.io/badge/Made%20by%20MarsWave-000?logoColor=fff" /></a>
<a href="https://discord.gg/ZbwA7g2guU"><img alt="Discord" src="https://img.shields.io/discord/1365293903405645886?label=Discord&logo=discord&color=eee&labelColor=5865f2&logoColor=fff" /></a>
<a href="https://github.com/marswaveai/skills/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/marswaveai/skills?color=blue" /></a>
<br />
<a href="./README.md">English</a> | 简体中文
</p>

---

为编程 agent 打造的 AI 技能集——来自 [MarsWave](https://github.com/marswaveai)。

## 安装

```bash
npx skills add marswaveai/skills
```

## 更新

**npx skills**（推荐）：

```bash
npx skills update -g
```

**Git**（适合贡献者）：

```bash
cd path/to/marswaveai/skills
git pull origin main
```

更新后需重启 agent（Claude Code、Cursor 等）。

## 技能列表

### ListenHub — 内容创作

把想法变成视频、播客等多种内容形式。由 [ListenHub](https://listenhub.ai) 驱动。

| 技能 | 触发词 | 功能 |
|------|--------|------|
| `/listenhub-voice` | "生成音频"、"语音生成"、"端到端音频"、"图片转音频" | 端到端音频：音效、多音色对白、参考音频克隆、图片转音频 |
| `/podcast` | "做播客"、"podcast" | 生成播客单集（独白、对话、辩论） |
| `/explainer` | "解说视频"、"explainer video" | 带 AI 配图的解说视频 |
| `/slides` | "幻灯片"、"slides" | AI 配图的演示文稿 |
| `/tts` | "朗读"、"TTS"、"语音合成" | 文字转语音、配音 |
| `/music` | "音乐"、"music"、"混音"、"分轨" | AI 音乐：原创、混音、纯音乐、配乐、续写、区域改写、分轨、克隆人声、识别歌词 |
| `/image-gen` | "生成图片"、"画一张" | AI 图片生成 |
| `/video-gen` | "生成视频"、"video generation" | AI 视频生成（文字生成视频、首帧动画、参考素材引导） |
| `/content-parser` | "解析链接"、"提取内容" | URL 内容提取 |
| `/asr` | "转录"、"语音转文字"、"ASR" | 音频转文字 |
| `/creator` | "创作"、"写公众号"、"小红书"、"口播" | 创作者工作流——一键生成平台内容包 |

**配置：**

```bash
npm install -g @marswave/listenhub-cli
listenhub auth login
```

> `/content-parser` 和 `/creator` 仍需要 [ListenHub API Key](https://listenhub.ai/zh/settings/api-keys)。

### COLA

| 技能 | 触发词 | 功能 |
|------|--------|------|
| `/cola-avatar-pack` | "生成形象"、"avatar"、"表情包"、"梗图" | 生成像素风专属形象、资料卡、表情 GIF 和梗图贴纸 |

**配置：** 需要 Python 3.10+ 和 Pillow。详见 [cola-avatar-pack/SKILL.md](cola-avatar-pack/SKILL.md)。

## 目录结构

```
├── shared/              # 公共基础设施（认证、CLI 模式）
│
│   # ListenHub
├── listenhub-voice/     # 端到端音频生成
├── podcast/             # 播客生成
├── explainer/           # 解说视频
├── slides/              # 演示文稿
├── tts/                 # 文字转语音
├── music/               # AI 音乐生成
├── image-gen/           # AI 图片生成
├── video-gen/           # AI 视频生成
├── content-parser/      # URL 内容提取
├── asr/                 # 音频转文字
├── creator/             # 创作者工作流
├── listenhub-cli/       # CLI 认证与配置
├── listenhub/           # 路由 skill
│
│   # COLA
└── cola-avatar-pack/    # 形象包生成
```

## 支持的客户端

Claude Code · Cursor · Windsurf · OpenCode · Codex · Trae 等

如有问题，欢迎联系：support@marswave.ai

## 许可证

MIT
