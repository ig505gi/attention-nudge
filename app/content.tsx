import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import InterventionToast from "~/components/InterventionToast"

function ContentScript() {
  useEffect(() => {
    let sent = false

    const getPageInfo = () => {
      const title = document.title || ""
      const meta =
        document.querySelector('meta[name="description"]')?.getAttribute("content") || ""
      const firstPara =
        document.querySelector("p")?.textContent?.slice(0, 500) || ""

      return {
        title,
        meta: meta || firstPara,
        url: window.location.href
      }
    }

    // 等待 DOM 解析完成后发送（拿到标题和 meta）
    const sendWhenReady = () => {
      if (sent) return
      const pageInfo = getPageInfo()
      sent = true

      console.log(`[AttentionNudge][CONTENT] 页面信息就绪:`, pageInfo)

      chrome.runtime.sendMessage({
        type: "PAGE_READY",
        payload: pageInfo
      })
    }

    // 优先用 DOMContentLoaded（最快），fallback 到 500ms 兜底
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sendWhenReady, { once: true })
    } else {
      // 已经过了 DOMContentLoaded，直接发
      sendWhenReady()
    }

    // 兜底：500ms 后无论怎样都发一次（应对 SPA 动态内容）
    const fallback = setTimeout(sendWhenReady, 500)

    // 监听来自 background 的干预指令
    const handleIntervention = (message: any) => {
      if (message.type === "SHOW_INTERVENTION") {
        clearTimeout(fallback)
        renderToast(message.payload.message)
      } else if (message.type === "HIDE_INTERVENTION") {
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

    return () => {
      clearTimeout(fallback)
      chrome.runtime.onMessage.removeListener(handleIntervention)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return null
}

// 渲染干预弹窗
let toastRoot: ReturnType<typeof createRoot> | null = null

function renderToast(message: string) {
  const existing = document.getElementById("attention-nudge-toast")
  if (existing) existing.remove()

  const container = document.createElement("div")
  container.id = "attention-nudge-toast"
  document.body.appendChild(container)

  toastRoot = createRoot(container)
  toastRoot.render(
    <InterventionToast
      message={message}
      onFeedback={(up) => {
        if (!up) {
          chrome.runtime.sendMessage({ type: "FEEDBACK_NEGATIVE" })
        }
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
