# 技术架构文档

**Date**: 2026/04/11
**Status**: 规划阶段

---

## 核心设计原则

**"小脑+脊髓"架构**：代码 API 负责高频条件反射（时间记录、可见性检测），LLM 负责低频复杂语义决策（意图匹配、干预策略）。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension (MV3)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Content      │───▶│ Background   │───▶│ LLM API      │   │
│  │ Script       │    │ Service      │    │ (DeepSeek/   │   │
│  │ (Perception) │    │ Worker       │    │ OpenAI/Ollama│   │
│  └──────────────┘    │ (State       │    └──────────────┘   │
│  │                   │  Machine)     │                       │
│  │                   └──────────────┘                       │
│  │                           │                              │
│  ▼                           ▼                              │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │ IndexedDB    │◀───│ Daily Review│                       │
│  │ (Local       │    │ Dashboard   │                       │
│  │  History)    │    │ (ECharts)   │                       │
│  └──────────────┘    └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 模块设计

### 1. Perception Layer（内容脚本）

**职责**：环境感知，收集物理状态数据。

**实现**：
- `visibilitychange` 监听 → 页面可见性
- `mousemove/keydown/wheel` 事件 → 键鼠活跃度（防抖处理）
- `<video>/<audio>` 标签状态 → 媒体播放检测
- 提取 Title、Meta description、首段文本

**心跳机制**：每 10 秒根据当前状态向 Background 发送 Active/Immersive 心跳。

---

### 2. State Machine（后台 Service Worker）

**职责**：维护注意力状态机，决定何时调用 LLM。

**三种状态**：

| 状态 | 条件 | 计入专注时间 |
|------|------|-------------|
| Active | 页面可见 + 窗口有焦点 + 键鼠活动 | ✅ |
| Immersive | 页面可见 + 视频/音频播放中 | ✅ |
| Inactive | 页面隐藏 / chrome.idle 超 60s / 窗口失焦且无媒体 | ❌ |

**LLM 触发时机**：
- 用户打开/切换网页时 → 立即进行"进门安检"
- Active/Immersive 累积时间达到阈值时 → 复核判定

---

### 3. LLM Interaction Layer

**输入 JSON 结构**：
```json
{
  "user_goal": "写一段 Python 爬虫代码",
  "recent_path": [
    "StackOverflow: requests 报错 403",
    "知乎: 黑客是如何隐藏自己的 IP 的？"
  ],
  "current_page": {
    "title": "xxx",
    "meta": "xxx",
    "stay_time_seconds": 45,
    "idle": false
  }
}
```

**输出**：偏离指数（1-5）+ 干预指令（wait/silent/nudge/block）

**Prompt 设计哲学**：领航员视角，觉察+核对+引导，不评判用户"意志力薄弱"。

---

### 4. Local Storage（IndexedDB）

**数据模型**：
```typescript
interface BrowsingRecord {
  id: string;
  timestamp: number;
  url: string;
  title: string;
  goal: string;
  deviation_index: number;  // 1-5
  stay_duration: number;    // 秒
  intervention_type: 'silent' | 'nudge' | 'block';
  user_feedback?: 'up' | 'down';
}
```

**读写分离**：
- 实时干预：读取最近 3-5 条记录（滑动窗口）
- 每日复盘：全量读取，使用不同的 Prompt 生成"漫游日记"

---

## 技术栈选型

| 模块 | 推荐方案 | 备注 |
|------|---------|------|
| 插件框架 | WXT 或 Plasmo | 原生支持 MV3，简化 manifest 管理 |
| AI 推理 | WebLLM (MLC LLM) | 可选本地推理，终极隐私 |
| AI SDK | Vercel AI SDK 或 LangChain.js | 流式交互，滑动窗口管理 |
| 本地存储 | IndexedDB | Dexie.js 封装简化操作 |
| 图表 | ECharts | 轻量级注意力分布可视化 |

---

## API 调用策略（多层级决策）

```
┌────────────────────────────────────────┐
│  Layer 1: 本地白名单判断                │ ← 毫秒级，零成本
│  (域名匹配 → 直接放行)                  │
└────────────────┬───────────────────────┘
                 ▼
┌────────────────────────────────────────┐
│  Layer 2: 嵌入向量相似度（可选）        │ ← 快速，低成本
│  (本地轻量 Embedding 模型)              │
└────────────────┬───────────────────────┘
                 ▼
┌────────────────────────────────────────┐
│  Layer 3: LLM 深度语义理解              │ ← 有延迟，有成本
│  (偏离指数 + 干预策略)                  │
└────────────────────────────────────────┘
```

---

## 权限清单（Manifest V3）

```json
{
  "permissions": ["idle", "tabs", "storage"],
  "host_permissions": ["<all_urls>"]
}
```

**不申请**：`system.display`（多显示器检测非核心功能，且易引发隐私审核）

---

## BYOK vs 订阅模式架构差异

### BYOK 模式（阶段一）
```
用户浏览器 → 直接请求 → DeepSeek/OpenAI API
（零后端，零成本，零数据留存）
```

### 订阅模式（阶段三）
```
用户浏览器 → 我们的无状态网关 → DeepSeek/OpenAI API
（网关仅转发，不存储浏览明细）
```
