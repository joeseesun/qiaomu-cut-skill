# English Mix Fast Path

目标：把影视英语学习混剪的昂贵错误拦在远端裁切之前，把网络恢复、源素材验收和字幕手机审查变成可复现命令。

## 1. 初始化

```bash
node scripts/qcut.js english-mix init ./project \
  --phrases "That makes sense.|I see what you mean." \
  --clips-per-phrase 4 --json
```

命令创建 `source-selection.json` 和 `assets/source`、`assets/rejected`、`captions`、`scenes`、`renders`、`reports`。`targetCount` 是上限，不得重复素材凑数。

## 2. 付费前锁定字幕上下文

搜索池至少为目标数的 2–3 倍。每个候选在 `clips[]` 保存：

```json
{
  "id": "makes-01",
  "videoId": 7350,
  "sourceStartMs": 1389480,
  "sourceEndMs": 1395150,
  "english": "Does that make sense? That makes sense.",
  "contextBefore": 1,
  "subtitleWindow": {
    "before": [
      { "start": 1387.63, "end": 1389.63, "content": "We need one more person" }
    ],
    "previous": { "start": 1389.93, "end": 1392.64, "content": "so then we'll focus on plating the dishes." },
    "current": { "start": 1392.72, "end": 1394.40, "content": "Does that make sense? That makes sense." },
    "next": { "start": 1394.47, "end": 1396.89, "content": "Okay. Thank you, everyone." }
  }
}
```

时间单位为秒；付费 range 仍用毫秒。运行：

```bash
node scripts/qcut.js english-mix audit ./project --strict-boundaries --json
```

如果 setup 以小写、标点或省略号开始，说明它可能位于句中；继续向前取字幕，直到语义起点明确。不能把 `previous/current/next` 只有三条当成完整上下文保证。

## 3. 远端裁切与恢复

核对片名、范围、输出目录和预计任务数，得到当前明确确认后才传 `--yes`。并发控制在 2 个下载任务，避免同时对媒体 CDN 建立过多长连接。

`qcut 33tc pick|cut|download` 会为 HTTP(S) 媒体输入注入有限的 ffmpeg reconnect/retry。若仍失败但输出包含 task ID：

```bash
node scripts/qcut.js 33tc download EXISTING_TASK_ID \
  --no-status --output ./project/assets/source
```

不得重新运行 `cut --yes` 只为修下载；这会重复创建可能收费的任务。`QIAOMU_33TC_FFMPEG_RETRY=off` 仅用于诊断。

## 4. 下载后硬审计

稳定重命名为 `assets/source/<clip-id>.mp4`，随后运行：

```bash
node scripts/qcut.js english-mix audit ./project \
  --require-media --strict-boundaries --json
```

审计写入 `reports/source-audit.json`，硬拦截：

- 纯音频或缺少音轨；
- 重复 video/range 或重复文件 SHA-256；
- 目标表达未出现在 selection/SRT；
- 付费范围晚于完整上下文起点或早于完整句落点；
- 严格模式下没有 `subtitleWindow` 证据。

不合格文件移到 `assets/rejected/` 并保留 task ID 与原因，不进入 timeline。

## 5. 给影视片段留呼吸

完整句并不自动等于舒服的剪辑点。通过素材审计后、写 timeline 前运行：

```bash
node scripts/qcut.js english-mix pace ./project --crossfade-ms 200 --apply --json
```

默认生成 `assets/processed/<clip-id>.mp4`，不覆盖 `assets/source/` 原始下载：

- 裁句：在 selection 的 clip 上写 `trimStartMs/trimEndMs`，先去掉落在边界上的半句或下一句残片；
- 开头：静音首帧 60 ms，音频淡入 40 ms，只用于防爆音，不制造明显等待；
- 结尾：音频淡出 160 ms，静音尾帧 500 ms；配合 200 ms 转场时，至少约 300 ms 完整尾帧后才开始换画面；
- 验收：首尾采样必须低于 -60 dB，结果写入 `reports/english-mix-pacing.json`；
- timeline 使用 selection 中的 `processedPath`，字幕时间整体后移 `leadHoldMs`；
- 每个非首 shot 写入 `transition: {"type":"fade","duration":0.2}`。渲染器同步执行 audio acrossfade，caption/shot 起点要扣除相同 overlap。

优先通过扩大原始 range 获得真实环境声停顿；但如果扩大范围会切入下一句，就裁掉残句，再使用上述静帧 + 静音派生。参数可按语速调整，但开头不得低于 20 ms，结尾不得低于 200 ms。静音派生后仍使用硬切会出现“停住—跳画面—再停住”，这是失败状态；必须在 preview 的 render report 中看到非空 transitions。

品牌卡的第 0 帧必须已经是完整可读封面，不允许先空白再慢慢组装。封面与短语介绍卡必须分开计时：封面最长 700 ms；短语介绍卡默认 2000 ms、最长 2200 ms，确保表达与释义可以从容读完；第一句有效原声最晚在 2.6 秒出现。用 `silencedetect` 实测，不凭时间线目测判断。

## 6. 一次渲染全部品牌卡

把片头、分组卡、复习卡和片尾写入项目内 batch JSON：

```json
{
  "scenes": [
    { "source": "scenes/intro.html", "engine": "html", "output": "assets/cards/intro.mp4", "duration": 2.8, "width": 1080, "height": 1920, "fps": 30 },
    { "source": "scenes/outro.html", "engine": "html", "output": "assets/cards/outro.mp4", "duration": 3.2, "width": 1080, "height": 1920, "fps": 30 }
  ]
}
```

```bash
node scripts/qcut.js scene batch ./project scenes/cards-batch.json --json
```

1–32 个 HTML/SVG 场景共用一次 Chrome 启动。不要在 shell 循环里逐个执行 `scene render`。

## 7. Preview 与手机审查

```bash
node scripts/qcut.js render ./project --profile preview --json
node scripts/qcut.js english-mix review ./project --frames 8 --json
```

后一个命令从 `sourceAudio=true` 镜头自动取最多 8 个代表帧，并定位最长 English caption 生成手机尺寸单帧：

- `reports/english-mix-review/contact-sheet.jpg`
- `reports/english-mix-review/phone-long-caption.png`
- `reports/english-mix-review/review.json`

必须人工确认三层字幕不压电影画面、人物或原片字幕，同时评估 TikTok/抖音 UI 风险。修订 captions 时复用 shot cache；不用重做远端素材和卡片。

## 8. Final

只有 source audit、代表帧、手机帧和内容审看都通过后运行 final。报告实际任务数、被拒素材、积分前后差、来源/许可、响度、黑场和计划内静音。
