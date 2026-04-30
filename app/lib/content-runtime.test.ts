import { describe, expect, it, vi } from "vitest"
import {
  collectPageInfo,
  createPageReadyDeduper,
  createInteractionSampler,
  installSpaNavigationListener,
  sanitizePageTitle
} from "./content-runtime"

function element(
  textContent: string,
  attributes: Record<string, string> = {}
) {
  return {
    textContent,
    getAttribute: (name: string) => attributes[name] ?? null
  }
}

function documentLike(options: {
  title: string
  metaDescription?: string
  ogTitle?: string
  h1?: string
  firstParagraph?: string
}) {
  return {
    title: options.title,
    querySelector: (selector: string) => {
      if (selector === 'meta[name="description"]' && options.metaDescription) {
        return element("", { content: options.metaDescription })
      }
      if (selector === 'meta[property="og:title"]' && options.ogTitle) {
        return element("", { content: options.ogTitle })
      }
      if (selector === "h1" && options.h1) {
        return element(options.h1)
      }
      if (selector === "p" && options.firstParagraph) {
        return element(options.firstParagraph)
      }
      return null
    }
  }
}

describe("content runtime page info collection", () => {
  it("removes Feishu invisible title prefixes", () => {
    const rawTitle =
      "﻿​‌​​‬​​‍‬‬⁠‌​​​​​​​​​​‍﻿‬​​﻿‬​‬​​⁠‍​​﻿﻿‬​‍‬‌‍‍从一句话需求到高质量交付：基于需求工程的 AI 开发 Skill - 飞书云文档"

    expect(sanitizePageTitle(rawTitle)).toBe(
      "从一句话需求到高质量交付：基于需求工程的 AI 开发 Skill - 飞书云文档"
    )
  })

  it("falls back to og:title when document.title is generic", () => {
    const pageInfo = collectPageInfo({
      document: documentLike({
        title: "Docs",
        ogTitle: "从一句话需求到高质量交付 - 飞书云文档",
        h1: "页面 H1"
      }),
      href: "https://larksuite.com/docx/example"
    })

    expect(pageInfo.title).toBe("从一句话需求到高质量交付 - 飞书云文档")
  })

  it("falls back to h1 when generic document.title has no og:title", () => {
    const pageInfo = collectPageInfo({
      document: documentLike({
        title: "Untitled",
        h1: "需求工程 Skill"
      }),
      href: "https://larksuite.com/docx/example"
    })

    expect(pageInfo.title).toBe("需求工程 Skill")
  })

  it("allows resending when page info improves on the same URL", () => {
    const deduper = createPageReadyDeduper()

    expect(deduper.shouldSend({
      title: "Docs",
      meta: "",
      url: "https://larksuite.com/docx/example",
      excerpt: ""
    })).toBe(true)

    expect(deduper.shouldSend({
      title: "从一句话需求到高质量交付 - 飞书云文档",
      meta: "",
      url: "https://larksuite.com/docx/example",
      excerpt: ""
    })).toBe(true)
  })

  it("does not resend identical page info", () => {
    const deduper = createPageReadyDeduper()
    const pageInfo = {
      title: "需求工程 Skill",
      meta: "AI 开发流程",
      url: "https://larksuite.com/docx/example",
      excerpt: "从一句话需求开始"
    }

    expect(deduper.shouldSend(pageInfo)).toBe(true)
    expect(deduper.shouldSend({ ...pageInfo })).toBe(false)
  })
})

describe("content runtime route tracking", () => {
  it("notifies when history pushState changes the current URL", () => {
    let href = "https://example.com/a"
    const listeners = new Map<string, () => void>()
    const historyLike = {
      pushState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
        if (url) href = new URL(url.toString(), href).href
      }),
      replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
        if (url) href = new URL(url.toString(), href).href
      })
    }
    const eventTarget = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type)
      })
    }
    const onUrlChange = vi.fn()

    const cleanup = installSpaNavigationListener({
      history: historyLike,
      eventTarget,
      getHref: () => href,
      onUrlChange,
      defer: (fn) => fn()
    })

    historyLike.pushState({}, "", "/b")
    historyLike.pushState({}, "", "/b")
    href = "https://example.com/b#notes"
    listeners.get("hashchange")?.()

    expect(onUrlChange).toHaveBeenCalledTimes(2)

    cleanup()
    historyLike.pushState({}, "", "/c")
    expect(onUrlChange).toHaveBeenCalledTimes(2)
  })
})

describe("content runtime interaction sampling", () => {
  it("throttles wheel bursts before deriving scroll level", () => {
    let now = 1_000
    const sampler = createInteractionSampler({
      now: () => now,
      wheelThrottleMs: 300
    })

    for (let index = 0; index < 20; index += 1) {
      sampler.recordWheel()
      now += 10
    }

    expect(sampler.snapshotAndReset().scrollLevel).toBe("medium")

    now += 300
    for (let index = 0; index < 6; index += 1) {
      sampler.recordWheel()
      now += 310
    }

    expect(sampler.snapshotAndReset().scrollLevel).toBe("high")
  })
})
