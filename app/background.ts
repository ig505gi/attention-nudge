import { getSettings, getUserGoal, loadDebugMode, debugLog } from "~/lib/storage"
import type { Settings } from "~/lib/types"
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

type ToolbarState = "enabled" | "disabled"

const toolbarIconCache: Partial<Record<ToolbarState, Record<number, ImageData>>> = {}
let toolbarUpdateToken = 0

function getManifestIconMap(): Record<number, string> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    action?: { default_icon?: string | Record<string, string> }
  }

  const mergedIcons: Record<number, string> = {}

  const appendRecord = (record?: Record<string, string>) => {
    if (!record) return
    Object.entries(record).forEach(([size, path]) => {
      const n = Number(size)
      if (Number.isFinite(n) && n > 0 && path) {
        mergedIcons[n] = path
      }
    })
  }

  appendRecord(manifest.icons as Record<string, string> | undefined)

  const actionIcon = manifest.action?.default_icon
  if (typeof actionIcon === "string" && actionIcon) {
    const sizes = Object.keys(mergedIcons).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    const fallbackSize = sizes.length > 0 ? Math.max(...sizes) : 128
    if (!mergedIcons[fallbackSize]) {
      mergedIcons[fallbackSize] = actionIcon
    }
  } else {
    appendRecord(actionIcon)
  }

  return mergedIcons
}

function getManifestIconPath(): string | null {
  const iconMap = getManifestIconMap()
  const sizes = Object.keys(iconMap)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)

  if (sizes.length === 0) return null
  return iconMap[sizes[0]]
}

async function renderToolbarIcon(path: string, size: number, state: ToolbarState): Promise<ImageData | null> {
  try {
    if (typeof OffscreenCanvas === "undefined") {
      return null
    }
    const response = await fetch(chrome.runtime.getURL(path))
    if (!response.ok) return null

    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(bitmap, 0, 0, size, size)

    const imageData = ctx.getImageData(0, 0, size, size)
    const data = imageData.data

    if (state === "enabled") {
      // 仅替换图标内部“近白色描边”像素，避免给图标新增外部描边
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]

        if (a === 0) continue

        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const nearWhite = r >= 210 && g >= 210 && b >= 210 && max - min <= 24
        if (!nearWhite) continue

        // 按亮度保留抗锯齿层次
        const lum = (r + g + b) / (255 * 3)
        data[i] = Math.round(12 + borderColorRGB.r * lum)
        data[i + 1] = Math.round(12 + borderColorRGB.g * lum)
        data[i + 2] = Math.round(12 + borderColorRGB.b * lum)
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return imageData
  } catch {
    return null
  }
}

const borderColorRGB = { r: 34, g: 197, b: 94 } // #22C55E

async function getToolbarIcon(state: ToolbarState): Promise<Record<number, ImageData> | null> {
  if (toolbarIconCache[state]) {
    return toolbarIconCache[state]!
  }

  const iconMap = getManifestIconMap()
  const imageDataMap: Record<number, ImageData> = {}

  const entries = Object.entries(iconMap)
    .map(([size, path]) => [Number(size), path] as const)
    .filter(([size, path]) => Number.isFinite(size) && size > 0 && !!path)

  for (const [size, path] of entries) {
    const data = await renderToolbarIcon(path, size, state)
    if (data) {
      imageDataMap[size] = data
    }
  }

  if (Object.keys(imageDataMap).length === 0) {
    return null
  }

  toolbarIconCache[state] = imageDataMap
  return imageDataMap
}

async function updateToolbarStatus(enabled: boolean) {
  const token = ++toolbarUpdateToken
  const state: ToolbarState = enabled ? "enabled" : "disabled"
  const title = enabled ? "AttentionNudge（已开启）" : "AttentionNudge（已关闭）"

  const iconData = await getToolbarIcon(state)
  if (token !== toolbarUpdateToken) {
    return
  }

  await chrome.action.setBadgeText({ text: "" })
  if (iconData && Object.keys(iconData).length > 0) {
    await chrome.action.setIcon({ imageData: iconData })
  } else {
    const iconMap = getManifestIconMap()
    if (Object.keys(iconMap).length > 0) {
      await chrome.action.setIcon({ path: iconMap })
    }
  }
  await chrome.action.setTitle({ title })
}

async function refreshToolbarStatusFromStorage() {
  const settings = await getSettings()
  await updateToolbarStatus(settings?.enabled ?? true)
}

refreshToolbarStatusFromStorage().catch(() => {})

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
  if (!settings?.enabled) {
    debugLog("BATCH", "⏸️ 服务已关闭，跳过 LLM 调用")
    entries.forEach(e => {
      const state = tabStates.get(e.tabId)
      if (state) state.pendingRequest = false
    })
    return
  }

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
      payload: {
        message: response.message,
        button_options: response.button_options,
      }
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
  if (msg.type === "GET_ICON_URL") {
    const iconPath = getManifestIconPath()
    sendResponse({ iconUrl: iconPath ? chrome.runtime.getURL(iconPath) : "" })
    return true
  }

  if (msg.type === "SERVICE_TOGGLE") {
    debugLog("CONFIG", `服务: ${msg.payload.enabled ? "开启" : "关闭"}`)
    updateToolbarStatus(!!msg.payload?.enabled).catch(() => {})
    sendResponse({ ok: true })
    return true
  }

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings?.newValue) {
    return
  }

  const nextSettings = changes.settings.newValue as Settings
  if (typeof nextSettings.enabled === "boolean") {
    updateToolbarStatus(nextSettings.enabled).catch(() => {})
  }
})
