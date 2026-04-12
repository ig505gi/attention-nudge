import { getSettings, getUserGoal, loadDebugMode, debugLog } from "~/lib/storage"
import { callLLM } from "~/lib/llm"
import type { PageInfo, TabState, BatchEntry, LLMResponse } from "~/lib/types"

const DEBOUNCE_MS = 5_000 // 5s 防抖窗口

// 每个 tab 独立状态
const tabStates = new Map<number, TabState>()

// 防抖批量队列
let batchQueue: BatchEntry[] = []
let debounceTimer: number | null = null
let requestSeq = 0 // 序列号
const pendingRequests = new Map<number, { seq: number; tabId: number; url: string }>()

// 当前活跃 tab
let activeTabId: number | null = null

// 初始化 debug 模式
loadDebugMode()

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

function getOrCreateTabState(tabId: number, pageInfo: PageInfo, startTime: number): TabState {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      pageInfo,
      startTime,
      isVisible: false,
      pendingIntervention: null,
      pendingRequest: false
    })
  }
  return tabStates.get(tabId)!
}

function cleanupTab(tabId: number) {
  tabStates.delete(tabId)
  batchQueue = batchQueue.filter(e => e.tabId !== tabId)
}

// ─────────────────────────────────────────────
//  防抖批量处理
// ─────────────────────────────────────────────

function addToBatch(entry: BatchEntry) {
  // 覆盖同 tab 的旧条目（页面刷新）
  batchQueue = batchQueue.filter(e => e.tabId !== entry.tabId)
  batchQueue.push(entry)
  debugLog("BATCH", `📦 加入批量队列: [${entry.tabId}] ${entry.pageInfo.title}，当前队列: ${batchQueue.length} 个`)

  // 重置防抖计时器
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    flushBatch()
  }, DEBOUNCE_MS)
}

async function flushBatch() {
  if (batchQueue.length === 0) return

  const entries = [...batchQueue]
  batchQueue = []
  debounceTimer = null

  const settings = await getSettings()
  const userGoal = await getUserGoal()
  if (!settings?.apiKey || !settings?.apiUrl || !userGoal?.goal) {
    debugLog("LLM", "⚠️ 跳过批量 LLM：缺少配置")
    entries.forEach(e => {
      const state = tabStates.get(e.tabId)
      if (state) state.pendingRequest = false
    })
    return
  }

  debugLog("BATCH", `🚀 开始批量发送 ${entries.length} 个页面到 LLM`)

  // 为每个条目分配序列号
  entries.forEach(entry => {
    const seq = ++requestSeq
    pendingRequests.set(seq, { seq, tabId: entry.tabId, url: entry.pageInfo.url })
    const state = tabStates.get(entry.tabId)
    if (state) state.pendingRequest = true
  })

  // 批量调用（支持一次发送多个页面）
  const results = await callLLMBatch(settings, userGoal.goal, entries)

  // 路由结果到各 tab（乱序也没关系）
  results.forEach(({ entry, response }) => {
    const state = tabStates.get(entry.tabId)
    if (!state) return

    state.pendingRequest = false

    if (!response) {
      debugLog("LLM", `❌ [${entry.tabId}] LLM 返回 null`)
      return
    }

    debugLog("LLM", `📥 [${entry.tabId}] LLM 响应: deviation=${response.deviation_index}, action=${response.action}`)
    debugLog("LLM", `   "${response.message}"`)

    // 保存待弹出的干预
    state.pendingIntervention = response

    // 如果这个 tab 正是当前活跃 tab，立即弹出
    if (entry.tabId === activeTabId) {
      triggerIntervention(entry.tabId, response)
    }
  })
}

// ─────────────────────────────────────────────
//  LLM 批量调用
// ─────────────────────────────────────────────

async function callLLMBatch(
  settings: Settings,
  userGoal: string,
  entries: BatchEntry[]
): Promise<{ entry: BatchEntry; response: LLMResponse | null }[]> {
  const results: { entry: BatchEntry; response: LLMResponse | null }[] = []

  // 目前逐个调用（可优化为真正的批量 API）
  // 结构化 prompt 支持批量
  const pageList = entries
    .map((e, i) => `${i + 1}. [${e.pageInfo.title}] - ${e.pageInfo.meta || "(无描述)"} (URL: ${e.pageInfo.url})`)
    .join("\n")

  for (const entry of entries) {
    const stayTime = Math.floor((Date.now() - entry.startTime) / 1000)

    debugLog("LLM", `📤 [${entry.tabId}] 发送请求 (停留 ${stayTime}s)`)
    debugLog("LLM", `   目标: ${userGoal}`)
    debugLog("LLM", `   页面: ${entry.pageInfo.title}`)

    try {
      const response = await callLLM(settings, {
        user_goal: userGoal,
        current_page: {
          title: entry.pageInfo.title,
          meta: entry.pageInfo.meta,
          url: entry.pageInfo.url,
          stay_time_seconds: stayTime
        }
      })
      results.push({ entry, response })
    } catch (err) {
      debugLog("LLM", `❌ [${entry.tabId}] 调用异常: ${err}`)
      results.push({ entry, response: null })
    }
  }

  return results
}

