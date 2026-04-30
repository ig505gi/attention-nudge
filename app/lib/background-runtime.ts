import {
  getIcebreakerButtonOptions,
  getNudgeButtonOptions,
  PAGE_CHECKPOINT_DELAY_MS,
  shouldTriggerDwellCheckpoint,
  shouldTriggerPageCheckpoint
} from "./mvp-runtime"
import type {
  BehaviorSummary,
  BrowserContext,
  DisplayInterventionAction,
  LLMRequest,
  LLMResponse,
  PageInfo,
  RecentPageSummary,
  RuntimeIntervention,
  Settings,
  TabState,
  TriggerReason,
  UserGoal
} from "./types"

export const INTERVENTION_COOLDOWN_MS = 10 * 60_000
export const INTERVENTION_MIN_CONFIDENCE = 0.6
export const PULSE_DELTA_CAP_MS = 10_000
const DEFAULT_NUDGE_MESSAGE = "要不要回到当前任务？"
const DEFAULT_ICEBREAKER_MESSAGE = "要不要先给现在的浏览定个小目标？"

type RuntimePulsePayload = {
  isVisible?: boolean
  isFocused?: boolean
  hasMedia?: boolean
  interactionLevel?: BehaviorSummary["interaction_level"]
  scrollLevel?: BehaviorSummary["scroll_level"]
}

type BackgroundRuntimeDeps = {
  now: () => number
  getSettings: () => Promise<Settings | null>
  getUserGoal: () => Promise<UserGoal | null>
  saveGoalSuggestion: (goal: string) => Promise<void>
  callLLM: (settings: Settings, request: LLMRequest) => Promise<LLMResponse | null>
  sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>
  openOptionsPage: () => Promise<unknown> | unknown
  debugLog?: (tag: string, ...args: unknown[]) => void
}

function createTabState(pageInfo: PageInfo, now: number): TabState {
  return {
    pageInfo,
    pageEnteredAt: now,
    pageCheckpointEligibleAt: now + PAGE_CHECKPOINT_DELAY_MS,
    lastTriggeredDwellBoundary: 0,
    activeDwellSeconds: 0,
    lastPulseAt: now,
    lastActivityAt: now,
    lastScrollAt: now,
    interactionLevel: "low",
    scrollLevel: "low",
    isVisible: false,
    isFocused: false,
    idleState: "active",
    hasMedia: false,
    recentPages: [],
    cooldownUntil: 0,
    pendingIntervention: null,
    pendingInterventionShown: false,
    pendingInterventionGoalMissing: false,
    pendingRequest: false,
    pendingRequestId: null
  }
}

function buildPageInfo(payload: Partial<PageInfo>, now: number): PageInfo {
  return {
    title: payload.title ?? "",
    meta: payload.meta ?? "",
    url: payload.url ?? "",
    excerpt: payload.excerpt ?? "",
    timestamp: now
  }
}

function appendRecentPage(state: TabState, now: number) {
  if (!state.pageInfo.url) return

  const previousPage: RecentPageSummary = {
    title: state.pageInfo.title,
    url: state.pageInfo.url,
    dwell_seconds: Math.max(1, Math.floor((now - state.pageEnteredAt) / 1000))
  }

  state.recentPages = [...state.recentPages, previousPage].slice(-3)
}

function resetForNewPage(state: TabState, pageInfo: PageInfo, now: number) {
  if (state.pageInfo.url && state.pageInfo.url !== pageInfo.url) {
    appendRecentPage(state, now)
  }

  state.pageInfo = pageInfo
  state.pageEnteredAt = now
  state.pageCheckpointEligibleAt = now + PAGE_CHECKPOINT_DELAY_MS
  state.lastTriggeredDwellBoundary = 0
  state.activeDwellSeconds = 0
  state.lastPulseAt = now
  state.lastActivityAt = now
  state.lastScrollAt = now
  state.interactionLevel = "low"
  state.scrollLevel = "low"
  state.pendingIntervention = null
  state.pendingInterventionShown = false
  state.pendingInterventionGoalMissing = false
  state.pendingRequest = false
  state.pendingRequestId = null
}

function buildRequest(triggerReason: TriggerReason, state: TabState, goal: string | null, now: number): LLMRequest {
  return {
    trigger_reason: triggerReason,
    goal,
    current_page: {
      title: state.pageInfo.title,
      meta: state.pageInfo.meta,
      url: state.pageInfo.url,
      excerpt: state.pageInfo.excerpt
    },
    browser_context: {
      is_visible: state.isVisible,
      is_focused: state.isFocused,
      idle_state: state.idleState,
      has_media: state.hasMedia
    },
    behavior_summary: {
      dwell_seconds: Math.max(1, Math.floor((now - state.pageEnteredAt) / 1000)),
      active_dwell_seconds: Math.max(0, Math.floor(state.activeDwellSeconds)),
      interaction_level: state.interactionLevel,
      scroll_level: state.scrollLevel
    },
    recent_pages: state.recentPages
  }
}

