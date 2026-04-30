import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DebugState } from "./storage"
import type { Settings } from "./types"

type StorageLocalMock = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

function installChromeStorageMock(): StorageLocalMock {
  const get = vi.fn()
  const set = vi.fn()
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get,
        set
      }
    }
  })
  return { get, set }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("storage helpers", () => {
  it("reads and writes settings from chrome.storage.local", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")

    const settings: Settings = {
      enabled: true,
      apiKey: "k",
      apiUrl: "u",
      model: "m",
      debugMode: false
    }
    storageLocal.get.mockResolvedValueOnce({ settings }).mockResolvedValueOnce({})

    await expect(storage.getSettings()).resolves.toEqual(settings)
    await expect(storage.getSettings()).resolves.toBeNull()

    await storage.saveSettings(settings)
    expect(storageLocal.set).toHaveBeenCalledWith({ settings })
  })

  it("reads and writes user goal with timestamp", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_716_000_000_000)

    storageLocal.get.mockResolvedValueOnce({
      userGoal: { goal: "写测试", updatedAt: 123 }
    }).mockResolvedValueOnce({})

    await expect(storage.getUserGoal()).resolves.toEqual({
      goal: "写测试",
      updatedAt: 123
    })
    await expect(storage.getUserGoal()).resolves.toBeNull()

    await storage.saveUserGoal("补齐回归测试")
    expect(storageLocal.set).toHaveBeenCalledWith({
      userGoal: {
        goal: "补齐回归测试",
        updatedAt: 1_716_000_000_000
      }
    })

    nowSpy.mockRestore()
  })

  it("reads, writes, and clears suggested goal draft", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_716_000_000_100)

    storageLocal.get.mockResolvedValueOnce({
      goalSuggestion: { goal: "学习 React Suspense", updatedAt: 456 }
    }).mockResolvedValueOnce({})

    const getGoalSuggestion =
      (storage as any).getGoalSuggestion ?? (() => Promise.resolve(undefined))
    const saveGoalSuggestion =
      (storage as any).saveGoalSuggestion ?? (() => Promise.resolve(undefined))
    const clearGoalSuggestion =
      (storage as any).clearGoalSuggestion ?? (() => Promise.resolve(undefined))

    await expect(getGoalSuggestion()).resolves.toEqual({
      goal: "学习 React Suspense",
      updatedAt: 456
    })
    await expect(getGoalSuggestion()).resolves.toBeNull()

    await saveGoalSuggestion("梳理 MVP 状态流")
    expect(storageLocal.set).toHaveBeenCalledWith({
      goalSuggestion: {
        goal: "梳理 MVP 状态流",
        updatedAt: 1_716_000_000_100
      }
    })

    await clearGoalSuggestion()
    expect(storageLocal.set).toHaveBeenCalledWith({ goalSuggestion: null })

    nowSpy.mockRestore()
  })

  it("toggles debug mode and prints logs only when enabled", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    storageLocal.get.mockResolvedValueOnce({
      settings: { debugMode: false }
    })
    await expect(storage.loadDebugMode()).resolves.toBe(false)
    storage.debugLog("TAG", "first")
    expect(logSpy).not.toHaveBeenCalled()

    storageLocal.get.mockResolvedValueOnce({
      settings: { debugMode: true }
    })
    await expect(storage.loadDebugMode()).resolves.toBe(true)
    expect(storage.isDebugMode()).toBe(true)

    storage.debugLog("TAG", "second", 2)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[AttentionNudge\]\[.+\]\[TAG\]$/),
      "second",
      2
    )
  })

  it("logs debug snapshot only in debug mode and truncates meta to 80 chars", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    storageLocal.get.mockResolvedValueOnce({
      settings: { debugMode: false }
    })
    await storage.loadDebugMode()

    const state: DebugState = {
      state: "active",
      pageInfo: {
        title: "文档页",
        url: "https://example.com/docs",
        meta: "x".repeat(120)
      },
      userGoal: "补测试",
      isPageVisible: true,
      accumulatedTime: 23
    }

    await storage.logDebugState(state)
    expect(logSpy).not.toHaveBeenCalled()

    storageLocal.get.mockResolvedValueOnce({
      settings: { debugMode: true }
    })
    await storage.loadDebugMode()
    await storage.logDebugState(state)

    expect(logSpy).toHaveBeenCalledTimes(1)
    const [, , payload] = logSpy.mock.calls[0]
    expect(payload.meta.length).toBe(80)
    expect(payload.page).toContain("文档页")
    expect(payload.page).toContain("https://example.com/docs")
  })

  it("persists timestamped debug log entries only when debug mode is enabled", async () => {
    const storageLocal = installChromeStorageMock()
    const storage = await import("./storage")
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_716_000_000_000)
    const existingLogs = Array.from({ length: 200 }, (_, index) => ({
      id: `old-${index}`,
      timestamp: `2024-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      epoch_ms: index,
      tag: "OLD",
      event: "entry",
      payload: { index }
    }))

    storageLocal.get.mockResolvedValueOnce({
      settings: { debugMode: false }
    })
    await storage.loadDebugMode()
    await storage.appendDebugLog({
      tag: "LLM_CHAT",
      event: "request",
      payload: { message: "hidden while disabled" }
    })
    expect(storageLocal.set).not.toHaveBeenCalled()

    storageLocal.get
      .mockResolvedValueOnce({
        settings: { debugMode: true }
      })
      .mockResolvedValueOnce({
        [storage.DEBUG_LOG_STORAGE_KEY]: existingLogs
      })
    await storage.loadDebugMode()
    await storage.appendDebugLog({
      tag: "STATE",
      event: "transition",
      payload: {
        field: "isVisible",
        from: false,
        to: true
      }
    })

    expect(storageLocal.set).toHaveBeenCalledTimes(1)
    const savedLogs = storageLocal.set.mock.calls[0][0][storage.DEBUG_LOG_STORAGE_KEY]
    expect(savedLogs).toHaveLength(200)
    expect(savedLogs[0].id).toBe("old-1")
    expect(savedLogs[199]).toMatchObject({
      timestamp: "2024-05-18T02:40:00.000Z",
      epoch_ms: 1_716_000_000_000,
      tag: "STATE",
      event: "transition",
      payload: {
        field: "isVisible",
        from: false,
        to: true
      }
    })
    expect(savedLogs[199].id).toMatch(/^debug-/)

    nowSpy.mockRestore()
  })
})