// ─────────────────────────────────────────────
//  干预触发
// ─────────────────────────────────────────────

function triggerIntervention(tabId: number, response: LLMResponse) {
  if (response.deviation_index >= 4 || response.action === "block") {
    debugLog("INTERVENTION", `🔴 [${tabId}] 强干预触发 (偏离指数: ${response.deviation_index})`)
    debugLog("INTERVENTION", `   "${response.message}"`)
    chrome.tabs.sendMessage(tabId, {
      type: "SHOW_INTERVENTION",
      payload: { message: response.message }
    })
  } else if (response.deviation_index === 3 || response.action === "nudge") {
    debugLog("INTERVENTION", `🟡 [${tabId}] 轻度提醒 (偏离指数: ${response.deviation_index})`)
    debugLog("INTERVENTION", `   "${response.message}"`)
  } else {
    debugLog("INTERVENTION", `🟢 [${tabId}] 无干预 (偏离指数: ${response.deviation_index})`)
  }
}

// ─────────────────────────────────────────────
//  Chrome 事件监听
// ─────────────────────────────────────────────

// 处理来自 content script 的消息
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  const tabId = sender.tab?.id
  if (!tabId) {
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === "PAGE_READY") {
    // content script 告知页面内容已准备好
    const pageInfo = msg.payload as PageInfo
    const now = Date.now()

    debugLog("PERCEPTION", `📄 [${tabId}] 内容就绪: ${pageInfo.title}`)
    debugLog("PERCEPTION", `   URL: ${pageInfo.url}`)
    debugLog("PERCEPTION", `   Meta: ${pageInfo.meta?.slice(0, 80)}...`)

    const state = getOrCreateTabState(tabId, pageInfo, now)
    state.isVisible = true

    // 加入防抖批量队列
    addToBatch({ tabId, pageInfo, startTime: now })
  } else if (msg.type === "VISIBILITY_CHANGE") {
    const state = tabStates.get(tabId)
    if (state) {
      state.isVisible = msg.payload.visible
      debugLog("STATE", `👁️ [${tabId}] 可见性: ${state.isVisible}`)
    }
  } else if (msg.type === "FEEDBACK_NEGATIVE") {
    debugLog("FEEDBACK", `👎 [${tabId}] 用户点击了「不准确」`)
  } else if (msg.type === "DEBUG_MODE_CHANGED") {
    await loadDebugMode()
    debugLog("CONFIG", `Debug 模式: ${msg.payload.debugMode ? "开启" : "关闭"}`)
  }

  sendResponse({ ok: true })
  return true
})

// Tab 切换时：清理旧 tab 的弹窗，检查新 tab 是否有 pending 干预
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const prevTab = activeTabId
  activeTabId = activeInfo.tabId

  debugLog("TAB", `🔄 Tab 切换: ${prevTab ?? "none"} → ${activeTabId}`)

  // 隐藏上一个 tab 的弹窗
  if (prevTab) {
    chrome.tabs.sendMessage(prevTab, { type: "HIDE_INTERVENTION" }).catch(() => {})
  }

  // 检查当前 tab 是否有待弹出的干预
  if (activeTabId) {
    const state = tabStates.get(activeTabId)
    if (state?.pendingIntervention) {
      debugLog("INTERVENTION", `📬 [${activeTabId}] 恢复待处理的干预`)
      triggerIntervention(activeTabId, state.pendingIntervention)
      // 清除 pending（已弹出）
      state.pendingIntervention = null
    }
  }
})

// Tab 更新时（后台打开新 tab 完成时也触发）
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    debugLog("TAB", `📝 [${tabId}] Tab 内容加载完成 (status=complete)`)
  }
})

// Tab 关闭时清理
chrome.tabs.onRemoved.addListener((tabId) => {
  debugLog("TAB", `🗑️ [${tabId}] Tab 已关闭`)
  cleanupTab(tabId)
})

// 监听空闲状态（全局）
chrome.idle.onStateChanged.addListener((state) => {
  debugLog("IDLE", `系统 idle: ${state}`)
  tabStates.forEach((s, tabId) => {
    if (state === "idle") {
      s.isVisible = false
    }
  })
})
