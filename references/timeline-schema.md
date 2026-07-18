# QiaoCut Timeline v1

`qiaocut.timeline.v1` 是可直接渲染的工程时间线。它与导演层的 `qiaocut.ir.v0` 分工不同：IR 描述意图，timeline 只描述已经落实到本地素材、时间码、字幕和声音的确定性成片。

## 目录约定

渲染器只读取项目目录内的路径。`shots[].path`、字幕、旁白 JSON、字体目录、音乐、报告和最终视频都必须是项目相对路径；绝对路径和 `..` 越界会在运行 ffmpeg 前被拒绝。

```text
project/
├── .qiaocut/cache/      # project-private generated cache; do not publish
├── timeline.json
├── narration.json
├── captions/captions.json
├── assets/
├── renders/
└── reports/
```

完整 JSON Schema：[`schemas/qiaocut.timeline.v1.schema.json`](schemas/qiaocut.timeline.v1.schema.json)。

## 最小可渲染示例

```json
{
  "schema": "qiaocut.timeline.v1",
  "title": "一个词，三层意思",
  "output": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration": 8,
    "loudnessLufs": -14,
    "truePeakDb": -1.5,
    "file": "renders/final.mp4"
  },
  "captionSource": "captions/captions.json",
  "captions": "captions/final.ass",
  "narration": "narration.json",
  "music": {
    "mode": "procedural",
    "path": "assets/audio/original-score.wav",
    "bpm": 88,
    "seed": 1337,
    "energy": 0.55
  },
  "shots": [
    {
      "id": "s01",
      "kind": "image",
      "path": "assets/opening.jpg",
      "duration": 4,
      "fit": "cover",
      "motion": "pushIn"
    },
    {
      "id": "s02",
      "kind": "video",
      "path": "assets/example.mp4",
      "in": 2,
      "duration": 4,
      "fit": "containBlur",
      "sourceAudio": true,
      "sourceGainDb": -2
    }
  ]
}
```

`shots[].duration` 总和必须等于 `output.duration`。所有档位采用 H.264 High / yuv420p / BT.709、AAC 48 kHz stereo；`preview` / `standard` 使用单遍 loudnorm，`final` 使用两遍 loudnorm。

## 双语三层字幕

`captionSource` 接受两种写法。紧凑的 `cues` 会自动展开为英文、中文、顶部注释三层：

```json
{
  "title": "Bilingual lesson",
  "font": "Noto Sans CJK SC",
  "cues": [
    {
      "start": 0.2,
      "end": 3.8,
      "english": "One word. [[THREE LAYERS.]]",
      "chinese": "一个词，三层意思。",
      "note": "EARTH → INVESTIGATE → LIKE",
      "source": "来源说明（如需要）"
    }
  ]
}
```

复杂排版可直接提供 `events`，支持 `English`、`Chinese`、`Note`、`Source`、`Card`、`CardChinese`、`BigWord`、`BigChinese` 样式。`[[文字]]` 会变成强调色。

若 timeline 明确设置 `fontsDir`，渲染器优先使用项目内字体。没有设置时，会查找本机已经安装的 Noto Sans CJK SC，并复制到项目私有的 `.qiaocut/cache/fonts/`，以隔离 Fontconfig 并稳定本机渲染；这只是本地缓存，不属于项目素材。

skill、Git 仓库和发布包不得捆绑、上传或再分发从用户机器发现的字体。跨机器复现若需要固定字体，应由项目维护者自行选择具有相应再分发许可的字体，记录许可证后再配置 `fontsDir`。找不到中文字形时，渲染器会明确失败或留下未验证状态，不会悄悄输出缺字成片。

## 旁白与音乐

`narration` 可以内联，也可以指向项目内 JSON。本机确定性 TTS 后端为 `macos-say`：

```json
{
  "engine": "macos-say",
  "voice": "Samantha",
  "rate": 174,
  "cues": [
    { "id": "n01", "start": 0.2, "maxDuration": 3.4, "text": "One word. Three layers." }
  ]
}
```

ListenHub TTS、ListenHub Voice、播客片段或用户录音先下载/导入项目，再使用文件型旁白：

```json
{
  "engine": "file",
  "path": "assets/generated/listenhub/audio/narration.mp3",
  "provider": "listenhub",
  "assetId": "listenhub-audio-<sha-prefix>",
  "speakerId": "<resolved-speaker-id>",
  "speakerName": "向阳乔木",
  "narrationTextSha256": "<64-char-sha256>",
  "start": 0,
  "trim": 0,
  "gain": 1
}
```

渲染器会把文件旁白转换为 48 kHz stereo、应用 trim/start/gain，并限制在成片时长内。声明 `provider=listenhub` 时必须带 asset/speaker/text provenance，且渲染前会校验 manifest 的 path、文件 SHA-256、speaker 与文本摘要；文件被替换会失败。远端临时 URL 不能直接写入 timeline。非 macOS 环境可使用 `file`，或设 `narration.engine` 为 `none`。程序音乐由固定 seed 合成，因此同一时间线可重复得到相同结果；`music: false` 可关闭音乐，`music.mode: file` 可使用项目内现成音频。

