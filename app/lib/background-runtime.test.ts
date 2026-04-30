import { describe, expect, it, vi } from "vitest"
import { createBackgroundRuntime } from "./background-runtime"
import type { LLMResponse, Settings, UserGoal } from "./types"

const settings: Settings = {
  enabled: true,
  apiKey: "test-key",
  apiUrl: "https://api.example.com/v1/chat/completions",
  model: "deepseek-chat",
  debugMode: false
}

const goal: UserGoal = {
  goal: "完成状态机测试",
  updatedAt: 1
}

const nudgeResponse: LLMResponse = {
  alignment_state: "drifting",
  mode_hint: "feed",
  confidence: 0.9,
  nudge_message: "要不要回到当前任务？",
  icebreaker_message: null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createRuntime(overrides: Partial<Parameters<typeof createBackgroundRuntime>[0]> = {}) {
  let now = 1_000
  const deps = {
    now: () => now,
    getSettings: vi.fn().mockResolvedValue(settings),
    getUserGoal: vi.fn().mockResolvedValue(goal),
    saveGoalSuggestion: vi.fn().mockResolvedValue(undefined),
    callLLM: vi.fn().mockResolvedValue(nudgeResponse),
    sendTabMessage: vi.fn().mockResolvedValue(undefined),
    openOptionsPage: vi.fn().mockResolvedValue(undefined),
    debugLog: vi.fn(),
    ...overrides
  }
  const runtime = createBackgroundRuntime(deps)

  return {
    deps,
    runtime,
    setNow: (next: number) => {
      now = next
    },
    advance: (deltaMs: number) => {
      now += deltaMs
    }
  }
}

describe("background runtime reliability", () => {
  it("drops stale LLM responses when the tab navigates before inference resolves", async () => {
    const firstInference = deferred<LLMResponse | null>()
    const secondInference = deferred<LLMResponse | null>()
    const callLLM = vi
      .fn()
      .mockReturnValueOnce(firstInference.promise)
      .mockReturnValueOnce(secondInference.promise)
    const { runtime, advance } = createRuntime({ callLLM })

    runtime.handlePageReady(7, {
      title: "Page A",
      meta: "A",
      url: "https://example.com/a"
    }, true)
    runtime.handleVisibilityChange(7, true)
    runtime.handleWindowFocusChange(7, true)

    advance(5_100)
    const firstPulse = runtime.handleRuntimePulse(7, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })
    await flushPromises()

    expect(callLLM).toHaveBeenCalledTimes(1)

    runtime.handlePageReady(7, {
      title: "Page B",
      meta: "B",
      url: "https://example.com/b"
    }, true)

    advance(5_100)
    const secondPulse = runtime.handleRuntimePulse(7, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })
    await flushPromises()

    expect(callLLM).toHaveBeenCalledTimes(2)

    firstInference.resolve(nudgeResponse)
    await firstPulse

    const stateAfterStale = runtime.getTabStateForTest(7)
    expect(stateAfterStale?.pageInfo.url).toBe("https://example.com/b")
    expect(stateAfterStale?.pendingIntervention).toBeNull()
    expect(stateAfterStale?.pendingRequest).toBe(true)
    expect(stateAfterStale?.pendingRequestId).not.toBeNull()

    secondInference.resolve({
      ...nudgeResponse,
      nudge_message: "B 页面提醒"
    })
    await secondPulse

    const finalState = runtime.getTabStateForTest(7)
    expect(finalState?.pendingIntervention?.message).toBe("B 页面提醒")
  })

  it("keeps pending intervention retryable when toast delivery fails", async () => {
    const sendTabMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("content script unavailable"))
      .mockResolvedValueOnce(undefined)
    const { runtime, advance } = createRuntime({ sendTabMessage })

    runtime.handlePageReady(9, {
      title: "Focus Trap",
      meta: "测试",
      url: "https://example.com/focus"
    }, true)
    runtime.handleVisibilityChange(9, true)
    runtime.handleWindowFocusChange(9, true)

    advance(5_100)
    await runtime.handleRuntimePulse(9, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })

    const failedState = runtime.getTabStateForTest(9)
    expect(sendTabMessage).toHaveBeenCalledTimes(1)
    expect(failedState?.pendingInterventionShown).toBe(false)
    expect(failedState?.cooldownUntil).toBe(0)
    expect(failedState?.pendingIntervention).toMatchObject({
      action: "nudge",
      message: "要不要回到当前任务？"
    })

    await runtime.handleTabActivated(9)

    const retriedState = runtime.getTabStateForTest(9)
    expect(sendTabMessage).toHaveBeenCalledTimes(2)
    expect(retriedState?.pendingInterventionShown).toBe(true)
    expect(retriedState?.cooldownUntil).toBeGreaterThan(0)
  })

  it("silently stores suggested goal in no-goal mode without showing a toast", async () => {
    const saveGoalSuggestion = vi.fn().mockResolvedValue(undefined)
    const sendTabMessage = vi.fn().mockResolvedValue(undefined)
    const { runtime, advance } = createRuntime({
      getUserGoal: vi.fn().mockResolvedValue(null),
      callLLM: vi.fn().mockResolvedValue({
        alignment_state: "uncertain",
        mode_hint: "explore",
        confidence: 0.74,
        nudge_message: null,
        icebreaker_message: null,
        suggested_goal: "学习 React Suspense"
      }),
      sendTabMessage,
      saveGoalSuggestion
    } as any)

    runtime.handlePageReady(12, {
      title: "React Suspense 文档",
      meta: "学习 React Suspense 的官方说明",
      url: "https://example.com/react-suspense"
    }, true)
    runtime.handleVisibilityChange(12, true)
    runtime.handleWindowFocusChange(12, true)

    advance(5_100)
    await runtime.handleRuntimePulse(12, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })

    expect(saveGoalSuggestion).toHaveBeenCalledWith("学习 React Suspense")
    expect(sendTabMessage).not.toHaveBeenCalled()
  })

  it("derives nudge locally from drifting alignment and candidate message", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined)
    const { runtime, advance } = createRuntime({ sendTabMessage })

    runtime.handlePageReady(13, {
      title: "Docs",
      meta: "AI 应用开发",
      url: "https://example.com/ai-dev"
    }, true)
    runtime.handleVisibilityChange(13, true)
    runtime.handleWindowFocusChange(13, true)

    advance(5_100)
    await runtime.handleRuntimePulse(13, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })

    expect(sendTabMessage).toHaveBeenCalledWith(13, {
      type: "SHOW_INTERVENTION",
      payload: expect.objectContaining({
        action: "nudge",
        message: "要不要回到当前任务？"
      })
    })
  })

  it("keeps on-track inference silent even when a candidate nudge message exists", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined)
    const { runtime, advance } = createRuntime({
      callLLM: vi.fn().mockResolvedValue({
        alignment_state: "on_track",
        mode_hint: "deep_dive",
        confidence: 0.92,
        nudge_message: "笔记在翻，思路别断",
        icebreaker_message: null
      }),
      sendTabMessage
    })

    runtime.handlePageReady(14, {
      title: "AI 开发 Skill",
      meta: "需求工程",
      url: "https://example.com/skill"
    }, true)
    runtime.handleVisibilityChange(14, true)
    runtime.handleWindowFocusChange(14, true)

    advance(5_100)
    await runtime.handleRuntimePulse(14, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })

    expect(sendTabMessage).not.toHaveBeenCalled()
    expect(runtime.getTabStateForTest(14)?.pendingIntervention).toBeNull()
  })

  it("derives no-goal icebreaker locally from off-track alignment", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined)
    const { runtime, advance } = createRuntime({
      getUserGoal: vi.fn().mockResolvedValue(null),
      callLLM: vi.fn().mockResolvedValue({
        alignment_state: "off_track",
        mode_hint: "feed",
        confidence: 0.81,
        nudge_message: null,
        icebreaker_message: "要不要先给现在的浏览定个小目标？"
      }),
      sendTabMessage
    })

    runtime.handlePageReady(15, {
      title: "Random Feed",
      meta: "信息流",
      url: "https://example.com/feed"
    }, true)
    runtime.handleVisibilityChange(15, true)
    runtime.handleWindowFocusChange(15, true)

    advance(5_100)
    await runtime.handleRuntimePulse(15, {
      isVisible: true,
      isFocused: true,
      hasMedia: false,
      interactionLevel: "low",
      scrollLevel: "low"
    })

    expect(sendTabMessage).toHaveBeenCalledWith(15, {
      type: "SHOW_INTERVENTION",
      payload: expect.objectContaining({
        action: "icebreaker",
        message: "要不要先给现在的浏览定个小目标？"
      })
    })
  })

  it("logs state transitions and checkpoint decisions for debugging", async () => {
    const { deps, runtime, advance } = createRuntime()

    runtime.handlePageReady(11, {
      title: "LLM Training",
      meta: "AI 学习视频",
      url: "https://youtube.com/watch?v=training"
    }, true)
    runtime.handleVisibilityChange(11, true)
    runtime.handleWindowFocusChange(11, true)

    advance(5_100)
    await runtime.handleRuntimePulse(11, {
      isVisible: true,
      isFocused: true,
      hasMedia: true,
      interactionLevel: "medium",
      scrollLevel: "high"
    })

    expect(deps.debugLog).toHaveBeenCalledWith(
      "STATE",
      expect.stringContaining("[11] isVisible: false → true"),
      expect.objectContaining({
        field: "isVisible",
        from: false,
        to: true
      })
    )
    expect(deps.debugLog).toHaveBeenCalledWith(
      "STATE",
      expect.stringContaining("[11] interactionLevel: low → medium"),
      expect.objectContaining({
        field: "interactionLevel",
        from: "low",
        to: "medium"
      })
    )
    expect(deps.debugLog).toHaveBeenCalledWith(
      "CHECKPOINT",
      expect.stringContaining("[11] page_checkpoint 条件通过"),
      expect.objectContaining({
        triggerReason: "page_checkpoint",
        isVisible: true,
        isFocused: true,
        idleState: "active"
      })
    )
  })

  it("does not schedule page checkpoints for pages that are not evaluation ready", async () => {
    const { runtime } = createRuntime()

    runtime.handlePageReady(16, {
      title: "ChatGPT",
      meta: "",
      url: "https://chatgpt.com/",
      adapter_id: "chatgpt",
      evaluation_readiness: "not_ready",
      evaluation_ready: false,
      quality_reason: "empty_conversation"
    }, true)

    const state = runtime.getTabStateForTest(16)

    expect(state?.pageCheckpointEligibleAt).toBeNull()
  })

  it("skips page and dwell inference for low info pages", async () => {
    const callLLM = vi.fn().mockResolvedValue(nudgeResponse)
    const { deps, runtime, advance } = createRuntime({ callLLM })

    runtime.handlePageReady(17, {
      title: "React 状态管理 - ChatGPT",
      meta: "",
      url: "https://chatgpt.com/c/abc",
      adapter_id: "chatgpt",
      evaluation_readiness: "low_info",
      evaluation_ready: false,
      quality_reason: "missing_conversation_excerpt"
    }, true)
    runtime.handleVisibilityChange(17, true)
    runtime.handleWindowFocusChange(17, true)

    for (let index = 0; index < 7; index += 1) {
      advance(10_000)
      await runtime.handleRuntimePulse(17, {
        isVisible: true,
        isFocused: true,
        hasMedia: false,
        interactionLevel: "low",
        scrollLevel: "low"
      })
    }

    expect(callLLM).not.toHaveBeenCalled()
    expect(deps.debugLog).toHaveBeenCalledWith(
      "CHECKPOINT",
      expect.stringContaining("跳过 dwell_checkpoint：页面信息低质量"),
      expect.objectContaining({
        adapterId: "chatgpt",
        readiness: "low_info",
        reason: "missing_conversation_excerpt"
      })
    )
  })
})
