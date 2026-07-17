# QiaoCut Timeline v1

`qiaocut.timeline.v1` 是可直接渲染的工程时间线。它与导演层的 `qiaocut.ir.v0` 分工不同：IR 描述意图，timeline 只描述已经落实到本地素材、时间码、字幕和声音的确定性成片。

## 目录约定

渲染器只读取项目目录内的路径。`shots[].path`、字幕、旁白 JSON、字体目录、音乐、报告和最终视频都必须是项目相对路径；绝对路径和 `..` 越界会在运行 ffmpeg 前被拒绝。

```text
project/
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

`shots[].duration` 总和必须等于 `output.duration`。所有输出采用 H.264 High / yuv420p / BT.709、AAC 48 kHz stereo，并执行两遍 loudnorm。

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

公开分发的工程不要依赖某台电脑的用户字体目录。把可再分发的 CJK 字体放入项目（例如 `assets/fonts/`），在 timeline 写 `"fontsDir": "assets/fonts"`，并让字幕 JSON 的 `font` 与字体内部 family name 一致。找不到中文字形时，渲染器会明确失败，不会悄悄输出缺字成片。

## 旁白与音乐

`narration` 可以内联，也可以指向项目内 JSON。当前确定性 TTS 后端为 `macos-say`：

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

非 macOS 环境应使用已经录好的旁白作为镜头原声，或设 `narration.engine` 为 `none`。程序音乐由固定 seed 合成，因此同一时间线可重复得到相同结果；`music: false` 可关闭音乐，`music.mode: file` 可使用项目内现成音频。

## 渲染接口

```bash
node scripts/render_project.js ./project --json
node scripts/render_project.js ./project --timeline timelines/vertical.json --keep-build
node scripts/render_project.js ./project --force --json
```

- 成功退出码为 `0`；渲染或依赖错误为 `1`；CLI 用法错误为 `2`。
- `--json` 时 stdout 只输出最终 JSON，进度和 ffmpeg 日志写入 stderr。
- 每次使用唯一的 `.qiaocut/render-*` 构建目录；成功后默认只删除本次目录，`--keep-build` 用于排错。
- 所有已有生成目标默认保留；只有逐项核对后才使用 `--force`。输入与输出别名即使加 `--force` 也会拒绝。
- 默认限制超大分辨率、超过 4 小时、超过 120 fps 或超过 1000 个镜头；确有需要时审查资源成本后使用 `--allow-large`。
- 输出包括成片、contact sheet、render report 和流级技术验证。

脚本也可作为 Node 模块调用：

```js
const { renderProject } = require('./scripts/render_project');
const report = renderProject('/absolute/runtime/project/path', {
  timeline: 'timeline.json',
  keepBuild: false,
  onProgress: console.error
});
```

项目路径在运行时可以是绝对路径；timeline 内部路径仍必须保持项目相对。
