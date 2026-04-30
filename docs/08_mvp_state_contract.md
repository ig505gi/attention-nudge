# 08 MVP State Contract

**Date**: 2026/04/17  
**Status**: 设计收敛版（MVP）

---

## 目标

本文定义 AttentionNudge 在 MVP 阶段的最小状态契约。

核心原则：

- pre-LLM 触发尽量简单
- 复杂理解尽量交给 LLM
- 本地代码只负责“何时检查”和“提供什么证据”
- 本地代码不做复杂认知状态分类
- `No-Goal Entry Flow` 是 MVP 正式能力

一句话概括：

> MVP 采用“薄触发、厚判断”模式。

---

## 核心定义

用户此刻状态，不等于“这一页是什么”。

在 MVP 中，系统只在少数几个检查点，把以下证据交给 LLM：

- 当前目标
- 当前页面
- 当前浏览器上下文
- 粗粒度行为摘要
- 最近少量页面轨迹

然后由 LLM 输出：

- 当前是否仍与目标对齐
- 当前大致处于哪种浏览模式
- 可选的候选干预文案
- 可选的目标草稿

当用户没有设置目标时：

- 系统仍然使用同一套 checkpoint
- LLM 不再强行做“目标对齐”判断
- 改为判断当前浏览是否连贯、是否值得温和地帮助用户明确目标
- 本地策略决定是否显示 `icebreaker`

因此，MVP 的正式定义为：

> 用户此刻状态 = 系统在某个 checkpoint 时刻，将最近最小必要证据交给 LLM 后得到的结构化判断结果。

---

## MVP Trigger

MVP 只保留 2 个触发器。

### 1. `page_checkpoint`

含义：
新页面进入并稳定若干秒后，做一次快速检查。

建议规则：

- 页面已进入前台
- 页面可见
- 窗口处于 focus
- 延迟 `5-8s` 后触发

作用：

- 快速判断当前页与目标是否大体相关
- 避免刚加载页面就立即判断

### 2. `dwell_checkpoint`

含义：
同一页面有效停留到一定时长后，做一次阶段性复查。

建议规则：

- 页面可见
- 窗口 focus
- 用户非 idle
- 每 `60s` 触发一次

作用：

- 判断用户是在持续推进，还是已经偏离
- 区分深读/深看与无意义停留

## Trigger Design Boundary

MVP 中，trigger 只回答一个问题：

> 为什么现在值得让 LLM 看一次？

trigger 不负责回答：

- 用户是不是已经偏航
- 用户是不是在 doomscrolling
- 用户是不是在 deep dive

这些都交给 LLM。

因此，以下能力不进入 MVP：

- `context_shift_proxy_spike`
- `repeat_low_alignment_hits`
- 本地复杂轨迹分类
- 本地认知态状态机

---

## No-Goal Entry Flow

无目标模式是 MVP 正式能力，而不是后续增强项。

设计目标：

- 用户即使没有预先设定目标，也能正常使用插件
- 系统不因为“没有目标”就停止判断
- 只有在 LLM 认为用户明显失去方向时，才发起一次温和提问

规则很简单：

- `goal` 允许为空
- trigger 仍然只用 `page_checkpoint`、`dwell_checkpoint`
- LLM 在无目标模式下主要看：
  - 当前浏览是否连贯
  - 最近几页是否像是有意识探索
  - 用户是否可能需要帮助明确一个目标

推荐输出约束：

- 无目标模式下，`alignment_state` 通常返回 `uncertain`
- 无目标模式下，默认不提供候选干预文案
- 只有当提问明显会帮助用户时，才填写 `icebreaker_message`
- 如果浏览看起来连贯，可以填写 `suggested_goal` 作为安静目标草稿

---

## LLM Input

MVP 输入只保留 6 个顶层字段。

### 1. `trigger_reason`

```ts
type TriggerReasonInput = {
  trigger_reason: "page_checkpoint" | "dwell_checkpoint"
}
```

### 2. `goal`

```ts
type GoalInput = {
  goal: string | null
}
```

### 3. `current_page`

```ts
type CurrentPageInput = {
  url: string
  title: string
  meta: string
  excerpt?: string
}
```

说明：

- `excerpt` 拿不到可以为空
- 不要求 MVP 完整正文抽取

### 4. `browser_context`

```ts
type BrowserContextInput = {
  is_visible: boolean
  is_focused: boolean
  idle_state: "active" | "idle" | "locked"
  has_media: boolean
}
```

### 5. `behavior_summary`

```ts
type BehaviorSummaryInput = {
  dwell_seconds: number
  active_dwell_seconds: number
  interaction_level: "low" | "medium" | "high"
  scroll_level: "low" | "medium" | "high"
}
```

