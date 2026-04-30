import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import InterventionToast from "~/components/InterventionToast"
import {
  collectPageInfo,
  createInteractionSampler,
  createPageReadyDeduper,
  installSpaNavigationListener
} from "~/lib/content-runtime"
import type { InterventionAction } from "~/lib/types"

const THEME_PREF_STORAGE_KEY = "optionsThemePreference"
const PULSE_INTERVAL_MS = 5_000
const PAGE_INFO_RESAMPLE_DELAYS_MS = [500, 1_500, 3_000, 6_000]
const PAGE_INFO_CHANGE_DEBOUNCE_MS = 300

function isMediaPlaying(): boolean {
  const mediaElements = Array.from(document.querySelectorAll("video, audio")) as Array<
    HTMLMediaElement
  >
  return mediaElements.some((media) => !media.paused && !media.ended)
}

function ContentScript() {
  useEffect(() => {
    let currentAction: InterventionAction | null = null
    const interactionSampler = createInteractionSampler()
    const pageReadyDeduper = createPageReadyDeduper()
    const pageInfoResampleTimers = new Set<ReturnType<typeof window.setTimeout>>()
    let pageInfoChangeTimer: ReturnType<typeof window.setTimeout> | null = null

    const getPageInfo = () => {
      return collectPageInfo({
        document,
        href: window.location.href
      })
    }

    // 等待 DOM 解析完成后发送（拿到标题和 meta）
    const sendWhenReady = () => {
      const pageInfo = getPageInfo()
      if (!pageReadyDeduper.shouldSend(pageInfo)) return

      console.log(`[AttentionNudge][CONTENT] 页面信息就绪:`, pageInfo)

      chrome.runtime.sendMessage({
        type: "PAGE_READY",
        payload: pageInfo
      })
    }

    const schedulePageInfoCheck = (delay = PAGE_INFO_CHANGE_DEBOUNCE_MS) => {
      if (pageInfoChangeTimer !== null) {
        window.clearTimeout(pageInfoChangeTimer)
      }

      pageInfoChangeTimer = window.setTimeout(() => {
        pageInfoChangeTimer = null
        sendWhenReady()
      }, delay)
    }

    const clearPageInfoResamples = () => {
      for (const timer of pageInfoResampleTimers) {
        window.clearTimeout(timer)
      }
      pageInfoResampleTimers.clear()
    }

    const schedulePageInfoResamples = () => {
      clearPageInfoResamples()
      for (const delay of PAGE_INFO_RESAMPLE_DELAYS_MS) {
        const timer = window.setTimeout(() => {
          pageInfoResampleTimers.delete(timer)
          sendWhenReady()
        }, delay)
        pageInfoResampleTimers.add(timer)
      }
    }

    // 优先用 DOMContentLoaded（最快），fallback 到 500ms 兜底
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sendWhenReady, { once: true })
    } else {
      // 已经过了 DOMContentLoaded，直接发
      sendWhenReady()
    }

    // 兜底：分阶段重采样，捕捉 SPA/异步标题和摘要。
    schedulePageInfoResamples()
    const cleanupSpaNavigation = installSpaNavigationListener({
      history: window.history,
      eventTarget: window,
      getHref: () => window.location.href,
      onUrlChange: () => {
        pageReadyDeduper.reset()
        window.setTimeout(() => {
          sendWhenReady()
          schedulePageInfoResamples()
        }, 100)
      }
    })

    const pageInfoObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            schedulePageInfoCheck()
          })

    if (pageInfoObserver) {
      pageInfoObserver.observe(document.head ?? document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["content"]
      })

      if (document.body) {
        pageInfoObserver.observe(document.body, {
          childList: true,
          subtree: true
        })
      }
    }

    const sendRuntimePulse = () => {
      const { interactionLevel, scrollLevel } = interactionSampler.snapshotAndReset()

      chrome.runtime.sendMessage({
        type: "RUNTIME_PULSE",
        payload: {
          isVisible: document.visibilityState === "visible",
          isFocused: document.hasFocus(),
          hasMedia: isMediaPlaying(),
          interactionLevel,
          scrollLevel
        }
      })
    }

    const pulseTimer = setInterval(sendRuntimePulse, PULSE_INTERVAL_MS)

    // 监听来自 background 的干预指令
    const handleIntervention = (message: any) => {
      if (message.type === "SHOW_INTERVENTION") {
        currentAction = message.payload.action ?? null
        renderToast(
          message.payload.message,
          message.payload.button_options,
          currentAction
        )
      } else if (message.type === "HIDE_INTERVENTION") {
        currentAction = null
        removeToast()
      }
    }

    chrome.runtime.onMessage.addListener(handleIntervention)

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      chrome.runtime.sendMessage({
        type: "VISIBILITY_CHANGE",
        payload: {
          visible: document.visibilityState === "visible"
        }
      })
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    const handleFocus = () => {
      chrome.runtime.sendMessage({
        type: "WINDOW_FOCUS_CHANGE",
        payload: { focused: document.hasFocus() }
      })
    }

    window.addEventListener("focus", handleFocus)
    window.addEventListener("blur", handleFocus)

    const handleKeydown = () => {
      interactionSampler.recordKeydown()
    }
    const handleClick = () => {
      interactionSampler.recordClick()
    }
    const handleMouseMove = () => {
      interactionSampler.recordMouseMove()
    }
    const handleWheel = () => {
      interactionSampler.recordWheel()
    }

    window.addEventListener("keydown", handleKeydown, { passive: true })
    window.addEventListener("click", handleClick, { passive: true })
    window.addEventListener("mousemove", handleMouseMove, { passive: true })
    window.addEventListener("wheel", handleWheel, { passive: true })

    const handleMediaEvent = () => {
      sendRuntimePulse()
    }

    document.addEventListener("play", handleMediaEvent, true)
    document.addEventListener("pause", handleMediaEvent, true)
    document.addEventListener("ended", handleMediaEvent, true)

    handleVisibilityChange()
    handleFocus()
    sendRuntimePulse()

    return () => {
      if (pageInfoChangeTimer !== null) {
        window.clearTimeout(pageInfoChangeTimer)
      }
      clearPageInfoResamples()
      clearInterval(pulseTimer)
      cleanupSpaNavigation()
      pageInfoObserver?.disconnect()
      chrome.runtime.onMessage.removeListener(handleIntervention)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("blur", handleFocus)
      window.removeEventListener("keydown", handleKeydown)
      window.removeEventListener("click", handleClick)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("wheel", handleWheel)
      document.removeEventListener("play", handleMediaEvent, true)
      document.removeEventListener("pause", handleMediaEvent, true)
      document.removeEventListener("ended", handleMediaEvent, true)
    }
  }, [])

  return null
}

