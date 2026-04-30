import type { Settings, UserGoal, GoalSuggestion, AttentionState } from "./types"

export const DEBUG_LOG_STORAGE_KEY = "attentionNudgeDebugLogs"
const DEBUG_LOG_LIMIT = 200
const MAX_DEBUG_STRING_LENGTH = 20_000

export interface DebugLogEntry {
  id: string
  timestamp: string
  epoch_ms: number
  tag: string
  event: string
  payload?: unknown
}

type DebugLogInput = Omit<DebugLogEntry, "id" | "timestamp" | "epoch_ms">
type AppendDebugLogOptions = {
  force?: boolean
}

export async function getSettings(): Promise<Settings | null> {
  const result = await chrome.storage.local.get(["settings"])
  return result.settings || null
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings })
}

export async function getUserGoal(): Promise<UserGoal | null> {
  const result = await chrome.storage.local.get(["userGoal"])
  return result.userGoal || null
}

export async function saveUserGoal(goal: string): Promise<void> {
  await chrome.storage.local.set({
    userGoal: {
      goal,
      updatedAt: Date.now()
    }
  })
}

export async function getGoalSuggestion(): Promise<GoalSuggestion | null> {
  const result = await chrome.storage.local.get(["goalSuggestion"])
  return result.goalSuggestion || null
}

export async function saveGoalSuggestion(goal: string): Promise<void> {
  const trimmedGoal = goal.trim()
  if (!trimmedGoal) {
    await clearGoalSuggestion()
    return
  }

  await chrome.storage.local.set({
    goalSuggestion: {
      goal: trimmedGoal,
      updatedAt: Date.now()
    }
  })
}

export async function clearGoalSuggestion(): Promise<void> {
  await chrome.storage.local.set({ goalSuggestion: null })
}

// Debug mode globals (shared via chrome.storage for simplicity)
let _debugMode = false

export async function loadDebugMode(): Promise<boolean> {
  const s = await getSettings()
  _debugMode = s?.debugMode ?? false
  return _debugMode
}

export function isDebugMode(): boolean {
  return _debugMode
}

function normalizeForDebugStorage(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null) return null
  if (value === undefined) return null

  if (typeof value === "string") {
    return value.length > MAX_DEBUG_STRING_LENGTH
      ? `${value.slice(0, MAX_DEBUG_STRING_LENGTH)}…[truncated]`
      : value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value)
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }

  if (depth > 6) {
    return "[MaxDepth]"
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]"
    }
    seen.add(value)

    if (Array.isArray(value)) {
      return value.map((item) => normalizeForDebugStorage(item, seen, depth + 1))
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeForDebugStorage(item, seen, depth + 1)
      ])
    )
  }

  return String(value)
}

export async function appendDebugLog(input: DebugLogInput, options: AppendDebugLogOptions = {}): Promise<void> {
  if (!_debugMode && !options.force) return
  if (typeof chrome === "undefined" || !chrome.storage?.local) return

  const epochMs = Date.now()
  const entry: DebugLogEntry = {
    id: `debug-${epochMs}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(epochMs).toISOString(),
    epoch_ms: epochMs,
    tag: input.tag,
    event: input.event,
    payload: normalizeForDebugStorage(input.payload)
  }

  const result = await chrome.storage.local.get([DEBUG_LOG_STORAGE_KEY])
  const existing = Array.isArray(result?.[DEBUG_LOG_STORAGE_KEY])
    ? result[DEBUG_LOG_STORAGE_KEY] as DebugLogEntry[]
    : []

  await chrome.storage.local.set({
    [DEBUG_LOG_STORAGE_KEY]: [...existing, entry].slice(-DEBUG_LOG_LIMIT)
  })
}

export function debugLog(tag: string, ...args: unknown[]) {
  if (_debugMode) {
    const epochMs = Date.now()
    const timestamp = new Date(epochMs).toISOString()
    console.log(`[AttentionNudge][${timestamp}][${tag}]`, ...args)
    appendDebugLog({
      tag,
      event: "console",
      payload: { args }
    }).catch(() => {})
  }
}

export interface DebugState {
  state: AttentionState
  pageInfo: { title: string; url: string; meta: string }
  userGoal: string
  isPageVisible: boolean
  accumulatedTime: number
}

export async function logDebugState(state: DebugState) {
  if (!_debugMode) return
  console.log(`%c[AttentionNudge] State Snapshot`, "color: #8b5cf6; font-weight: bold", {
    attentionState: state.state,
    page: `${state.pageInfo.title} (${state.pageInfo.url})`,
    meta: state.pageInfo.meta.slice(0, 80),
    userGoal: state.userGoal,
    pageVisible: state.isPageVisible,
    accumulatedTime: `${state.accumulatedTime}s`
  })
}
