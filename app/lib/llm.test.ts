import { afterEach, describe, expect, it, vi } from "vitest"
import { DEBUG_LOG_STORAGE_KEY } from "./storage"
import { callLLM, resetTemperaturePreferenceCacheForTest } from "./llm"
import type { LLMRequest, Settings } from "./types"

const baseSettings: Settings = {
  enabled: true,
  apiKey: "test-key",
  apiUrl: "https://api.example.com/v1/chat/completions",
  model: "",
  debugMode: false
}

const baseRequest: LLMRequest = {
  trigger_reason: "page_checkpoint",
  goal: "完成代码评审",
  current_page: {
    title: "PR diff",
    meta: "查看改动细节",
    url: "https://example.com/pr/123",
    excerpt: "这里是代码 diff 的第一段摘要"
  },
  browser_context: {
    is_visible: true,
    is_focused: true,
    idle_state: "active",
    has_media: false
  },
  behavior_summary: {
    dwell_seconds: 42,
    active_dwell_seconds: 40,
    interaction_level: "medium",
    scroll_level: "low"
  },
  recent_pages: [
    {
      title: "Issue 123",
      url: "https://example.com/issues/123",
      dwell_seconds: 18
    }
  ]
}

function installChromeStorageMock(initialStore: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initialStore }
  const get = vi.fn(async (keys: string[]) => {
    return Object.fromEntries(keys.map((key) => [key, store[key]]))
  })
  const set = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(store, values)
  })

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get,
        set
      }
    }
  })

  return { get, set, store }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetTemperaturePreferenceCacheForTest()
})

