import {
  collectPageInfo,
  sanitizePageTitle,
  type PageReadyPayload
} from "./content-runtime"
import { removeGenericMeta } from "./page-info-quality"
import type { PageEvaluationReadiness } from "./types"

type AdapterInput = {
  href: string
  document: Document
}

export interface PageAdapterResult extends PageReadyPayload {
  adapter_id: string
  evaluation_readiness: PageEvaluationReadiness
  evaluation_ready: boolean
  quality_reason?: string
}

export interface PageAdapter {
  id: string
  match(input: AdapterInput): boolean
  collect(input: AdapterInput): PageAdapterResult
}

const EXCERPT_LIMIT = 500
const GENERIC_CHAT_TITLES = new Set([
  "chatgpt",
  "new chat",
  "deepseek",
  "deepseek chat",
  "新对话"
])

function normalizeText(value: string | null | undefined): string {
  return sanitizePageTitle(value)
}

function truncateExcerpt(value: string): string {
  return normalizeText(value).slice(0, EXCERPT_LIMIT)
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

function getMeta(documentRef: Document, selector: string): string {
  return normalizeText(documentRef.querySelector(selector)?.getAttribute("content") ?? "")
}

function getElementText(element: Element | null): string {
  if (!element) return ""
  if (element.getAttribute("aria-hidden") === "true") return ""
  if (element.hasAttribute("hidden")) return ""
  return normalizeText(element.textContent ?? element.getAttribute("aria-label") ?? "")
}

function collectTexts(documentRef: Document, selectors: string[]): string[] {
  const seen = new Set<string>()
  const texts: string[] = []

  for (const selector of selectors) {
    for (const element of Array.from(documentRef.querySelectorAll(selector))) {
      const text = getElementText(element)
      if (!text || seen.has(text)) continue
      seen.add(text)
      texts.push(text)
    }
  }

  return texts
}

function getInputValue(documentRef: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const element = documentRef.querySelector(selector)
    if (element?.tagName === "INPUT" || element?.tagName === "TEXTAREA") {
      const value = normalizeText((element as HTMLInputElement | HTMLTextAreaElement).value)
      if (value) return value
    }
    const ariaLabel = normalizeText(element?.getAttribute("aria-label") ?? "")
    if (ariaLabel) return ariaLabel
  }

  return ""
}

function isHost(url: URL | null, hostSuffix: string): boolean {
  return Boolean(url?.hostname === hostSuffix || url?.hostname.endsWith(`.${hostSuffix}`))
}

function isGoogleHost(url: URL | null): boolean {
  if (!url) return false
  return url.hostname === "google.com" ||
    url.hostname.endsWith(".google.com") ||
    url.hostname.startsWith("google.") ||
    url.hostname.includes(".google.")
}

function isGoogleSearchRoute(url: URL | null): boolean {
  return Boolean(
    isGoogleHost(url) &&
      (url?.pathname === "/" || url?.pathname === "/search" || url?.searchParams.has("q"))
  )
}

function isBaiduSearchRoute(url: URL | null): boolean {
  return Boolean(
    isHost(url, "baidu.com") &&
      (url?.pathname === "/" ||
        url?.pathname === "/s" ||
        url?.searchParams.has("wd") ||
        url?.searchParams.has("word"))
  )
}

function isMeaningfulChatTitle(title: string, adapterId: string): boolean {
  const normalized = normalizeText(title)
    .replace(/\s+-\s+ChatGPT$/i, "")
    .replace(/\s+-\s+DeepSeek$/i, "")
    .toLowerCase()
  if (!normalized) return false
  if (GENERIC_CHAT_TITLES.has(normalized)) return false
  return !normalized.includes(adapterId)
}

function withReadiness(
  pageInfo: PageReadyPayload,
  adapterId: string,
  readiness: PageEvaluationReadiness,
  reason?: string
): PageAdapterResult {
  return {
    ...pageInfo,
    adapter_id: adapterId,
    evaluation_readiness: readiness,
    evaluation_ready: readiness === "ready",
    ...(reason ? { quality_reason: reason } : {})
  }
}

