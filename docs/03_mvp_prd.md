# MVP PRD v0.1

**Date**: 2026/04/11
**Phase**: 阶段一
**目标**：验证核心干预逻辑，收集种子用户 Bad Case

---

## 概述

MVP 版本为纯 BYOK 模式，无服务端，无支付系统。用户在设置页填写自己的 API Key 和 API URL，插件直接与用户指定的大模型通信。

---

## 功能范围

### 1. 目标设定

**交互**：点击浏览器右上角插件图标，弹出面板，输入当前任务（如"写 Python 爬虫"）。

**存储**：`chrome.storage.local` 持久化，插件重启后保留。

---

### 2. 页面监控

**触发条件**：
- 用户打开新网页（`chrome.tabs.onActivated`）
- 用户切换 URL（`chrome.webNavigation.onCompleted`）

**提取内容**：
- `document.title`
- `<meta name="description">` 内容
- 首段 `<p>` 文本（最多 500 字符）

**发送至 LLM 的 JSON**：
```json
{
  "user_goal": "写一段 Python 爬虫代码",
  "current_page": {
    "title": "xxx",
    "meta": "xxx"
  }
}
```

---

### 3. LLM 判断与干预

**System Prompt 核心要求**：
- 角色：专注力领航员（非狱警）
- 输出格式：JSON `{ deviation_index: 1-5, message: "string", action: "wait" | "nudge" | "block" }`
- 语言：中文
- 语气：温和、提问式、给用户台阶

**偏离指数与干预对应**：

| 指数 | 含义 | UI 行为 |
|------|------|--------|
| 1-2 | 高度相关 | 静默记录时长 |
| 3 | 轻微偏离 | 角落小 Tips（可选） |
| 4 | 明显迷失 | 柔性对话框 |
| 5 | 直接摸鱼 | 页面变灰，需点击确认继续 |

---

### 4. 反馈机制

每个干预弹窗底部：
- 👍 按钮：无反馈
- 👎 按钮：点击后询问"是否愿意匿名发送用于改进"

---

## 不做功能（阶段一）

- `chrome.idle` 键鼠活跃度检测
- IndexedDB 本地历史存储
- 每日复盘看板
- 订阅/支付系统
- 多显示器检测

---

## 技术约束

- **Manifest V3**：必须使用 Service Worker
- **框架**：WXT 或 Plasmo（二选一）
- **API**：仅支持 OpenAI 兼容格式（DeepSeek 等）
- **Token 控制**：每次请求压缩至 500 Token 以内

---

## 验收标准

1. 用户填入 DeepSeek API Key 后，打开不相关网页能在 5 秒内收到干预提示
2. 打开相关网页（如 GitHub）不触发任何干预
3. 插件在后台运行 2 小时不导致浏览器内存增长超过 50MB
4. 用户可在 V2EX 帖子中附上 F12 Network 面板截图自证隐私

---

## 发布准备

- [ ] Chrome Web Store 开发者账号注册
- [ ] Privacy Policy 撰写（使用 Termly/Iubenda 生成）
- [ ] 插件介绍页截图/演示视频
- [ ] V2EX 帖子草稿

---

## 竞品参考

| 产品 | 干预方式 | 可借鉴点 |
|------|---------|---------|
| AI Brother | 硬阻断 | 内容语义比对逻辑 |
| Focus Bubble | 柔性轻推 | 干预文案语气 |
| StayFocusd | 域名黑名单 | —（反面教材）|
