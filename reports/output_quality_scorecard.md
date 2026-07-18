# Output Quality Scorecard — v0.3.0

用于每个真实视频项目完成前的人工/自动检查。`preview` 通过只代表可以继续迭代；公开发布必须以 `final + full`、字幕字体已验证且 `releaseReady: true` 为技术门，再补齐人工审看与素材权利证据。

## 三档门禁

| Profile | 自动校验 | 视觉证据 | 允许用途 |
|---|---|---|---|
| `preview` | basic：流、非空、时长、尺寸、帧率、像素格式 | 直接查看预览视频；默认无 contact sheet | 内容、字幕、节奏、构图迭代 |
| `standard` | basic + 响度/峰值 + 静音边界 | 最多 8 帧 contact sheet | 内部审阅、日常快速交付 |
| `final` | standard + 全片黑场扫描 | timeline 配置的完整 contact sheet | 公开发布、归档、客户终稿 |

路径边界、软链接逃逸、no-clobber、输入输出别名、素材存在性、时间线一致性和资源上限不随 profile 降级。

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
| Render | `final/full` 技术报告通过且无未审查异常 | pass：DIG final 为 0 黑帧、0 异常静音、-14 LUFS / -1.4 dBFS |
| Profile | 正式发布必须 `profile=final`、`validation=full`、`releaseReady=true` | pass：DIG 既有 final 技术证据；v0.3 profile 报告结构已实现 |
| Cache | 报告包含 cache 命中与逐阶段 timings，不把暖缓存冒充冷启动 | pass：preview/standard 冷暖缓存分别实测 |
| Font | 中文字体可解析，且不把本机字体加入仓库或交付包 | pass：本机 CJK 字体仅复用到 `.qiaocut/cache/fonts/` |
| Deliverables | MP4、IR、manifest、license、quality report 齐全 | pass：DIG demo |

## 自动证据

Skill 应先运行预览：

```bash
node scripts/qcut.js render /path/to/project --profile preview --json
```

内容锁定后运行一次正式终稿：

```bash
node scripts/qcut.js render /path/to/project --profile final --json
```

`render` 已执行对应档位校验并写入 render report，不要紧接着对同一个文件重复运行 `qcut verify`。独立 verify 只用于外部生成、移动后或单独收到的视频。

## 性能证据

同一开发机、同一 60 秒 DIG 双语样片：

| 测试 | 耗时 |
|---|---:|
| v0.2 原始 final | 71.6 秒 |
| v0.3 preview 冷缓存 | 27.7 秒 |
| v0.3 preview 暖缓存 | 3.3–4.1 秒 |
| v0.3 standard 冷缓存（TTS 已暖） | 27.1 秒 |
| v0.3 standard 暖缓存 | 4.1 秒 |
| v0.3 final/full 冷缓存（TTS 已暖） | 65.6 秒 |
| v0.3 final/full 暖缓存 | 8.5 秒 |

这些是同机相对基准，不是跨机器 SLA。默认缓存位于 `.qiaocut/cache/`；`--no-cache` 只用于排查，并且不能跳过安全门。

## missing evidence

当前证据覆盖一个 60 秒 `hybrid-studio + english-mix` 真实项目、preview/standard 冷暖性能基准和一个 2 秒 renderer smoke fixture；仍未覆盖所有工作流、平台、外部引擎与 clean-host 字体环境。每个真实项目仍应单独生成本项目的 scorecard。
