import type { Settings, UserGoal, AttentionState } from "./types"

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

export function debugLog(tag: string, ...args: unknown[]) {
  if (_debugMode) {
    console.log(`[AttentionNudge][${tag}]`, ...args)
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