说明：

- 只保留粗粒度分档
- 不保留高频原始事件明细

### 6. `recent_pages`

```ts
type RecentPageInput = {
  title: string
  url: string
  dwell_seconds: number
}
```

建议：

- 只保留最近 `3` 页
- 每页只保留最小必要摘要

---

## LLM Output

MVP 不要求 LLM 直接输出复杂认知态枚举。

先收敛为以下结构：

```ts
type MVPStateInference = {
  alignment_state: "on_track" | "drifting" | "off_track" | "uncertain"
  mode_hint: "search" | "deep_dive" | "feed" | "video" | "break" | "explore" | "unknown"
  confidence: number
  nudge_message?: string | null
  icebreaker_message?: string | null
  suggested_goal?: string | null
}
```

字段解释：

- `alignment_state`
  - 是否仍与目标对齐
  - 无目标模式下通常返回 `uncertain`
- `mode_hint`
  - 当前大致浏览模式，供产品和复盘使用
  - 无目标探索时优先使用 `explore`
- `confidence`
  - 这次判断是否可靠
- `nudge_message`
  - 当本地策略决定展示 `nudge` 时使用的候选文案
  - 如果当前判断不适合 `nudge`，应为 `null`
- `icebreaker_message`
  - 当本地策略决定展示 `icebreaker` 时使用的候选问题式文案
  - 如果当前判断不适合 `icebreaker`，应为 `null`
- `suggested_goal`
  - 无目标模式下的安静目标草稿
  - 只保存到本地，不能单独触发页面内提醒

LLM 不再输出 `action`，也不输出单一最终 `message`。动作不是 LLM schema 的一部分，而是本地产品策略根据 `alignment_state`、`confidence`、是否有目标、冷却状态计算出来的结果。LLM 只提供与动作类型匹配的候选文案，最终是否采用由本地策略决定。

---

## Action Rule

MVP 的本地动作规则保持极简。

### 基本规则

- `silent`：只记录，不打断
- `nudge`：轻提醒
- `icebreaker`：更明确的问题式提醒

### 本地动作计算

有目标时：

- `alignment_state = on_track` -> `silent`
- `alignment_state = uncertain` -> `silent`
- `alignment_state = drifting | off_track` 且 `confidence >= 0.6` -> `nudge`
  - 展示 `nudge_message`
  - 如果缺失，则使用本地兜底文案
- 其他情况 -> `silent`

无目标时：

- 默认 `silent`
- 如果 LLM 给出 `suggested_goal`，只保存为本地目标草稿，不弹窗
- 只有当 `alignment_state = off_track` 且 `confidence >= 0.6` 时，本地才允许 `icebreaker`
  - 展示 `icebreaker_message`
  - 如果缺失，则使用本地兜底文案

这条规则保证 LLM 仍负责语义判断和候选话术，但“是否打断用户”由稳定、可测试的本地策略控制。

### 单一冷却

建议：

- 所有页面内提醒共享一个冷却窗口
- 默认 `10-15` 分钟

### 低置信降级

建议：

- 当 `confidence < 0.6` 时
- 本地仍统一降级为 `silent`

目的：

- 降低误伤
- 避免 MVP 阶段过度打断

---

## What MVP Does Not Do

以下能力明确不属于 MVP 主链路：

- 基于连续历史结果的复杂升级规则
- 本地“偏航趋势”推断
- 本地 `rabbit_hole / doomscrolling` 判定
- 高频行为事件精细建模
- 多层动作升级树

这些能力可以作为后续增强项，再视误判和调用成本逐步补入。

---

## Future Enhancements

当 MVP 运行后，如果发现以下问题，再考虑补强：

### 问题 1：单次判断过于摇摆

可补：

- `repeat_low_alignment_hits`

作用：

- 把前几轮低对齐结论累积起来
- 提高动作稳定性

### 问题 2：需要更早发现轨迹异常

可补：

- `context_shift_proxy_spike`

作用：

- 用简单代理信号发现轨迹突变
- 决定是否更早触发 LLM 检查

---

## Final Recommendation

MVP 阶段，最重要的不是让本地规则更聪明，而是：

1. 用尽量少的 trigger 保持系统简单
2. 用尽量清晰的输入让 LLM 理解上下文
3. 用尽量保守的动作规则避免误伤

最终收敛为：

- 2 个 trigger
- 6 个顶层输入字段
- 1 个最小输出 schema
- 1 个无目标分支
- 1 条单一冷却规则

这就是 MVP 最合适的状态契约。
