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

安装模式会通过 Homebrew 补齐 `ffmpeg-full`；如果本机缺少稳定的简体中文字幕字体，还会安装 `font-noto-sans-cjk-sc`。`--check` 同时检查两者。

这个脚本只安装/检查，不强制 `brew unlink ffmpeg`。qiaomu-cut 运行时按顺序寻找：

1. `QIAOMU_FFMPEG`
2. `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
3. `/usr/local/opt/ffmpeg-full/bin/ffmpeg`
4. `ffmpeg`

## 公开 skill 的推荐策略

- 不擅自破坏用户已有 ffmpeg。
- 如果缺能力，给出明确安装命令。
- 大项目在渲染前执行 `doctor`。
- `qcut render` 已按 profile 内建验证；不要紧接着对同一输出重复运行 `verify`。
- `verify` 保留给外部视频、旧成片或独立复检。

## 中文字体

ASS 字幕需要 libass 能访问的 CJK 字体。渲染器优先使用项目内 `fontsDir`，否则尝试复用本机已安装的 Noto Sans CJK SC，并只复制到项目的 `.qiaocut/cache/fonts` 中用于本地渲染。该字体不会随 skill 分发。

对公开交付，建议将可再分发的 CJK 字体放入项目字体目录，显式设置 `fontsDir` 和字体 family，并保留授权信息。
