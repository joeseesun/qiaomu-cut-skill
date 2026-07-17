# Output Quality Scorecard

用于每个真实视频项目完成前的人工/自动检查。

## 必查项

| 项目 | 通过标准 | 状态 |
|---|---|---|
| Brief | 受众、时长、比例、平台明确 | pass：DIG 60 秒 9:16 双语 demo |
| Sources | 每个素材有 source/provider/sourcePage 或 localPath | pass：DIG manifest |
| License | 外部素材有 licenseStatus 和 attribution | warn：Pexels 已核验；33tc 仅私人学习演示 |
| Video | 有视频流，分辨率符合目标平台 | pass：1080×1920 / H.264 / 30 fps |
| Audio | 有音频流或明确无音频原因 | pass：AAC 48 kHz stereo |
| Captions | 字幕在安全区，拼写和断句可读 | pass：20 帧 contact sheet 人工抽查 |
| Pacing | 前 3 秒 hook，剪辑节奏符合平台 | pass：人工抽查 |
| Render | 无明显黑帧、爆音、花屏、错位 | pass：0 黑帧、0 异常静音、-14 LUFS / -1.4 dBFS |
| Deliverables | MP4、IR、manifest、license、quality report 齐全 | pass：DIG demo |

## 自动证据

运行：

```bash
node scripts/qcut.js verify final.mp4 --json
```

## missing evidence

当前证据覆盖一个 60 秒 `hybrid-studio + english-mix` 真实项目和一个 2 秒 renderer smoke fixture；仍未覆盖所有工作流、平台和外部引擎。每个真实项目仍应单独生成本项目的 scorecard。
