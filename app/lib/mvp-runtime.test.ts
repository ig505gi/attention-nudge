import { describe, expect, it } from "vitest"
import {
  DWELL_CHECKPOINT_INTERVAL_SECONDS,
  PAGE_CHECKPOINT_DELAY_MS,
  getIcebreakerButtonOptions,
  getNudgeButtonOptions,
  shouldTriggerDwellCheckpoint,
  shouldTriggerPageCheckpoint
} from "./mvp-runtime"

describe("mvp runtime checkpoints", () => {
  it("fires page checkpoint only after page is stable and visible", () => {
    const now = 10_000

    expect(
      shouldTriggerPageCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        pageCheckpointEligibleAt: now + PAGE_CHECKPOINT_DELAY_MS
      }, now)
    ).toBe(false)

    expect(
      shouldTriggerPageCheckpoint({
        isVisible: false,
        isFocused: true,
        idleState: "active",
        pageCheckpointEligibleAt: now
      }, now)
    ).toBe(false)

    expect(
      shouldTriggerPageCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        pageCheckpointEligibleAt: now
      }, now)
    ).toBe(true)
  })

  it("fires dwell checkpoint only after active dwell hits the 60s boundary", () => {
    expect(
      shouldTriggerDwellCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        activeDwellSeconds: DWELL_CHECKPOINT_INTERVAL_SECONDS - 1,
        lastTriggeredDwellBoundary: 0
      })
    ).toBe(false)

    expect(
      shouldTriggerDwellCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        activeDwellSeconds: DWELL_CHECKPOINT_INTERVAL_SECONDS,
        lastTriggeredDwellBoundary: 0
      })
    ).toBe(true)

    expect(
      shouldTriggerDwellCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "idle",
        activeDwellSeconds: DWELL_CHECKPOINT_INTERVAL_SECONDS,
        lastTriggeredDwellBoundary: 0
      })
    ).toBe(false)
  })

  it("fires dwell checkpoint again when active dwell reaches the next 60s boundary", () => {
    expect(
      shouldTriggerDwellCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        activeDwellSeconds: DWELL_CHECKPOINT_INTERVAL_SECONDS * 2,
        lastTriggeredDwellBoundary: DWELL_CHECKPOINT_INTERVAL_SECONDS
      })
    ).toBe(true)

    expect(
      shouldTriggerDwellCheckpoint({
        isVisible: true,
        isFocused: true,
        idleState: "active",
        activeDwellSeconds: DWELL_CHECKPOINT_INTERVAL_SECONDS * 2,
        lastTriggeredDwellBoundary: DWELL_CHECKPOINT_INTERVAL_SECONDS * 2
      })
    ).toBe(false)
  })
})

describe("mvp runtime intervention buttons", () => {
  it("uses deterministic no-goal icebreaker buttons", () => {
    expect(getIcebreakerButtonOptions(true)).toEqual(["现在设一个", "暂时先不用"])
  })

  it("uses deterministic nudge buttons", () => {
    expect(getNudgeButtonOptions()).toEqual(["回到主线", "稍后再说"])
  })
})
