# QiaoCut IR

`QiaoCut IR` 是 qiaomu-cut 的中间格式。它把自然语言需求变成平台无关的视频工程语义，再交给素材 adapter 和渲染器执行。

## 最小结构

```json
{
  "schema": "qiaocut.ir.v0",
  "brief": "做一个 60 秒挖掘机英语启蒙视频",
  "workflow": {
    "id": "stock-story",
    "title": "免费素材故事片"
  },
  "output": {
    "durationSeconds": 60,
    "aspect": "9:16",
    "platform": "douyin",
    "deliverables": [
      "final.mp4",
      "assets-manifest.json",
      "license-report.md",
      "quality-report.json"
    ]
  },
  "sources": {
    "preferred": ["clipseek", "local", "imagegen", "listenhub"],
    "licenseRule": "Record sourcePage/license/attribution for every non-local asset."
  },
  "generation": {
    "narration": {
      "providerPriority": ["listenhub", "project-file", "macos-say"],
      "preferredVoiceName": "向阳乔木",
      "resolutionRule": "Resolve an exact current speaker-name match; never silently substitute."
    },
    "images": {
      "styleStrategy": "content-derived",
      "visualBibleRequired": true,
      "visualBibleId": "vb-<16-char-digest>",
      "promptPrefix": "subject; medium; era; emotion; palette; lighting; composition",
      "negativePrompt": ["generic stock-photo look", "style drift", "anachronisms"]
    }
  },
  "scenes": [],
  "render": {
    "primary": "ffmpeg-full",
    "optional": ["html-renderer", "motion", "manim"]
  },
  "gates": ["doctor", "source manifest", "license report", "video verify"]
}
```

## Scene 字段

| 字段 | 说明 |
|---|---|
| `id` | 稳定 scene id，例如 `s01` |
| `purpose` | hook、context、development、turn、payoff、outro |
| `visual` | 画面描述或素材要求 |
| `sourceStrategy` | 使用哪些素材源：33tc、clipseek、local、imagegen、web-info |
| `motion` | 运镜或动效，例如 slow_push_in、parallax_photo |
| `transition` | 转场，例如 match_cut、whip_pan、soft_cut |
| `text` | 字幕、词卡、标题、lower third |
| `audio` | 原声、旁白、音乐、ducking、节奏点 |
| `verification` | 当前 scene 的检查要求 |

## Asset 字段

| 字段 | 必需 | 说明 |
|---|---:|---|
| `source` | 是 | qiaomu-cut adapter 名称 |
| `provider` | 是 | 原始提供方，例如 pexels、pixabay、user-local-file |
| `mediaType` | 是 | video、photo、illustration、audio、html、svg、generated-image |
| `title` | 否 | 可读标题 |
| `sourcePage` | 外部素材必需 | 原始素材页 |
| `downloadUrl` | 可选 | 真实下载 URL，不应替代 sourcePage |
| `localPath` | 下载后必需 | 本地文件路径 |
| `licenseStatus` | 是 | verified、verify_at_provider、user_provided、ai_generated |
| `attribution` | 是 | 署名或来源说明 |

AI 旁白 provenance 额外记录 `speakerId`、`speakerName`、`speakerCatalogSha256`、`narrationTextSha256`、task/capture/model/credit；AI 图片记录 `visualBibleId`、实际 `prompt`、`seed`（provider 返回时）和 model。相同 SHA/provider/mediaType 只保留一个资产记录，但 `provenanceRuns` 保留重复生成任务与积分历史。

## 设计原则

- IR 不是最终渲染脚本，它是导演意图和可审计计划。
- 每个素材和事实都要能回溯。
- 渲染器可以替换，但 IR 的 scene/asset/audio/text 语义应该稳定。
- 缺证据时写 `missing evidence`，不要把计划伪装成已执行。
- 新增中文讲解音频默认使用 `qcut listenhub narration`：优先 ListenHub 的“向阳乔木”显示名，只接受当前 speaker list 的唯一精确匹配，自动入库后才进入带身份与内容 SHA 校验的 `narration.engine=file`。
- 生图风格从主题、受众、年代、情绪、平台和媒介推导为具体 visual bible ID/媒介/色板/光线/构图/prompt prefix；实际 prompt/seed/model 通过 ingest/fetch 回写，不能用与内容无关的通用风格词替代导演判断。
