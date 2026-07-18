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
- 使用 Playwright/浏览器捕获帧或视频。
- 输出透明层或完整片段，再交给 ffmpeg 合成。

## Motion / CSS / SVG Renderer

用途：

- 文字跟随、逐词高亮、SVG path draw。
- UI 卡片滑入、滚动动效、弹性过渡。
- 图标、箭头、线条、标注动画。

适合产品 launch、短视频字幕包装、信息图视频。

## Manim Renderer

用途：

- 3Blue1Brown 风格科普动画。
- 数学、几何、算法、物理、抽象概念。

规则：

- 只在需要精确程序化解释时使用。
- 输出中间视频，再与旁白/字幕/片头合成。

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