## 渲染接口

```bash
node scripts/render_project.js ./project --profile preview --json
node scripts/render_project.js ./project --profile standard --json
node scripts/render_project.js ./project --profile final --json
node scripts/render_project.js ./project --timeline timelines/vertical.json --keep-build
```

### 渲染档位

| Profile | 有效输出 | 音频 | 默认 Validation | Contact sheet |
|---|---|---|---|---|
| `preview` | 长边最多 960、最高 24 fps、x264 `ultrafast` / CRF 25；中间片段 CRF 28 | 单遍 loudnorm | `basic` | 默认关闭 |
| `standard` | 长边最多 1280、最高 30 fps、x264 `veryfast` / CRF 21；中间片段 CRF 24 | 单遍 loudnorm | `standard` | 开启，最多 8 帧、缩略图宽度最多 240 |
| `final` | 保留 timeline 的原始尺寸、帧率、preset 和 CRF | 两遍 loudnorm | `full` | 开启，服从 timeline 配置 |

为兼容 v0.2，不传 `--profile` 时仍使用 `final`。非 final 档自动派生独立输出，例如 timeline 的 `renders/final.mp4` 会对应为 `renders/final.preview.mp4` 或 `renders/final.standard.mp4`；生成的 ASS、contact sheet 和 render report 同样带档位后缀。`--output` 可指定新的项目相对输出路径，但仍遵守路径和 no-clobber 规则。

### 校验档位

| Validation | 始终检查 | 额外检查 |
|---|---|---|
| `basic` | 视频/音频流、非空文件、有效时长、有效尺寸、帧率、yuv420p | 无全片诊断扫描 |
| `standard` | `basic` 全部 | 最终响度、true peak、静音边界 |
| `full` | `standard` 全部 | 全片黑场区间 |

路径边界、软链接逃逸、输入输出别名、no-clobber、素材存在性、timeline 时长一致性和资源上限属于所有档位的前置安全门，不能通过降低 validation 绕过。`--validation basic|standard|full` 仅用于诊断覆盖范围；只有 `profile=final`、`validation=full`、验证成功且字幕字体不是 `system-unverified` 时，报告的 `releaseReady` 才为 `true`。

`qcut render` 已执行相应 validation 并把结果写入 render report。不要在它成功后对同一成片重复运行 `qcut verify`；独立 verify 用于外部生成、移动后或单独收到的视频。

### 缓存与性能证据

默认缓存位于 `.qiaocut/cache/`，包括镜头片段、macOS TTS、已烧录字幕的画面和仅供本机使用的字体副本。Fontconfig 运行状态放在每次唯一的构建目录，不作持久缓存。素材指纹、时间线参数、profile 或 ffmpeg 版本变化会产生新的缓存键；`--no-cache` 可在诊断时完全绕过缓存。报告中的 `cache` 和 `timings` 用于判断冷热缓存与各阶段耗时。

在同一开发机、同一个 60 秒 DIG 双语样片上的实测为：原始 final 71.6 秒；preview 冷缓存 27.7 秒、暖缓存 3.3 秒；standard 冷缓存 27.1 秒（TTS 已暖）、暖缓存 4.1 秒；final/full 冷缓存 65.6 秒（TTS 已暖）、暖缓存 8.5 秒。数字只用于同机相对比较。

- 成功退出码为 `0`；渲染或依赖错误为 `1`；CLI 用法错误为 `2`。
- `--json` 时 stdout 只输出最终 JSON，进度和 ffmpeg 日志写入 stderr。
- 每次使用唯一的 `.qiaocut/render-*` 构建目录；成功后默认只删除本次目录，`--keep-build` 用于排错。
- `.qiaocut/cache/` 默认跨构建复用；`--no-cache` 只关闭缓存，不降低安全检查。
- 所有已有生成目标默认保留；只有逐项核对后才使用 `--force`。输入与输出别名即使加 `--force` 也会拒绝。
- 默认限制超大分辨率、超过 4 小时、超过 120 fps 或超过 1000 个镜头；确有需要时审查资源成本后使用 `--allow-large`。
- 输出包括成片、按档位可选的 contact sheet、render report、缓存统计、阶段耗时和流级技术验证。

脚本也可作为 Node 模块调用：

```js
const { renderProject } = require('./scripts/render_project');
const report = renderProject('/absolute/runtime/project/path', {
  timeline: 'timeline.json',
  profile: 'preview',
  validation: 'basic',
  cache: true,
  keepBuild: false,
  onProgress: console.error
});
```

项目路径在运行时可以是绝对路径；timeline 内部路径仍必须保持项目相对。
