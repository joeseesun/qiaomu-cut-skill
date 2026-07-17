# ffmpeg-full

qiaomu-cut 默认使用 `ffmpeg-full`，因为普通 ffmpeg 构建经常缺少 ASS 字幕、字体、复杂滤镜或编码能力。

## 检查

```bash
scripts/bootstrap_macos.sh --check
node scripts/qcut.js doctor --json
```

必须能力：

- `libass`
- `drawtext`
- `subtitles` / `ass`
- `overlay`
- `loudnorm` 与 `sidechaincompress`（响度标准化与旁白自动闪避）
- `zoompan` 与 `xfade`（静帧运镜与可控转场）
- `libx264`（通用 H.264 交付）

推荐能力：

- `zscale`
- 常用 H.264/H.265/AAC 编码支持

## 安装

```bash
scripts/bootstrap_macos.sh --install
```

这个脚本只安装/检查，不强制 `brew unlink ffmpeg`。qiaomu-cut 运行时按顺序寻找：

1. `QIAOMU_FFMPEG`
2. `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
3. `/usr/local/opt/ffmpeg-full/bin/ffmpeg`
4. `ffmpeg`

## 公开 skill 的推荐策略

- 不擅自破坏用户已有 ffmpeg。
- 如果缺能力，给出明确安装命令。
- 大项目在渲染前执行 `doctor`。
- 输出视频后执行 `verify`。
