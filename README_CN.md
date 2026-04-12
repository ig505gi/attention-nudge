# AttentionNudge

LLM 驱动的浏览器专注力助手。帮助你在浏览网页时，温柔地意识到自己是否偏离了当前任务目标。

## 特性

- **语义理解**：用 LLM 实时比对当前页面与你的任务目标
- **柔性干预**：轻度提醒到温和提示，从不强制阻断
- **隐私优先**：BYOK 模式，数据直连你的 LLM 提供商，不经过任何服务器
- **Tab 独立状态**：每个 Tab 维护自己的状态，LLM 响应会排队，等你切换到该 Tab 时才弹出
- **防抖批量**：快速打开的多个页面会合并批量发送，节省 API 调用

## 开发

```bash
cd app
npm install
npm run dev
```

加载到 Chrome：
1. 打开 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择 `app/build/chrome-mv3-dev/`

## 配置

1. 点击插件图标
2. 输入你的**当前任务**（如"学习 LLM"）
3. 填写 **API URL**、**API Key**、**模型名称**（OpenAI 兼容格式）
4. 开启** Debug 模式**可在 Service Worker 控制台查看详细日志

## 项目结构

- `content.tsx`：注入每个页面，提取标题/meta，发送给 background
- `background.ts`：每个 Tab 独立状态机，防抖批量调用 LLM，路由干预指令
- `popup.tsx`：设置面板
- `components/InterventionToast.tsx`：非阻塞式提醒 UI
- `lib/llm.ts`：OpenAI 兼容 API 调用

## 调试

1. 打开 `chrome://extensions/`
2. 找到 AttentionNudge → 点击 **Service Worker** 链接
3. 在 popup 中开启 **Debug 模式**

## 开源协议

GPL v3
