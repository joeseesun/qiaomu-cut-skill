# Licensing and Attribution

公开视频最容易翻车的不是剪辑，而是素材权利。qiaomu-cut 必须把“好看”和“可发布”分开处理。

## 规则

1. 每个非本地素材必须记录 `sourcePage`。
2. 每个外部素材必须记录 `provider` 和 `licenseStatus`。
3. ClipSeek 只作为发现入口；许可回到 Pexels、Pixabay、Wikimedia 等原站确认。
4. AI 生成素材标记为 `ai_generated`。
5. 用户本地素材标记为 `user_provided`，不假设可商用。
6. 影视片段、剧集台词、新闻画面等高风险素材默认只适合用户授权、学习、评论、研究或私有项目；公开视频需要更严格审查。
7. ListenHub/MarsWave 仓库的 MIT 许可证只覆盖 vendored 文档/代码，不覆盖服务条款、模型、上传素材或生成结果。
8. ListenHub 生成物默认同时标记 `ai_generated` 与 `provider_terms_unverified`；参考图、参考音频、人物肖像和已有作品的权利不会因生成/重混消失。

## license-report.md 建议结构

```markdown
# License Report

## Assets

| ID | Type | Provider | Title | Source Page | License Status | Attribution |
|---|---|---|---|---|---|---|
| a001 | video | pexels | Excavator... | https://... | verify_at_provider | ... |

## Notes

- ClipSeek used as discovery only.
- Provider license checked on: YYYY-MM-DD.
- AI-generated assets are marked.
```

## 不能说的话

- “所有素材都可商用”——除非逐项验证。
- “免版权”——更准确说“免费素材候选”或“开放授权候选”。
- “无需署名”——除非原站许可明确。

## 可以说的话

- “已记录素材来源。”
- “ClipSeek 返回了 Pexels/Pixabay 原站页面，待原站确认许可。”
- “本视频包含 AI-generated 视觉素材。”
- “生成素材已本地化并记录任务/模型；商业使用条件仍需按服务条款与输入素材权利复核。”
