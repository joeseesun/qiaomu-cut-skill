# Prior-art research — v0.13.0 代码动态图形工作室

- 日期：2026-09-28
- 输入：飞书文档《Claude Opus 5.5 生成视频：全网案例与提示词合集》（xiangyangqiaomu.feishu.cn/docx/PmpjdPqoOoBglPxBsEScBFmTnGC，revision 14）。它汇总了 2026-09-22 至 25 日 X/Twitter、B 站、Linux.do、GitHub、YouMind 和技术博客上的 54 个案例及作者公开的提示词。
- 基线：本地 qiaomu-cut v0.12.1（比 GitHub joeseesun/qiaomu-cut-skill main 上的 v0.5.0 更新；本次在本地版本上迭代）。
- 未做：skills.sh / SkillsMP 目录检索（本次是对已有 skill 的定向升级，输入是用户指定的调研文档）→ `missing evidence`。

## 研读的来源与逐个借鉴点

| 来源 | 借鉴机制 | 落地 |
| --- | --- | --- |
| zero (@twoclipping) 产品片 / UI 循环模板 | 六段导演信；Banned 列表；节拍网格分镜后再编码；seek(t) 纯函数；闭式弹簧与弹簧叠加；子帧 + tmix 动态模糊；音效按实测峰值对齐；渲染前抽帧；preserve-3d / will-change 坑 | `motion-brief.json` 结构、`motion check` 硬门、motion kit、`--motion-blur`、`audio peak`/`alignPeak`、`motion probe`、gotchas |
| Danny Stuart（Remotion 宣传片） | 先分镜再编码、可只改单镜头；参考视频胜过形容词；镜头语言词汇；草稿关模糊半分辨率 | storyboard gate、references 警告、draft profile `--scale 0.5` |
| Alex Prompter 5 场景讲解模板 | 场景数/时长/节奏写清；一次只提一条修改 | 模板 C、迭代规则 |
| WY (@akokoi1) 线稿科普 / Axton 口播改线稿 | 一句话线稿科普；三条约束的口播画中画改造 | `line-art-explainer` style、talking-head 配方 |
| Winter 奥斯特里茨（开源） | 研究先行、参考画作作灵感而非硬约束、“不要像信息图或策略游戏” | `cinematic-3d` style 与 Banned |
| Majid Manzarpour / Rikuo 像素规格型 | 逻辑分辨率、整数放大、调色板、状态机 | `pixel-art` style；改写为由 t 推导（原例用 rAF 固定步进，不可逐帧确定） |
| P(doom) MV / Let Me Go MV / donald 混合 MV | 逐帧笔刷绘制；反复完整观看自检；视频模型底片 + JS 重绘 | `lyric-mv` style、hybrid 配方、probe 自检 |
| 成本与局限小节 | 多轮迭代才是常态；写实需视频模型 | 媒介边界与成本预期写入 direction 文档 |

## 拒绝或改写

- **拒绝把“一句话出片”当默认**：案例质量波动大；qiaocut 仍支持一句话，但先扩写成 brief 并过 check/probe。
- **改写 rAF/固定步进写法**：不可 seek 的实现不能并行、不能缓存、不能复现，统一改为 t 的纯函数，并用 probe 实证。
- **不内置 AE/Blender/Higgsfield 操控**：超出本地可验证范围，只在路线表中说明。
- **不转载长提示词原文**：模板为改写版并注明机制来源。
- **不依赖 numpy**：节拍分析用 Node 实现，避免新增 Python 依赖。

## 原创贡献

- **确定性实证**：正序/倒序/冷启动三次截图字节比对（design advantage，smoke 已验证能抓到静态 lint 看不到的隐藏状态）。
- **样本级节拍校准**：谱通量测速后，用每拍 ~3 ms 精度的起音细化 + 稳健线性拟合修正相位和速度漂移（validated：合成 120/128 BPM 轨道误差 <5 ms）。
- **弹簧叠加的数值验证**：smoke 用数值积分对照闭式 springTrack（validated）。
- **迭代母带**：测量 → 增益 → 真峰值限制 → 复测，直到 ±0.7 LU（validated 于合成音乐 −14.6 LUFS；极端打击乐素材可能差 1–2 LU，会警告）。
- **缺什么装什么**：`qcut setup` 幂等安装全部本地依赖，doctor 给出单条修复命令（用户反馈驱动）。

## 仍缺的证据

- 真实商业歌曲上的节拍准确率（只在合成轨道验证）。
- 人工审看的完整 20 秒以上 motion 成片、以及对照其他 skill 的公平比较。
- Linux 下 `qcut setup` 的 apt 路径。
