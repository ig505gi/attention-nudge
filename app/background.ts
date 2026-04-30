import { callLLM } from "~/lib/llm"
import { createBackgroundRuntime } from "~/lib/background-runtime"
import { getSettings, getUserGoal, saveGoalSuggestion, loadDebugMode, debugLog } from "~/lib/storage"
import type { Settings } from "~/lib/types"

loadDebugMode()

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
    appendRecord(actionIcon as Record<string, string> | undefined)
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

const borderColorRGB = { r: 34, g: 197, b: 94 }

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

const runtime = createBackgroundRuntime({
  now: () => Date.now(),
  getSettings,
  getUserGoal,
  saveGoalSuggestion,
  callLLM,
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
  debugLog
})

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

  if (msg.type === "DEBUG_MODE_CHANGED") {
    await loadDebugMode()
    sendResponse({ ok: true })
    return true
  }

  const tabId = sender.tab?.id
  if (!tabId) {
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === "PAGE_READY") {
    runtime.handlePageReady(tabId, msg.payload, !!sender.tab?.active)
  } else if (msg.type === "VISIBILITY_CHANGE") {
    runtime.handleVisibilityChange(tabId, !!msg.payload?.visible)
  } else if (msg.type === "WINDOW_FOCUS_CHANGE") {
    runtime.handleWindowFocusChange(tabId, !!msg.payload?.focused)
  } else if (msg.type === "RUNTIME_PULSE") {
    await runtime.handleRuntimePulse(tabId, msg.payload ?? {})
  } else if (msg.type === "INTERVENTION_CHOICE") {
    const choice = msg.payload?.choice
    if (choice === "primary" || choice === "secondary") {
      await runtime.handleInterventionChoice(tabId, choice)
    }
  } else if (msg.type === "FEEDBACK_NEGATIVE") {
    debugLog("FEEDBACK", `👎 [${tabId}] 用户点击了「不准确」`)
  }

  sendResponse({ ok: true })
  return true
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await runtime.handleTabActivated(activeInfo.tabId)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  runtime.handleTabRemoved(tabId)
})

chrome.idle.onStateChanged.addListener((idleState) => {
  runtime.handleIdleStateChanged(idleState)
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.settings?.newValue) {
    const nextSettings = changes.settings.newValue as Settings
    if (typeof nextSettings.enabled === "boolean") {
      updateToolbarStatus(nextSettings.enabled).catch(() => {})
    }
    loadDebugMode().catch(() => {})
  }
})
