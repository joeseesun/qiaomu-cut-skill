# 封面与缩略图方法论（Cover = Frame 0）

调研日期：2026-09-28。来源见文末。本文件只保留跨题材可复用的机制；各来源给出的百分比多数没有公开样本，只作方向参考，不写成保证。

## 0. 两条硬规则

1. **每支非循环成片都要有封面，并且封面就是第 0 帧。** 开头不能是黑屏或空画面：平台首帧预览、自动播放、分享卡片和“不设缩略图时的默认帧”都会先用到这一帧。封面完整静止最多 0.7 s，随后在节拍上退场，接进正片的钩子。
2. **封面与标题是一对承诺，正片开头必须兑现。** MrBeast 制作手册把标题和缩略图当作起点：先定包装，再按它的承诺拍开头；首分钟流失最多，画面和承诺不一致（连物件颜色都算）会直接导致划走。所以封面的主体、颜色和文字必须在前几秒真实出现，禁止用正片里没有的画面骗点击。

## 1. 先定承诺，再画画面

- 用一句话写出观众点进来能得到什么（promise），再拆成：**封面负责“看见”，标题负责“说明”**。两者互补，不重复同一句话。
- 在「熟悉 + 反差」里找钩子：观众认识的东西（Obsidian 空白页、一个常见场景）加上一个意外的变化（变成星空主页）。Paddy Galloway 的离群值分析方法也是从包装里找这种变量。
- 先写 3 个封面概念，而不是只把一个画面修到完美；封面概念本身就是重要资产。

## 2. 选一个原型（按题材）

| 原型 | 适用 | 画面 |
| --- | --- | --- |
| 前后对比（before/after 斜切） | 工具、改造、效率 | 左边问题，右边结果，一条强调色分界线 |
| 产品英雄 | 产品发布、插件、硬件 | 主体放大、背景安静、一个强调色 |
| 大数字 | 数据、清单、成就 | 一个大数字 + 极短上下文词 |
| 人脸 + 情绪 | 口播、人物、反应 | 清晰人脸、直视镜头、情绪与故事一致 |
| 结果先行 | 教程、科普 | 展示最终画面，不展示过程 |
| 系列模板 | 固定栏目 | 同一版式换主体，建立识别度 |

没有真人出镜时，不要硬造人脸；用前后对比或产品英雄替代“情绪”，靠反差制造张力。

## 3. 构图与文字

- **一个焦点，最多三个元素**（主体、一句字、一个品牌标记）。多一个元素就多一份认知负担。
- **字 ≤ 4 个英文词或 ≤ 6 个汉字**，字号至少占画面高度的 12%（1080p 下 ≥ 130 px），加粗；字要补充画面，不要复述标题。
- **明度对比优先于色相**：亮主体配暗背景，或反过来；只用一个高饱和强调色（常见高对比组合是黄/黑、红/白、蓝/橙），并与品牌一致。
- **安全区**：YouTube 右下角会压时长徽标，底部会出现进度条；关键字和主体避开右下约 20% × 18% 的区域。竖屏遵循 `social-safe-zones.md`。
- **缩小测试**：把封面缩到 168×94（侧栏推荐）和 360×202（手机信息流）后，主体和文字仍要一眼可读；看不清就删元素、放大字，而不是加描边特效。
- 不在封面上放小字截图、多行说明、水印堆叠或把边框做成渐变。

## 4. 融入视频开头

- 封面在视频里就是 `s00`：第 0 帧完整可读，定帧 ≤ 0.7 s，0.7–1.0 s 退场（文字下沉/淡出、分界线收起、淡到钩子画面），在强拍上切进正片。
- 有音乐时封面占开头两拍，并配一个短 sting（低频打击 + 和弦），退场前留约 0.1 s 空拍，让钩子第一拍更有冲击。
- 缩略图直接从同一场景的 t=0 渲染（不另画一张图），保证封面、首帧和缩略图完全一致；截图高清 master（3840×2160）再导出 1280×720 JPG（移动端上传上限 2 MB）。
- 封面里的主体（颜色、物件、界面）必须在正片前 5 秒内再次出现。

## 5. 测试与迭代

- 做 3 个封面变体（不同原型或不同文字），用 YouTube「测试和比较」（Test & Compare）同时跑；平台按**观看时长占比**判胜负，而不只看 CTR，所以骗点击的封面会输。
- 单次实验只是局部证据；同类视频里重复出现的规律才升级成默认值（与 `feedback-evolution.md` 的提升门槛一致）。
- 旧视频也可以换封面：包装优化对存量视频同样有效。

## 6. qcut 命令与验收

```bash
qcut motion cover <project> --variants a,b,c   # 场景 t=0 以 ?cover=<v> 渲染：@4k PNG + 1280×720 JPG + 360/168 预览
qcut cover check <video-or-image> --json      # 首帧非黑、对比度、分辨率/比例、JPG ≤ 2 MB、小尺寸预览
```

验收项（`reports/cover-check.json`）：

- `frame0-not-black`：第 0 帧平均亮度 ≥ 28/255（硬门）。
- `frame0-contrast`：亮度标准差 ≥ 30（低于则警告：画面发灰、缺少焦点）。
- `resolution`：≥ 1280×720，且比例与成片一致。
- `jpg-size`：缩略图 JPG ≤ 2 MB。
- `cover-hold`（视频）：0 s 与 0.5 s 两帧 PSNR ≥ 35 dB，证明封面确实定帧可读。
- 人工项：168×94 预览里主体和文字可读；右下角时长区没有关键信息；正片前 5 秒兑现封面承诺。

## 来源

- MrBeast 制作手册（泄露版）摘要：标题/缩略图先行、首分钟兑现承诺、连颜色都要一致 — https://www.danielscrivner.com/how-to-succeed-in-mrbeast-production-summary/ ；https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
- Paddy Galloway：包装决定量级、熟悉 + 反差、离群值分析 — https://www.colinandsamir.com/resources/the-new-rules-of-youtube-from-paddy-galloway ；https://outlierkit.com/resources/paddy-galloway-growth-strategy/
- 缩略图心理学与数据（人脸/情绪、对比色、字数 < 4；样本未公开）— https://1of10.com/blog/the-psychology-behind-high-ctr-thumbnails/ ；https://www.tubeanalytics.net/blog/youtube-ctr-optimization
- 无人脸科技/产品封面：产品英雄、大数字、前后对比 — https://1of10.com/blog/tech-thumbnail-ideas/
- YouTube 测试和比较：最多 3 个变体，按观看时长占比判胜 — https://support.google.com/youtube/answer/16391400 ；https://vidiq.com/blog/post/youtube-launches-new-thumbnail-testing-tool/
- 缩略图规格：1280×720 起，16:9；桌面上限升至 50 MB，移动端仍为 2 MB — https://9to5google.com/2025/10/30/youtube-video-thumbnail-file-size-limits/ ；https://thumbnailtest.com/guides/youtube-thumbnail-size/
