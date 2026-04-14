import { afterEach, describe, expect, it, vi } from "vitest"
import { callLLM, resetTemperaturePreferenceCacheForTest } from "./llm"
import type { Settings } from "./types"

const baseSettings: Settings = {
  enabled: true,
  apiKey: "test-key",
  apiUrl: "https://api.example.com/v1/chat/completions",
  model: "",
  debugMode: false
}

const baseRequest = {
  user_goal: "完成代码评审",
  current_page: {
    title: "PR diff",
    meta: "查看改动细节",
    url: "https://example.com/pr/123",
    stay_time_seconds: 42
  }
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
        deviation_index: 9,
        message: "a".repeat(80),
        action: "invalid-action",
        button_options: ["左按钮文案超长超长", "右按钮文案超长超长"]
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
      deviation_index: 5,
      action: "wait",
      button_options: ["左按钮文案超长超长", "右按钮文案超长超长"]
    })
    expect(result?.message.endsWith("…")).toBe(true)
    expect(result?.message.length).toBe(51)
  })

  it("uses default model and request payload when model is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"deviation_index":3,"message":"继续","action":"wait"}' } }]
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
    expect(payload.messages[1].content).toContain(baseRequest.user_goal)
    expect(payload.messages[1].content).toContain(baseRequest.current_page.title)
  })

  it("retries with temperature 1 when model requires it and caches preference", async () => {
    const successResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"deviation_index":3,"message":"继续","action":"wait"}' } }]
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
})
