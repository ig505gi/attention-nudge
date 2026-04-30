import type { IdleState } from "./types"

export const PAGE_CHECKPOINT_DELAY_MS = 5_000
export const DWELL_CHECKPOINT_INTERVAL_SECONDS = 60

type PageCheckpointInput = {
  isVisible: boolean
  isFocused: boolean
  idleState: IdleState
  pageCheckpointEligibleAt: number | null
}

type DwellCheckpointInput = {
  isVisible: boolean
  isFocused: boolean
  idleState: IdleState
  activeDwellSeconds: number
  lastTriggeredDwellBoundary: number
}

export function shouldTriggerPageCheckpoint(input: PageCheckpointInput, now: number): boolean {
  return Boolean(
    input.isVisible &&
      input.isFocused &&
      input.idleState === "active" &&
      input.pageCheckpointEligibleAt !== null &&
      now >= input.pageCheckpointEligibleAt
  )
}

export function shouldTriggerDwellCheckpoint(input: DwellCheckpointInput): boolean {
  if (!input.isVisible || !input.isFocused || input.idleState !== "active") {
    return false
  }

  const currentBoundary =
    Math.floor(input.activeDwellSeconds / DWELL_CHECKPOINT_INTERVAL_SECONDS) *
    DWELL_CHECKPOINT_INTERVAL_SECONDS

  return (
    currentBoundary >= DWELL_CHECKPOINT_INTERVAL_SECONDS &&
    currentBoundary > input.lastTriggeredDwellBoundary
  )
}

export function getNudgeButtonOptions(): [string, string] {
  return ["回到主线", "稍后再说"]
}

export function getIcebreakerButtonOptions(isNoGoalMode: boolean): [string, string] {
  if (isNoGoalMode) {
    return ["现在设一个", "暂时先不用"]
  }

  return ["回到主线", "先缓一下"]
}
