import type { InteractionLevel, PageInfo } from "./types"

export const DEFAULT_WHEEL_THROTTLE_MS = 300

const INVISIBLE_FORMAT_CHARS =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g
const GENERIC_PAGE_TITLES = new Set([
  "doc",
  "docs",
  "document",
  "untitled",
  "untitled document"
])

type ContentElement = {
  textContent?: string | null
  getAttribute?: (name: string) => string | null
}

type ContentDocument = {
  title?: string
  querySelector: (selector: string) => ContentElement | null
}

export type PageReadyPayload = Omit<PageInfo, "timestamp">

function sanitizePageText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(INVISIBLE_FORMAT_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function sanitizePageTitle(title: string | null | undefined): string {
  return sanitizePageText(title)
}

function isGenericPageTitle(title: string): boolean {
  const normalized = sanitizePageTitle(title).toLowerCase()
  return !normalized || GENERIC_PAGE_TITLES.has(normalized)
}

function getMetaContent(documentRef: ContentDocument, selector: string): string {
  return sanitizePageText(
    documentRef.querySelector(selector)?.getAttribute?.("content") ?? ""
  )
}

function getElementText(documentRef: ContentDocument, selector: string): string {
  const element = documentRef.querySelector(selector)
  if (!element) return ""
  if (element.getAttribute?.("aria-hidden") === "true") return ""
  if (element.getAttribute?.("hidden") !== null) return ""

  return sanitizePageText(
    element.textContent || element.getAttribute?.("aria-label") || ""
  )
}

function pickBestTitle(candidates: string[], fallback: string): string {
  const best = candidates.find((candidate) => !isGenericPageTitle(candidate))
  return best ?? fallback
}

export function collectPageInfo(options: {
  document: ContentDocument
  href: string
}): PageReadyPayload {
  const documentTitle = sanitizePageTitle(options.document.title)
  const firstPara = sanitizePageText(
    options.document.querySelector("p")?.textContent ?? ""
  ).slice(0, 500)
  const title = pickBestTitle([
    documentTitle,
    getMetaContent(options.document, 'meta[property="og:title"]'),
    getMetaContent(options.document, 'meta[name="twitter:title"]'),
    getElementText(options.document, "h1"),
    getElementText(options.document, '[role="heading"][aria-level="1"]'),
    getElementText(options.document, '[data-testid="document-title"]'),
    getElementText(options.document, '[data-testid="title"]'),
    getElementText(options.document, '[class*="title"]')
  ], documentTitle)
  const meta =
    getMetaContent(options.document, 'meta[name="description"]') ||
    getMetaContent(options.document, 'meta[property="og:description"]') ||
    firstPara

  return {
    title,
    meta,
    url: options.href,
    excerpt: firstPara
  }
}

export function createPageInfoSnapshot(pageInfo: PageReadyPayload): string {
  return JSON.stringify({
    title: sanitizePageText(pageInfo.title),
    meta: sanitizePageText(pageInfo.meta),
    url: sanitizePageText(pageInfo.url),
    excerpt: sanitizePageText(pageInfo.excerpt)
  })
}

export function createPageReadyDeduper() {
  let lastSnapshot: string | null = null

  return {
    shouldSend(pageInfo: PageReadyPayload): boolean {
      const snapshot = createPageInfoSnapshot(pageInfo)
      if (snapshot === lastSnapshot) return false
      lastSnapshot = snapshot
      return true
    },
    reset() {
      lastSnapshot = null
    }
  }
}

export function levelFromCount(count: number, highThreshold: number): InteractionLevel {
  if (count >= highThreshold) return "high"
  if (count > 0) return "medium"
  return "low"
}

export function createInteractionSampler(options: {
  now?: () => number
  wheelThrottleMs?: number
} = {}) {
  const now = options.now ?? Date.now
  const wheelThrottleMs = options.wheelThrottleMs ?? DEFAULT_WHEEL_THROTTLE_MS
  let interactionCount = 0
  let scrollCount = 0
  let sawMouseMove = false
  let lastWheelAt = Number.NEGATIVE_INFINITY

  return {
    recordKeydown() {
      interactionCount += 1
    },
    recordClick() {
      interactionCount += 1
    },
    recordMouseMove() {
      sawMouseMove = true
    },
    recordWheel() {
      const current = now()
      if (current - lastWheelAt < wheelThrottleMs) {
        return
      }
      lastWheelAt = current
      scrollCount += 1
    },
    snapshotAndReset() {
      const snapshot = {
        interactionLevel: levelFromCount(interactionCount + (sawMouseMove ? 1 : 0), 5),
        scrollLevel: levelFromCount(scrollCount, 6)
      }
      interactionCount = 0
      scrollCount = 0
      sawMouseMove = false
      return snapshot
    }
  }
}

export function runWhenDocumentReady(options: {
  document: Pick<Document, "readyState" | "addEventListener" | "removeEventListener">
  run: () => void
}): () => void {
  let disposed = false
  let pending = false

  const runOnce = () => {
    if (disposed) return
    pending = false
    options.run()
  }

  if (options.document.readyState === "loading") {
    pending = true
    options.document.addEventListener("DOMContentLoaded", runOnce, { once: true })
    return () => {
      disposed = true
      if (!pending) return
      pending = false
      options.document.removeEventListener("DOMContentLoaded", runOnce)
    }
  }

  options.run()
  return () => {
    disposed = true
  }
}

export function createContentServiceController(options: {
  getEnabled: () => Promise<boolean>
  start: () => () => void
  subscribeToEnabledChange: (listener: (enabled: boolean) => void) => () => void
  onError?: (error: unknown) => void
}) {
  let monitoringCleanup: (() => void) | null = null
  let disposed = false
  let enabledChangeCount = 0

  const stopMonitoring = () => {
    if (!monitoringCleanup) return
    monitoringCleanup()
    monitoringCleanup = null
  }

  const applyEnabled = (enabled: boolean) => {
    if (disposed) return

    if (!enabled) {
      stopMonitoring()
      return
    }

    if (monitoringCleanup) return
    monitoringCleanup = options.start()
  }

  const unsubscribe = options.subscribeToEnabledChange((enabled) => {
    enabledChangeCount += 1
    applyEnabled(enabled)
  })

  return {
    async init() {
      const initialReadChangeCount = enabledChangeCount
      try {
        const enabled = await options.getEnabled()
        if (enabledChangeCount === initialReadChangeCount) {
          applyEnabled(enabled)
        }
      } catch (error) {
        options.onError?.(error)
      }
    },
    dispose() {
      disposed = true
      unsubscribe()
      stopMonitoring()
    }
  }
}

export function installSpaNavigationListener(options: {
  history: Pick<History, "pushState" | "replaceState">
  eventTarget: Pick<Window, "addEventListener" | "removeEventListener">
  getHref: () => string
  onUrlChange: () => void
  defer?: (fn: () => void) => void
}): () => void {
  const defer = options.defer ?? ((fn: () => void) => window.setTimeout(fn, 0))
  const originalPushState = options.history.pushState
  const originalReplaceState = options.history.replaceState
  let currentHref = options.getHref()
  let disposed = false

  const notifyIfChanged = () => {
    if (disposed) return
    const nextHref = options.getHref()
    if (nextHref === currentHref) return
    currentHref = nextHref
    options.onUrlChange()
  }

  const scheduleNotify = () => {
    defer(notifyIfChanged)
  }

  options.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args)
    scheduleNotify()
    return result
  } as History["pushState"]

  options.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args)
    scheduleNotify()
    return result
  } as History["replaceState"]

  options.eventTarget.addEventListener("popstate", scheduleNotify)
  options.eventTarget.addEventListener("hashchange", scheduleNotify)

  return () => {
    disposed = true
    options.history.pushState = originalPushState
    options.history.replaceState = originalReplaceState
    options.eventTarget.removeEventListener("popstate", scheduleNotify)
    options.eventTarget.removeEventListener("hashchange", scheduleNotify)
  }
}
