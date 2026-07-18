---
name: listenhub-cli
description: |
  ListenHub CLI skills router. Routes to the correct skill based on user intent.
  Triggers on: "make a podcast", "explainer video", "read aloud", "TTS",
  "generate image", "generate video", "做播客", "解说视频", "朗读", "生成图片",
  "生成视频", "幻灯片", "slides", "音乐", "music", "generate music", "翻唱",
  "cover song", "pixverse", "口型", "lipsync", "对口型",
  "parse URL", "解析链接", "提取内容".
metadata:
  openclaw:
    emoji: "🎧"
    requires:
      bin: ["listenhub"]
    primaryBin: "listenhub"
---

## Purpose

This is a router skill. When users trigger a general ListenHub action, this skill identifies the intent and delegates to the appropriate specialized skill.

## Routing Table

| User intent | Keywords | Route to |
|-------------|----------|----------|
| ListenHub Voice end-to-end audio | "端到端音频", "语音生成", "图片转音频", "图片生成音频", "多音色对白", "参考音频克隆", "克隆音色", "音效", "生成音效" | `/listenhub-voice` |
| Podcast | "podcast", "播客", "debate", "dialogue" | `/podcast` |
| Explainer video | "explainer", "解说视频", "tutorial video" | `/explainer` |
| Slides / PPT | "slides", "幻灯片", "PPT", "presentation" | `/slides` |
| TTS / Read aloud | "TTS", "read aloud", "朗读", "配音", "语音合成" | `/tts` |
| Image generation | "generate image", "画一张", "生成图片", "AI图" | `/image-gen` |
| Video generation | "video", "视频", "seedance", "pixverse", "生成视频", "text to video", "做视频", "口型", "lipsync", "对口型" | `/video-gen` |
| Music | "music", "音乐", "生成音乐", "翻唱", "cover" | `/music` |
| Content extraction | "parse URL", "extract content", "解析链接" | `/content-parser` |
| Audio transcription | "transcribe", "ASR", "语音转文字" | `/asr` |
| Creator workflow | "创作", "写公众号", "小红书", "口播" | `/creator` |

## How to Route

1. Read the user's message and identify which category it falls into
2. Tell the user which skill you're routing to
3. Follow that skill's SKILL.md completely

If the intent is ambiguous, ask the user to clarify:

```
Question: "What would you like to create?"
Options:
  - "ListenHub Voice" — End-to-end audio: sound effects, multi-voice dialogue, reference-audio cloning, image→audio
  - "Podcast" — Audio discussion on a topic
  - "Explainer Video" — Narrated video with AI visuals
  - "Slides" — Slide deck / presentation
  - "Music" — AI-generated music or cover
  - "Video" — AI video generation from text or reference materials
```

## Prerequisites

Most skills require the ListenHub CLI. Check:

```bash
listenhub auth status --json
```

If not installed or not logged in, handle automatically — never ask the user to run install commands:

1. Auto-install: run `npm install -g @marswave/listenhub-cli` silently
2. Auto-login: run `listenhub auth login` (opens browser)

Exception: `/asr` runs locally and needs no CLI or API key.
