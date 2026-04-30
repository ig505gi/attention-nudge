import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { collectAdaptedPageInfo } from "./page-adapters"

function documentFromHtml(html: string, url: string) {
  return new JSDOM(html, { url }).window.document
}

describe("page adapter registry", () => {
  it("falls back to generic ready page info for ordinary article pages", () => {
    const href = "https://example.com/articles/rag"
    const document = documentFromHtml(`
      <html>
        <head>
          <title>RAG 实战指南</title>
          <meta name="description" content="用检索增强生成改进客服问答系统">
        </head>
        <body><p>第一段正文内容。</p></body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      title: "RAG 实战指南",
      meta: "用检索增强生成改进客服问答系统",
      url: href,
      adapter_id: "generic",
      evaluation_readiness: "ready",
      evaluation_ready: true
    })
  })
})

describe("ChatGPT adapter", () => {
  it("marks an empty ChatGPT conversation as not ready", () => {
    const href = "https://chatgpt.com/"
    const document = documentFromHtml(`
      <html>
        <head>
          <title>ChatGPT</title>
          <meta name="description" content="ChatGPT 是一款供日常使用的 AI 聊天机器人。">
        </head>
        <body>
          <main>
            <textarea>正在输入但尚未提交的问题</textarea>
          </main>
        </body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "chatgpt",
      evaluation_readiness: "not_ready",
      evaluation_ready: false,
      quality_reason: "empty_conversation",
      excerpt: ""
    })
  })

  it("marks a titled ChatGPT page without message evidence as low info", () => {
    const href = "https://chatgpt.com/c/abc"
    const document = documentFromHtml(`
      <html>
        <head>
          <title>React 状态管理 - ChatGPT</title>
          <meta name="description" content="ChatGPT 是一款供日常使用的 AI 聊天机器人。">
        </head>
        <body><main></main></body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      title: "React 状态管理 - ChatGPT",
      adapter_id: "chatgpt",
      evaluation_readiness: "low_info",
      evaluation_ready: false,
      quality_reason: "missing_conversation_excerpt"
    })
  })

  it("becomes ready when submitted user messages are visible and ignores draft inputs", () => {
    const href = "https://chatgpt.com/c/abc"
    const document = documentFromHtml(`
      <html>
        <head><title>ChatGPT</title></head>
        <body>
          <main>
            <textarea>不要读取这个未提交草稿</textarea>
            <div data-message-author-role="user">如何设计 Chrome extension 的测试架构？</div>
            <div data-message-author-role="assistant">可以先把 runtime 和 DOM 采集拆开测试。</div>
          </main>
        </body>
      </html>
    `, href)

    const result = collectAdaptedPageInfo({ document, href })

    expect(result).toMatchObject({
      adapter_id: "chatgpt",
      evaluation_readiness: "ready",
      evaluation_ready: true
    })
    expect(result.excerpt).toContain("如何设计 Chrome extension 的测试架构")
    expect(result.excerpt).not.toContain("不要读取这个未提交草稿")
    expect(result.excerpt!.length).toBeLessThanOrEqual(500)
  })
})

describe("DeepSeek adapter", () => {
  it("marks an empty DeepSeek conversation as not ready", () => {
    const href = "https://chat.deepseek.com/"
    const document = documentFromHtml(`
      <html>
        <head>
          <title>DeepSeek</title>
          <meta name="description" content="DeepSeek 是一款智能助手，可帮助你高效完成各种任务。">
        </head>
        <body><main></main></body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "deepseek",
      evaluation_readiness: "not_ready",
      evaluation_ready: false,
      quality_reason: "empty_conversation"
    })
  })

  it("becomes ready when displayed DeepSeek message content is visible", () => {
    const href = "https://chat.deepseek.com/a/chat/s/abc"
    const document = documentFromHtml(`
      <html>
        <head><title>DeepSeek</title></head>
        <body>
          <main>
            <div data-role="user">帮我比较 Plasmo 和 WXT 的扩展开发体验</div>
          </main>
        </body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "deepseek",
      evaluation_readiness: "ready",
      evaluation_ready: true,
      excerpt: "帮我比较 Plasmo 和 WXT 的扩展开发体验"
    })
  })
})

describe("search adapters", () => {
  it("marks Google home page as not ready", () => {
    const href = "https://www.google.com/"
    const document = documentFromHtml("<html><head><title>Google</title></head><body></body></html>", href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "google-search",
      evaluation_readiness: "not_ready",
      evaluation_ready: false,
      quality_reason: "empty_search_query"
    })
  })

  it("marks Google search results as ready when query and results are present", () => {
    const href = "https://www.google.com/search?q=llm%20app%20development"
    const document = documentFromHtml(`
      <html>
        <head><title>llm app development - Google Search</title></head>
        <body>
          <div id="search">
            <div class="g">
              <h3>LLM app development guide</h3>
              <div data-sncf="1">A practical guide to building LLM apps.</div>
            </div>
          </div>
        </body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      title: "Google 搜索：llm app development",
      meta: "",
      adapter_id: "google-search",
      evaluation_readiness: "ready",
      evaluation_ready: true
    })
  })

  it("keeps unrelated Google pages on the generic fallback", () => {
    const href = "https://www.google.com/maps/place/Shanghai"
    const document = documentFromHtml(`
      <html>
        <head>
          <title>Shanghai - Google Maps</title>
          <meta name="description" content="Map details for Shanghai">
        </head>
        <body><p>Map details for Shanghai</p></body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "generic",
      evaluation_readiness: "ready",
      evaluation_ready: true
    })
  })

  it("marks Baidu home page as not ready", () => {
    const href = "https://www.baidu.com/"
    const document = documentFromHtml("<html><head><title>百度一下</title></head><body></body></html>", href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      adapter_id: "baidu-search",
      evaluation_readiness: "not_ready",
      evaluation_ready: false,
      quality_reason: "empty_search_query"
    })
  })

  it("marks Baidu search results as ready when query and results are present", () => {
    const href = "https://www.baidu.com/s?wd=%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91"
    const document = documentFromHtml(`
      <html>
        <head><title>大模型应用开发_百度搜索</title></head>
        <body>
          <div id="content_left">
            <div class="result">
              <h3>大模型应用开发实践</h3>
              <div class="c-abstract">从提示词、工具调用到评估闭环。</div>
            </div>
          </div>
        </body>
      </html>
    `, href)

    expect(collectAdaptedPageInfo({ document, href })).toMatchObject({
      title: "百度搜索：大模型应用开发",
      meta: "",
      adapter_id: "baidu-search",
      evaluation_readiness: "ready",
      evaluation_ready: true
    })
  })
})
