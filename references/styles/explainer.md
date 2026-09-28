# Explainer Style

适合：科普、数学、算法、产品原理、报告解读。

## 默认参数

- 比例：16:9。
- 字体：清晰 sans，公式用专业数学字体。
- 动效：连续变换优先，少用花哨转场。
- 结构：问题 → 直觉 → 机制 → 例子 → 总结。

## 常用手法

- progressive reveal —— 已实现：参数化组件 process 语义按场景时长逐步激活序列节点（`.step-active`），连接符随进度生长（`.connector`）；激活落位带磁吸 settle 衰减微振（`QiaoCutMotion.settle`）
- state morph —— 已实现：state 语义在焦点元素上执行 from→to 文本变形 + 高亮环（`.state-swap` / `.swap-ring`）
- focus spotlight —— 已实现：`primaryFocus` 驱动非焦点压暗、焦点光晕与微脉冲；`focus-sequence` 不画矩形光晕圈，强调由步骤激活态承担
- beats —— 已实现：`qcut explainer beats --apply` 按旁白静音分句点自动生成 beats 写回 spec；手写场景可在 payload 里手填 `beats`（activate/swap/pulse）
- formula morph（手写 HTML/Manim）
- diagram zoom（手写 HTML/Manim）
- color-coded terms
- voiceover + pointer（手写 HTML；尚无内置指针组件）
- before/after abstraction —— 已由 state 语义 / comparison 组件承接

实现状态以 `assets/explainer-social/component-runtime.js` 与 `base.css` 为准；标注"手写"的手法需要在场景 HTML 里用 `window.__QIAOCUT_SET_TIME__` 自行驱动。
