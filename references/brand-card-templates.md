# 品牌片头片尾模板

所有模板都成对提供不同构图的 intro/outro；片尾固定含“向阳乔木”、`@vista8` 和关注 CTA。可选 ID：

模板 ID、序号、风格中文名、渲染参数和调试文字只用于工程选择，绝不能显示在成片。片尾默认采用 `snap-flash-pop`：短闪色帧 → 品牌跳切帧 → CTA 定帧；三个镜头 `motion=none`，禁止缩放推拉。

1. `editorial-red` 杂志红  2. `midnight-gold` 午夜金  3. `paper-note` 纸张笔记  4. `neo-brutal` 新粗野
5. `cinema-frame` 电影画框  6. `ink-wash` 水墨留白  7. `glass-blue` 玻璃蓝  8. `retro-tv` 复古电视
9. `type-grid` 字体网格  10. `warm-book` 温暖书页  11. `signal-green` 信号绿  12. `monochrome` 黑白极简
13. `sunset-card` 落日卡片  14. `chalk-class` 黑板课堂  15. `ticket-stub` 电影票根  16. `gradient-orbit` 渐变轨道
17. `news-flash` 新闻快讯  18. `soft-pastel` 柔和粉彩  19. `tech-line` 科技线框  20. `signature` 签名字标

未指定时按内容自动选择：影视优先 `cinema-frame`，英语学习优先 `editorial-red`，科技优先 `tech-line`，温暖叙事优先 `warm-book`，其余用 `type-grid`。必须先给用户看含片头、正文、片尾的 preview，不能只检查静态首帧。