// 渲染干预弹窗
let toastRoot: ReturnType<typeof createRoot> | null = null

async function resolveToastThemePreference(): Promise<"light" | "dark" | undefined> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return undefined
  }

  const result = await chrome.storage.local.get([THEME_PREF_STORAGE_KEY])
  const pref = result[THEME_PREF_STORAGE_KEY]
  return pref === "light" || pref === "dark" ? pref : undefined
}

async function renderToast(
  message: string,
  buttonOptions?: [string, string],
  action?: InterventionAction | null
) {
  const existing = document.getElementById("attention-nudge-toast")
  if (existing) existing.remove()

  const container = document.createElement("div")
  container.id = "attention-nudge-toast"
  document.body.appendChild(container)

  const forceTheme = await resolveToastThemePreference()

  toastRoot = createRoot(container)
  toastRoot.render(
    <InterventionToast
      message={message}
      buttonOptions={buttonOptions}
      forceTheme={forceTheme}
      onClose={(choice) => {
        chrome.runtime.sendMessage({
          type: "INTERVENTION_CHOICE",
          payload: {
            choice,
            action: action ?? null
          }
        })
        removeToast()
      }}
    />
  )
}

function removeToast() {
  const existing = document.getElementById("attention-nudge-toast")
  if (existing) {
    existing.remove()
    toastRoot = null
  }
}

export default ContentScript