describe("callLLM", () => {
  it("returns null when api key or api url is missing", async () => {
    await expect(callLLM({ ...baseSettings, apiKey: "" }, baseRequest)).resolves.toBeNull()
    await expect(callLLM({ ...baseSettings, apiUrl: "" }, baseRequest)).resolves.toBeNull()
  })

  it("parses markdown wrapped json and normalizes response fields", async () => {
    const content = [
      "```json",
      JSON.stringify({
        alignment_state: "bad-state",
        mode_hint: "bad-mode",
        confidence: 9,
        nudge_message: "a".repeat(80),
        icebreaker_message: 123,
        suggested_goal: "  学习 React Suspense  ",
      }),
      "```"
    ].join("\n")

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await callLLM(baseSettings, baseRequest)

    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      alignment_state: "uncertain",
      mode_hint: "unknown",
      confidence: 1,
      icebreaker_message: null,
      suggested_goal: "学习 React Suspense"
    })
    expect(result?.nudge_message?.endsWith("…")).toBe(true)
    expect(result?.nudge_message?.length).toBe(51)
    expect(result).not.toHaveProperty("action")
    expect(result).not.toHaveProperty("message")
  })

  it("uses default model and request payload when model is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"alignment_state":"on_track","mode_hint":"search","confidence":0.7,"nudge_message":null,"icebreaker_message":null}' } }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await callLLM(baseSettings, baseRequest)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(baseSettings.apiUrl)
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${baseSettings.apiKey}`
    })

    const payload = JSON.parse(init.body as string)
    expect(payload.model).toBe("deepseek-chat")
    expect(payload.temperature).toBe(0.2)
    expect(payload.messages[0].content).toContain("nudge_message")
    expect(payload.messages[0].content).toContain("icebreaker_message")
    expect(payload.messages[0].content).not.toContain('"action"')
    expect(payload.messages[1].content).toContain(baseRequest.goal as string)
    expect(payload.messages[1].content).toContain(baseRequest.current_page.title)
    expect(payload.messages[1].content).toContain(baseRequest.trigger_reason)
    expect(payload.messages[1].content).toContain(baseRequest.browser_context.idle_state)
    expect(payload.messages[1].content).toContain(baseRequest.behavior_summary.interaction_level)
  })

  it("retries with temperature 1 when model requires it and caches preference", async () => {
    const successResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"alignment_state":"on_track","mode_hint":"search","confidence":0.7,"nudge_message":null,"icebreaker_message":null}' } }]
      }),
      { status: 200 }
    )

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "This model only supports temperature = 1" }
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(successResponse.clone())
      .mockResolvedValueOnce(successResponse.clone())

    vi.stubGlobal("fetch", fetchMock)

    const firstResult = await callLLM(baseSettings, baseRequest)
    expect(firstResult).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const firstPayload = JSON.parse(firstInit.body as string)
    const retryPayload = JSON.parse(retryInit.body as string)

    expect(firstPayload.temperature).toBe(0.2)
    expect(retryPayload.temperature).toBe(1)

    const secondResult = await callLLM(baseSettings, baseRequest)
    expect(secondResult).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [, cachedInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    const cachedPayload = JSON.parse(cachedInit.body as string)
    expect(cachedPayload.temperature).toBe(1)
  })

  it("returns null when response is not ok or content is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "" } }]
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(callLLM(baseSettings, baseRequest)).resolves.toBeNull()
    await expect(callLLM(baseSettings, baseRequest)).resolves.toBeNull()
  })

  it("preserves no-goal alignment and includes no-goal context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: '{"alignment_state":"off_track","mode_hint":"explore","confidence":0.8,"nudge_message":null,"icebreaker_message":"要不要先定一个小目标？","suggested_goal":"学习 React Suspense"}'
            }
          }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await callLLM(baseSettings, { ...baseRequest, goal: null })

    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      alignment_state: "off_track",
      mode_hint: "explore",
      icebreaker_message: "要不要先定一个小目标？",
      suggested_goal: "学习 React Suspense"
    })
    expect(result).not.toHaveProperty("action")

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.messages[1].content).toContain("当前目标：未设置")
    expect(payload.messages[1].content).toContain("最近页面轨迹")
  })

  it("keeps suggested goal from a no-goal response without deriving an action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: '{"alignment_state":"on_track","mode_hint":"explore","confidence":0.74,"nudge_message":null,"icebreaker_message":null,"suggested_goal":"学习 React Suspense"}'
            }
          }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await callLLM(baseSettings, { ...baseRequest, goal: null })

    expect(result).toMatchObject({
      alignment_state: "on_track",
      mode_hint: "explore",
      suggested_goal: "学习 React Suspense"
    })
    expect(result).not.toHaveProperty("action")
  })

  it("stores timestamped LLM chat records when debug mode is enabled", async () => {
    const storageLocal = installChromeStorageMock({
      [DEBUG_LOG_STORAGE_KEY]: []
    })
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_716_000_000_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: '{"alignment_state":"drifting","mode_hint":"video","confidence":0.72,"nudge_message":"视频还贴合目标吗？","icebreaker_message":null}'
            }
          }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await callLLM({ ...baseSettings, debugMode: true }, baseRequest)

    expect(result).toMatchObject({
      alignment_state: "drifting",
      mode_hint: "video",
      nudge_message: "视频还贴合目标吗？",
      icebreaker_message: null
    })
    expect(result).not.toHaveProperty("action")
    expect(storageLocal.set).toHaveBeenCalledTimes(2)

    const savedLogs = storageLocal.store[DEBUG_LOG_STORAGE_KEY] as Array<{
      timestamp: string
      tag: string
      event: string
      payload: Record<string, unknown>
    }>
    const requestLog = savedLogs.find((log) => log.event === "request")
    const responseLog = savedLogs.find((log) => log.event === "response")

    expect(requestLog).toMatchObject({
      timestamp: "2024-05-18T02:40:00.000Z",
      tag: "LLM_CHAT",
      event: "request"
    })
    expect(requestLog?.payload).toMatchObject({
      model: "deepseek-chat",
      temperature: 0.2,
      triggerReason: "page_checkpoint"
    })
    expect(requestLog?.payload.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining(baseRequest.current_page.title)
      })
    ])
    expect(JSON.stringify(requestLog)).not.toContain(baseSettings.apiKey)

    expect(responseLog).toMatchObject({
      tag: "LLM_CHAT",
      event: "response"
    })
    expect(responseLog?.payload.rawContent).toContain("视频还贴合目标吗？")
    expect(responseLog?.payload.parsed).toMatchObject({
      alignment_state: "drifting",
      mode_hint: "video",
      confidence: 0.72,
      nudge_message: "视频还贴合目标吗？",
      icebreaker_message: null
    })

    nowSpy.mockRestore()
  })
})
