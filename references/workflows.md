# qiaomu-cut 工作流矩阵

目标：覆盖尽可能多的视频剪辑任务，但通过工作流组合保持可控。

## 王牌工作流

| ID | 名称 | 典型输入 | 推荐素材源 | 推荐渲染器 |
|---|---|---|---|---|
| `english-mix` | 影视英语学习混剪 | “找几句电影里骂人的话做英语学习视频” | 33tc、本地字幕、AI 词卡 | ffmpeg-full、ASS |
| `stock-story` | 免费素材故事片 | “用免费素材讲挖掘机” | ClipSeek、Pexels、Pixabay、imagegen | ffmpeg-full、HTML cards |
| `person-profile` | 人物档案短片 | “介绍某个人的一生” | web-info、Wikimedia、本地照片、AI 图 | HTML cards、ffmpeg |
| `explainer` | 科普解释动画 | “解释 attention 机制” | Manim、SVG、HTML、imagegen | manim、html、ffmpeg |
| `cinematic-short` | 电影感短片 | “做一个城市孤独感短片” | imagegen、ClipSeek、本地素材 | ffmpeg、color grade |
| `product-launch` | 产品发布片 | “给我的网站做 launch video” | browser capture、HTML、Motion、本地 logo | html、motion、ffmpeg |
| `social-short` | 竖屏强节奏短视频 | “做一个小红书风格短视频” | 本地视频、B-roll、imagegen | ffmpeg、字幕包装 |
| `talking-head` | 口播精剪 | “剪掉停顿，加字幕和 B-roll” | 本地口播、BaoCut 可选、ClipSeek | baocut、ffmpeg |
| `data-story` | 数据故事 | “把这份报告做成视频” | CSV/Sheet、HTML charts、SVG | html、motion、ffmpeg |
| `hybrid-studio` | 复杂项目 | “做一条客户级品牌故事片” | 多源组合 | 多渲染器 |

## 更多可组合工作流

### 教育与解释

- `vocabulary-card`：单词/短语教学，词根、例句、发音、原声片段。
- `grammar-mini-lesson`：语法结构演示，例句切换、错误对比。
- `book-summary`：一本书的章节结构、金句、人物关系。
- `paper-explainer`：论文摘要、方法图、公式动画、实验结果。
- `course-module`：课程小节视频，标题页、知识点、练习题。
- `whiteboard-explain`：白板/手写风格推导。
- `3b1b-concept`：连续变换、几何直觉、公式动画。

### 叙事与纪录

- `mini-documentary`：纪录片式旁白、档案素材、时间线。
- `timeline-story`：人物/公司/事件按时间线展开。
- `before-after`：前后对比、修复、改造、成长变化。
- `case-study`：商业案例、失败复盘、增长故事。
- `news-context`：新闻背景解释，地图、时间线、引用来源。
- `travel-montage`：旅行混剪，地图、地点卡、环境声。

### 商业与产品

- `landing-page-video`：网页首屏、功能卡、CTA 动效。
- `app-demo`：App/软件功能录屏、手势、放大镜、标注。
- `feature-release`：新功能发布、问题-解决-结果结构。
- `pitch-video`：融资/产品 pitch，市场、方案、指标、团队。
- `brand-story`：品牌故事、创始人、理念、用户场景。
- `testimonial-cut`：用户证言剪辑，lower third、关键词高亮。

### 社交短视频

- `hot-take`：观点型短视频，强 hook、快速论点、金句字幕。
- `listicle`：Top N、排行榜、技巧合集。
- `myth-busting`：误区打脸，红叉/绿勾/证据卡。
- `reaction-mix`：反应/评论/原片画中画。
- `meme-edit`：梗图、音效、节奏剪辑。
- `quote-video`：一句话金句 + 电影感背景 + 字幕跟随。

### 视觉与动态图形

- `kinetic-typography`：文字跟随、逐词高亮、节奏字幕。
- `motion-poster`：海报动起来，视差、光影、粒子。
- `ui-motion`：界面动效、卡片滑入、网页滚动、按钮反馈。
- `map-animation`：地图路线、迁移、地点弹出。
- `infographic-video`：信息图视频，数字、图标、对比。
- `mask-composite`：遮罩揭示、人物抠像、画面嵌入。

### 音乐与节奏

- `beat-montage`：按音乐节拍卡点。
- `lyric-video`：歌词字幕、逐字高亮、背景视觉。
- `music-visualizer`：音频频谱、粒子、节奏图形。
- `podcast-highlight`：播客高光，波形、字幕、章节卡。

## 工作流选择规则

1. 如果用户明确要“影视台词/电影片段/英语学习”，优先 `english-mix`。
2. 如果用户强调“免费素材/照片/插画/视频资源库”，优先 `stock-story`。
3. 如果是人物、公司或历史对象，优先 `person-profile` 或 `mini-documentary`。
4. 如果要解释抽象概念，优先 `explainer`。
5. 如果要产品/网站/App，优先 `product-launch`。
6. 如果平台是抖音、小红书、TikTok，优先 `social-short`。
7. 如果输入是本地口播，优先 `talking-head`。
8. 多个目标冲突时进入 `hybrid-studio`，先生成 IR 和分镜，不急着渲染。

## 输出默认值

| 平台 | 比例 | 响度 | 字幕 |
|---|---|---|---|
| 抖音/小红书/TikTok | 9:16 | -14 LUFS | 大字幕，安全区内 |
| YouTube 横屏 | 16:9 | -16 LUFS | 双语或章节字幕 |
| 课程/演示 | 16:9 | -16 LUFS | 清晰小标题 + 重点高亮 |
| 电影感短片 | 21:9/16:9 | -16 LUFS | 克制字幕或无字幕 |
