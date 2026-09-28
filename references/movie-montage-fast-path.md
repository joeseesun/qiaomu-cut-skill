# Movie Montage Fast Path

目标：为“从多部经典影视中提取最帅、最燃的动作或舞蹈高光”建立低返工工作流。动作台词只能帮助定位大范围，不能证明那几秒真的在跳舞；远端积分应花在经过上下文判断的有限候选上，下载后再用动作强度和竖屏构图证据一次锁定时间窗。

## 1. 初始化候选契约

```bash
node scripts/qcut.js movie-montage init ./project \
  --target 10 --clip-duration 3.4 --json
```

命令创建 `source-selection.json` 与目录结构。默认候选池上限为 `target + ceil(target × 25%)`，10 段对应 13 个候选；这为弱镜头留出替换空间，但避免无上限搜索和付费。

每个候选至少保存稳定 `id`、`videoId`、作品名、宽范围、目标动作和付费尝试记录：

```json
{
  "id": "pulp-fiction-twist",
  "videoId": 990,
  "title": "低俗小说 Pulp Fiction",
  "sourceStartMs": 2835190,
  "sourceEndMs": 2850190,
  "targetMoment": "扭扭舞标志性手势与脚步",
  "composition": "centered",
  "attempts": [{ "taskId": "existing-task-id", "status": "downloaded" }]
}
```

## 2. 控制积分返工

- 台词、歌词和片名只用于发现约 12–15 秒的候选，不直接决定成片 3.4 秒窗口。
- 同一候选默认最多两次付费裁片。第一次不理想时，先在已下载宽范围内重新取 `timelineIn`；只有目标动作确实不在文件中才允许第二次远端裁片。
- 第二次仍是对白、走路、片尾掌声、字幕或片头职员表时，直接淘汰并启用备选，不继续追逐知名片名。
- 下载失败必须恢复已有 task ID，不重新创建任务。每个项目记录积分前后余额与实际差额。
- 候选应是约 12–15 秒的宽范围片段；`review` 拒绝超过 120 秒的输入，避免误把整部影片载入动作扫描。

## 3. 一次生成动作与竖屏证据

下载候选后运行：

```bash
node scripts/qcut.js movie-montage review ./project \
  --clip-duration 3.4 --motion-fps 4 --samples 15 --apply --json
```

命令会检查音视频流、文件 SHA-256、稳定 `videoId`、最终入选作品唯一性和付费次数，并为每个候选生成：

- `*-dense.jpg`：覆盖完整宽范围的密集帧；
- `*-motion-strip.jpg`：算法推荐窗口的首/中/尾动作三帧；
- `*-phone-crops.jpg`：左侧 `cover`、右侧 `containBlur` 的手机构图对比；
- `all-motion-windows.jpg` / `all-phone-crops.jpg`：带编号的全候选总览，避免逐文件打开；
- `review.json`：动作分数、推荐 `in/duration`、构图建议、重复项与人工检查清单。

动作分数使用低分辨率灰度帧差，并对单帧闪切做截尾，适合快速排名。它无法区分“人物舞蹈”和“摄影机摇动”，因此 `--apply` 只写 `semanticDecision=pending-human-review`，绝不自动进入 `finalSelection`。

## 4. 锁定镜头

逐个查看动作三帧和手机裁切，确认：

1. 画面真的包含目标舞蹈/动作，而不是对白、走路、片头或掌声。
2. 3.4 秒中能看到完整动作短语，不从动作中途开始或在落点前结束。
3. 手机画面中脸、身体和标志性手势可读；单人/中心动作优先 `cover`，宽幅群舞和队形优先 `containBlur`。
4. `finalSelection` 不超过目标数，同一 `videoId`、SHA 或作品区间不得重复。

质量优先于数量。没有十段足够好的素材时，按实际数量交付，`padded:false`。

## 5. 批量包装与原声母带

片头片尾按既有品牌规则写入一个 scene batch，一次启动无界面浏览器。影视原声跨度很大时，在 timeline 设置：

```json
{
  "audio": {
    "masteringMode": "montage",
    "originalGain": 1
  }
}
```

`montage` 模式在 loudnorm 前增加温和动态压缩，避免多部影片的对白、音乐和掌声造成 LRA 过大或真峰值失败。它不替代 final 的两遍响度归一化，也不用于普通旁白项目。

## 6. Preview 与 Final

先渲染 preview，完整观看开头、高潮排序、每个动作落点、横竖屏裁切和片尾。内容锁定后才运行 final。交付报告必须包含：

- `reports/movie-montage-review/review.json` 及全部视觉证据；
- `source-selection.json` 的最终选择、拒绝原因、任务 ID 和积分差额；
- final/full `releaseReady=true`、响度、真峰值、黑场和计划内静音；
- 来源与版权边界。影视片段默认仅供私下审片，公开发布前另做权利审查。