function getInterventionButtons(action: DisplayInterventionAction, isNoGoalMode: boolean): [string, string] | undefined {
  if (action === "icebreaker") {
    return getIcebreakerButtonOptions(isNoGoalMode)
  }

  if (action === "nudge") {
    return getNudgeButtonOptions()
  }

  return undefined
}

function normalizeInterventionMessage(message: string | null | undefined, fallback: string): string {
  const trimmed = message?.trim()
  return trimmed || fallback
}

function deriveIntervention(response: LLMResponse, hasGoal: boolean): RuntimeIntervention | null {
  if (response.confidence < INTERVENTION_MIN_CONFIDENCE) {
    return null
  }

  if (hasGoal && (response.alignment_state === "drifting" || response.alignment_state === "off_track")) {
    return {
      ...response,
      action: "nudge",
      message: normalizeInterventionMessage(response.nudge_message, DEFAULT_NUDGE_MESSAGE)
    }
  }

  if (!hasGoal && response.alignment_state === "off_track") {
    return {
      ...response,
      action: "icebreaker",
      message: normalizeInterventionMessage(response.icebreaker_message, DEFAULT_ICEBREAKER_MESSAGE)
    }
  }

  return null
}

export function createBackgroundRuntime(deps: BackgroundRuntimeDeps) {
  const tabStates = new Map<number, TabState>()
  let requestSeq = 0
  let activeTabId: number | null = null

  const debugLog = (tag: string, ...args: unknown[]) => {
    deps.debugLog?.(tag, ...args)
  }

  const logStateTransition = (
    tabId: number,
    field: string,
    from: unknown,
    to: unknown
  ) => {
    if (Object.is(from, to)) return

    debugLog("STATE", `🔁 [${tabId}] ${field}: ${String(from)} → ${String(to)}`, {
      field,
      from,
      to
    })
  }

  const getOrCreateTabState = (tabId: number, pageInfo: PageInfo, now: number): TabState => {
    const existing = tabStates.get(tabId)
    if (existing) return existing

    const state = createTabState(pageInfo, now)
    tabStates.set(tabId, state)
    return state
  }

  const maybeShowIntervention = async (
    tabId: number,
    response: RuntimeIntervention,
    isNoGoalMode: boolean
  ): Promise<boolean> => {
    const state = tabStates.get(tabId)
    if (!state) return false

    if (response.confidence < INTERVENTION_MIN_CONFIDENCE) {
      debugLog("INTERVENTION", `🟢 [${tabId}] 低置信降级为 silent (${response.confidence})`)
      return false
    }

    if (deps.now() < state.cooldownUntil) {
      debugLog("INTERVENTION", `⏳ [${tabId}] 命中冷却，跳过页面内提醒`)
      return false
    }

    const buttonOptions = getInterventionButtons(response.action, isNoGoalMode)

    debugLog("INTERVENTION", `🟡 [${tabId}] 展示 ${response.action} (${response.alignment_state}/${response.mode_hint})`)
    debugLog("INTERVENTION", `   "${response.message}"`)

    try {
      await deps.sendTabMessage(tabId, {
        type: "SHOW_INTERVENTION",
        payload: {
          message: response.message,
          action: response.action,
          button_options: buttonOptions
        }
      })
      state.cooldownUntil = deps.now() + INTERVENTION_COOLDOWN_MS
      state.pendingInterventionShown = true
      return true
    } catch (error) {
      debugLog("INTERVENTION", `⚠️ [${tabId}] 页面内提醒投递失败，等待重试`, error)
      return false
    }
  }

  const runInference = async (tabId: number, triggerReason: TriggerReason, now: number) => {
    const state = tabStates.get(tabId)
    if (!state || state.pendingRequest || !state.pageInfo.url) {
      return
    }

    const settings = await deps.getSettings()
    if (!settings?.enabled || !settings.apiKey || !settings.apiUrl) {
      debugLog("LLM", `⏸️ [${tabId}] 跳过 ${triggerReason}：缺少设置或服务关闭`)
      return
    }

    const goalEntry = await deps.getUserGoal()
    const goal = goalEntry?.goal?.trim() || null
    const request = buildRequest(triggerReason, state, goal, now)
    const seq = ++requestSeq
    const requestPageUrl = state.pageInfo.url
    const requestPageEnteredAt = state.pageEnteredAt

    state.pendingRequest = true
    state.pendingRequestId = seq

    debugLog("LLM", `📤 [${tabId}] 触发 ${triggerReason}`)
    debugLog("LLM", {
      goal: goal ?? "(未设置)",
      page: request.current_page.title,
      dwell: request.behavior_summary.dwell_seconds,
      activeDwell: request.behavior_summary.active_dwell_seconds,
      interaction: request.behavior_summary.interaction_level,
      scroll: request.behavior_summary.scroll_level
    })

    try {
      const response = await deps.callLLM(settings, request)
      const latestState = tabStates.get(tabId)
      if (!latestState) return

      if (latestState.pendingRequestId === seq) {
        latestState.pendingRequest = false
        latestState.pendingRequestId = null
      }

      const isStale =
        latestState.pageInfo.url !== requestPageUrl ||
        latestState.pageEnteredAt !== requestPageEnteredAt

      if (isStale) {
        debugLog("LLM", `🕘 [${tabId}] 丢弃过期 ${triggerReason} 响应`, {
          requestPageUrl,
          currentPageUrl: latestState.pageInfo.url
        })
        return
      }

      if (!response) {
        debugLog("LLM", `❌ [${tabId}] ${triggerReason} 返回 null`)
        return
      }

      const suggestedGoal = response.suggested_goal?.trim()
      if (!goal && suggestedGoal) {
        try {
          await deps.saveGoalSuggestion(suggestedGoal)
          debugLog("LLM", `📝 [${tabId}] 保存目标草稿`, { suggestedGoal })
        } catch (error) {
          debugLog("LLM", `⚠️ [${tabId}] 保存目标草稿失败`, error)
        }
      }

      const intervention = deriveIntervention(response, !!goal)

      latestState.pendingIntervention = intervention
      latestState.pendingInterventionShown = false
      latestState.pendingInterventionGoalMissing = !goal

      debugLog("LLM", `📥 [${tabId}] seq=${seq}`, response)

      if (!intervention) {
        debugLog("INTERVENTION", `🟢 [${tabId}] 静默记录 (${response.alignment_state}/${response.mode_hint})`, {
          confidence: response.confidence,
          hasGoal: !!goal
        })
        return
      }

      if (tabId === activeTabId) {
        await maybeShowIntervention(tabId, intervention, !goal)
      }
    } catch (error) {
      const latestState = tabStates.get(tabId)
      if (latestState?.pendingRequestId === seq) {
        latestState.pendingRequest = false
        latestState.pendingRequestId = null
      }
      debugLog("LLM", `❌ [${tabId}] ${triggerReason} 调用异常`, error)
    }
  }

  const maybeRunPageCheckpoint = async (tabId: number, now: number) => {
    const state = tabStates.get(tabId)
    if (!state) return

    if (shouldTriggerPageCheckpoint({
      isVisible: state.isVisible,
      isFocused: state.isFocused,
      idleState: state.idleState,
      pageCheckpointEligibleAt: state.pageCheckpointEligibleAt
    }, now)) {
      debugLog("CHECKPOINT", `✅ [${tabId}] page_checkpoint 条件通过`, {
        triggerReason: "page_checkpoint",
        isVisible: state.isVisible,
        isFocused: state.isFocused,
        idleState: state.idleState,
        pageCheckpointEligibleAt: state.pageCheckpointEligibleAt,
        now
      })
      state.pageCheckpointEligibleAt = null
      await runInference(tabId, "page_checkpoint", now)
    }
  }

  const maybeRunDwellCheckpoint = async (tabId: number, now: number) => {
    const state = tabStates.get(tabId)
    if (!state) return

    if (shouldTriggerDwellCheckpoint({
      isVisible: state.isVisible,
      isFocused: state.isFocused,
      idleState: state.idleState,
      activeDwellSeconds: state.activeDwellSeconds,
      lastTriggeredDwellBoundary: state.lastTriggeredDwellBoundary
    })) {
      debugLog("CHECKPOINT", `✅ [${tabId}] dwell_checkpoint 条件通过`, {
        triggerReason: "dwell_checkpoint",
        isVisible: state.isVisible,
        isFocused: state.isFocused,
        idleState: state.idleState,
        activeDwellSeconds: state.activeDwellSeconds,
        lastTriggeredDwellBoundary: state.lastTriggeredDwellBoundary
      })
      state.lastTriggeredDwellBoundary =
        Math.floor(state.activeDwellSeconds / 60) * 60
      await runInference(tabId, "dwell_checkpoint", now)
    }
  }

  return {
    getTabStateForTest(tabId: number) {
      return tabStates.get(tabId)
    },
    handlePageReady(tabId: number, payload: Partial<PageInfo>, tabActive = false) {
      const now = deps.now()
      const pageInfo = buildPageInfo(payload, now)
      const state = getOrCreateTabState(tabId, pageInfo, now)
      resetForNewPage(state, pageInfo, now)

      if (tabActive) {
        activeTabId = tabId
      }

      debugLog("PERCEPTION", `📄 [${tabId}] 内容就绪: ${pageInfo.title}`)
      debugLog("PERCEPTION", `   URL: ${pageInfo.url}`)
      debugLog("PERCEPTION", `   Meta: ${pageInfo.meta.slice(0, 80)}...`)
    },
    handleVisibilityChange(tabId: number, visible: boolean) {
      const state = tabStates.get(tabId)
      if (state) {
        const previous = state.isVisible
        state.isVisible = visible
        logStateTransition(tabId, "isVisible", previous, state.isVisible)
      }
    },
    handleWindowFocusChange(tabId: number, focused: boolean) {
      const state = tabStates.get(tabId)
      if (state) {
        const previous = state.isFocused
        state.isFocused = focused
        logStateTransition(tabId, "isFocused", previous, state.isFocused)
      }
    },
    async handleRuntimePulse(tabId: number, payload: RuntimePulsePayload) {
      const state = tabStates.get(tabId)
      if (!state) return

      const now = deps.now()
      const deltaSeconds = Math.min(PULSE_DELTA_CAP_MS, Math.max(0, now - state.lastPulseAt)) / 1000
      const previous = {
        isVisible: state.isVisible,
        isFocused: state.isFocused,
        hasMedia: state.hasMedia,
        interactionLevel: state.interactionLevel,
        scrollLevel: state.scrollLevel
      }
      state.lastPulseAt = now
      state.isVisible = !!payload.isVisible
      state.isFocused = !!payload.isFocused
      state.hasMedia = !!payload.hasMedia
      state.interactionLevel = payload.interactionLevel ?? "low"
      state.scrollLevel = payload.scrollLevel ?? "low"

      logStateTransition(tabId, "isVisible", previous.isVisible, state.isVisible)
      logStateTransition(tabId, "isFocused", previous.isFocused, state.isFocused)
      logStateTransition(tabId, "hasMedia", previous.hasMedia, state.hasMedia)
      logStateTransition(tabId, "interactionLevel", previous.interactionLevel, state.interactionLevel)
      logStateTransition(tabId, "scrollLevel", previous.scrollLevel, state.scrollLevel)

      if (state.interactionLevel !== "low") {
        state.lastActivityAt = now
      }
      if (state.scrollLevel !== "low") {
        state.lastScrollAt = now
      }

      if (state.isVisible && state.isFocused && state.idleState === "active") {
        state.activeDwellSeconds += deltaSeconds
      }

      await maybeRunPageCheckpoint(tabId, now)
      await maybeRunDwellCheckpoint(tabId, now)
    },
    async handleInterventionChoice(tabId: number, choice: "primary" | "secondary") {
      const state = tabStates.get(tabId)
      if (!state?.pendingIntervention) {
        return
      }

      const response = state.pendingIntervention
      const isNoGoalMode = state.pendingInterventionGoalMissing

      debugLog("INTERVENTION", `🧭 [${tabId}] 用户点击 ${choice}`, {
        action: response.action,
        isNoGoalMode
      })

      if (response.action === "icebreaker" && isNoGoalMode && choice === "primary") {
        await deps.openOptionsPage()
      }

      state.pendingIntervention = null
      state.pendingInterventionShown = false
    },
    async handleTabActivated(tabId: number) {
      const prevTab = activeTabId
      activeTabId = tabId

      debugLog("TAB", `🔄 Tab 切换: ${prevTab ?? "none"} → ${activeTabId}`)

      if (prevTab && prevTab !== tabId) {
        deps.sendTabMessage(prevTab, { type: "HIDE_INTERVENTION" }).catch(() => {})
      }

      const state = tabStates.get(tabId)
      if (state?.pendingIntervention && !state.pendingInterventionShown) {
        await maybeShowIntervention(tabId, state.pendingIntervention, state.pendingInterventionGoalMissing)
      }
    },
    handleTabRemoved(tabId: number) {
      debugLog("TAB", `🗑️ [${tabId}] Tab 已关闭`)
      tabStates.delete(tabId)
    },
    handleIdleStateChanged(idleState: BrowserContext["idle_state"]) {
      debugLog("IDLE", `系统 idle: ${idleState}`)
      tabStates.forEach((state, tabId) => {
        const previous = state.idleState
        state.idleState = idleState
        logStateTransition(tabId, "idleState", previous, state.idleState)
      })
    }
  }
}
