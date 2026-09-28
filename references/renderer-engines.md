# Renderer Engines

qiaomu-cut 不是单一 ffmpeg wrapper，而是多渲染器编排器。

## ffmpeg-full Renderer

用途：

- 视频拼接、裁剪、缩放、转码。
- ASS 字幕、双语字幕、词卡。
- overlay、mask、alpha composite、picture-in-picture。
- 音频混音、ducking、响度归一化。

要求：

- `drawtext`
- `subtitles` / `ass`
- `overlay`
- `libass`
- 推荐 `zscale`、`loudnorm`

## HTML / HyperFrames-style Renderer

用途：

- 网页、卡片、产品发布视频。
- 信息图、人物档案、排行榜。
- 用 HTML/CSS/JS 写可预览场景，再录制或渲染为视频片段。

设计要点：

- 每个 scene 是一个 HTML composition。
- 使用 CSS variables 控制主题。
- 使用 `qcut scene render` 通过 Playwright/Chromium 按帧捕获；每一帧的 PNG buffer 直接通过 `image2pipe` 送入 ffmpeg，输出项目内 MP4，不创建完整 PNG 帧目录。
- 网络请求在捕获期间被禁止；所有图片、字体和数据应本地化到项目。
- CSS/Web Animations 会在每一帧设置确定时间；Canvas/JS 动画用 `window.__QIAOCUT_SET_TIME__(ms)` 接入，函数可返回 Promise（渲染器逐帧 await，用于等待 JPEG 序列解码）。
- `--motion-blur N`（1–8）在每帧快门区间（`--shutter`，默认 0.5 帧）内居中采 N 个子帧，用 ffmpeg `tmix` 混合出真实动态模糊；`--scale 0.5` 以半分辨率出草稿而不改变布局。
- 自由编写的代码动画优先使用 `qcut motion`：它在渲染前用正序/倒序/冷启动三次截图证明场景是 t 的纯函数。
- `qcut explainer render-scenes` 按 `scene-plan.json` 的依赖和 mtime 只更新过期场景，并顺序执行无界面浏览器捕获，避免并发抢占内存。
- 输出透明层或完整片段，再交给 ffmpeg 合成。

## Motion / CSS / SVG Renderer

用途：

- 文字跟随、逐词高亮、SVG path draw。
- UI 卡片滑入、滚动动效、弹性过渡。
- 图标、箭头、线条、标注动画。

适合产品 launch、短视频字幕包装、信息图视频。

执行边界：SVG 通过 `qcut scene render --engine svg` 导出为 MP4；逐词字幕使用 ASS `word-follow/karaoke/typewriter`，简单入场使用 `pop/slide-up`。

## Manim Renderer

用途：

- 3Blue1Brown 风格科普动画。
- 数学、几何、算法、物理、抽象概念。

规则：

- 只在需要精确程序化解释时使用。
- 通过 `qcut scene render --engine manim --scene-class <Name>` 输出中间视频，并归一化尺寸、帧率和时长，再与旁白/字幕/片头合成。

## Slides / PPT Renderer

用途：

- 课程、报告、演示视频。
- 章节卡、要点卡、图表页。

实现方式：

- 可用 PPT/Keynote/HTML slides/Marp/Reveal.js。
- 导出图片序列或视频片段后合成。

## Imagegen Renderer

用途：

- 封面、海报、插画、背景、概念图。
- 静图转视频：Ken Burns、视差、景深、慢推近。

规则：

- 必须标记 `ai_generated`。
- 不生成误导性真实新闻/证据素材。

## Composite Renderer

用途：

- 视频遮罩、透明通道、绿幕、luma matte。
- 画中画、网页嵌入、HUD、视觉特效。

推荐流程：

1. 每个视觉层单独输出。
2. 保留 alpha 或 mask。
3. 最终由 ffmpeg filter graph 合成。
4. 导出质量报告。