function collectChatPage(input: AdapterInput, adapterId: "chatgpt" | "deepseek"): PageAdapterResult {
  const base = collectPageInfo(input)
  const metaQuality = removeGenericMeta({
    adapterId,
    meta:
      base.meta ||
      getMeta(input.document, 'meta[name="description"]') ||
      getMeta(input.document, 'meta[property="og:description"]')
  })
  const title = base.title
  const userMessageSelectors =
    adapterId === "chatgpt"
      ? [
          '[data-message-author-role="user"]',
          '[data-testid*="conversation-turn"] [data-message-author-role="user"]'
        ]
      : [
          '[data-role="user"]',
          '[data-message-author-role="user"]',
          '[class*="user-message"]',
          '[class*="message"][class*="user"]'
        ]
  const assistantMessageSelectors =
    adapterId === "chatgpt"
      ? [
          '[data-message-author-role="assistant"]',
          '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]'
        ]
      : [
          '[data-role="assistant"]',
          '[data-message-author-role="assistant"]',
          ".ds-markdown",
          '[class*="assistant"]',
          '[class*="markdown"]'
        ]

  const userMessages = collectTexts(input.document, userMessageSelectors)
  const assistantMessages = collectTexts(input.document, assistantMessageSelectors)
  const excerpt = truncateExcerpt(
    userMessages[userMessages.length - 1] ?? assistantMessages[assistantMessages.length - 1] ?? ""
  )
  const pageInfo: PageReadyPayload = {
    title,
    meta: metaQuality.meta,
    url: input.href,
    excerpt
  }

  if (!excerpt) {
    if (isMeaningfulChatTitle(title, adapterId)) {
      return withReadiness(pageInfo, adapterId, "low_info", "missing_conversation_excerpt")
    }

    return withReadiness(pageInfo, adapterId, "not_ready", "empty_conversation")
  }

  return withReadiness(pageInfo, adapterId, "ready")
}

function collectSearchResults(documentRef: Document, selectors: string[]): string[] {
  return collectTexts(documentRef, selectors)
    .filter((text) => text.length >= 3)
    .slice(0, 6)
}

function collectSearchPage(input: AdapterInput, options: {
  adapterId: "google-search" | "baidu-search"
  titlePrefix: string
  queryParams: string[]
  queryInputSelectors: string[]
  resultSelectors: string[]
}): PageAdapterResult {
  const url = parseUrl(input.href)
  const queryFromUrl =
    options.queryParams
      .map((param) => normalizeText(url?.searchParams.get(param) ?? ""))
      .find(Boolean) ?? ""
  const query = queryFromUrl || getInputValue(input.document, options.queryInputSelectors)

  if (!query) {
    return withReadiness({
      title: sanitizePageTitle(input.document.title),
      meta: "",
      url: input.href,
      excerpt: ""
    }, options.adapterId, "not_ready", "empty_search_query")
  }

  const results = collectSearchResults(input.document, options.resultSelectors)
  const pageInfo: PageReadyPayload = {
    title: `${options.titlePrefix}${query}`,
    meta: "",
    url: input.href,
    excerpt: results.join("\n").slice(0, EXCERPT_LIMIT)
  }

  if (results.length === 0) {
    return withReadiness(pageInfo, options.adapterId, "low_info", "missing_search_results")
  }

  return withReadiness(pageInfo, options.adapterId, "ready")
}

const adapters: PageAdapter[] = [
  {
    id: "chatgpt",
    match: ({ href }) => isHost(parseUrl(href), "chatgpt.com"),
    collect: (input) => collectChatPage(input, "chatgpt")
  },
  {
    id: "deepseek",
    match: ({ href }) => {
      const url = parseUrl(href)
      return isHost(url, "chat.deepseek.com") || isHost(url, "deepseek.com")
    },
    collect: (input) => collectChatPage(input, "deepseek")
  },
  {
    id: "google-search",
    match: ({ href }) => isGoogleSearchRoute(parseUrl(href)),
    collect: (input) => collectSearchPage(input, {
      adapterId: "google-search",
      titlePrefix: "Google 搜索：",
      queryParams: ["q"],
      queryInputSelectors: ['input[name="q"]', 'textarea[name="q"]'],
      resultSelectors: ["#search h3", "#search [data-sncf]", "#search .VwiC3b", "#rso h3"]
    })
  },
  {
    id: "baidu-search",
    match: ({ href }) => isBaiduSearchRoute(parseUrl(href)),
    collect: (input) => collectSearchPage(input, {
      adapterId: "baidu-search",
      titlePrefix: "百度搜索：",
      queryParams: ["wd", "word"],
      queryInputSelectors: ['input[name="wd"]', 'input[name="word"]'],
      resultSelectors: ["#content_left h3", "#content_left .c-abstract", "#content_left .content-right_8Zs40"]
    })
  }
]

export function getPageAdapter(input: AdapterInput): PageAdapter | null {
  return adapters.find((adapter) => adapter.match(input)) ?? null
}

export function collectAdaptedPageInfo(input: AdapterInput): PageAdapterResult {
  const adapter = getPageAdapter(input)
  if (adapter) {
    return adapter.collect(input)
  }

  const pageInfo = collectPageInfo(input)
  const metaQuality = removeGenericMeta({
    adapterId: "generic",
    meta: pageInfo.meta
  })

  return withReadiness({
    ...pageInfo,
    meta: metaQuality.meta
  }, "generic", "ready")
}
