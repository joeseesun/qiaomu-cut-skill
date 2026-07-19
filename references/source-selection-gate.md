# Source Selection Gate

用于人物颜值、商品质感、特定动作、地点或镜头风格决定成片质量的项目。

## 视觉契约

在搜索前写清：

```yaml
subject: 成年人物或目标主体
appearance: 妆发、服装、材质、清洁度、品牌一致性
action: 起始状态 → 动作变化 → 落点
camera: 景别、角度、运动、焦点、构图
light: 光线方向、软硬、时段、色温
setting: 场景、背景复杂度、年代和地域
continuity: 人物、服装、色板、动作方向
reject: 未成年人、失焦、遮脸、动作不完整、廉价棚拍感、重复镜头、许可不明

## 数量与去重硬门

- 目标数量是最多数量，不是必须凑齐的 KPI；`7/10` 的独立好素材优于 `10/10` 中夹带重复。
- 下载前按稳定素材 ID、作品/集数、时间区间和标准化台词去重。
- 下载后必须按文件 SHA-256 去重；视频 ID 不同但文件哈希相同，仍是同一素材。
- 条件允许时增加首/中/尾抽帧感知哈希，拦截裁切时间略有差异的同场景近重复。
- 不得通过复制文件、改名、变速、镜像、缩放、调色或微调时间码把一个镜头伪装成多个镜头。
- 报告明确写 `selectedCount`、`targetCount`、`padded:false` 和每个被拒重复项的证据。
```

把主观评价翻译为镜头证据。例如“精致时尚”可对应妆发完整、服装轮廓清晰、柔和侧光或逆光、背景干净、脸部曝光稳定；不要把种族、肤色、国籍等身份属性当作质量指标。

## 候选记录

```yaml
- id: provider-id
  sourcePage: https://...
  thumbnailDecision: accept | reject
  reviewDecision: accept | reject
  usableRanges:
    - in: 3.2
      out: 4.8
      evidence: 侧背 → 转头 → 微笑落点
  matched: [adult, styling, backlight, action-complete]
  rejectedBecause: []
  licenseStatus: verify_at_provider | verified | user_provided
```

## 锁定规则

- 搜索池数量至少为目标镜头数的 2–3 倍；缩略图预筛后再下载。
- 接触表只能证明时间采样点，动作边界仍要用更密抽帧或预览片段确认。
- 合格片段数达到目标且镜头在人物、景别、场景、动作方向或光线中至少有两类变化后，才写时间线。
- 同一源视频可贡献多个片段，但不得用几乎相同的动作和构图机械凑数。
- 素材不足时回到搜索池；连续两轮仍不足就换 provider，或先估价并获得确认后生成。
- 搜索标题、模型宣传词和“beautiful/cinematic”等标签不能替代视觉审核。
