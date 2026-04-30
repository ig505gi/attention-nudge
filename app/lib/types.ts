export interface Settings {
  enabled: boolean
  apiKey: string
  apiUrl: string
  model: string
  debugMode: boolean
}

export interface UserGoal {
  goal: string
  updatedAt: number
}

export interface GoalSuggestion {
  goal: string
  updatedAt: number
}

export type PageEvaluationReadiness = "ready" | "not_ready" | "low_info"

export interface PageInfo {
  title: string
  meta: string
  url: string
  excerpt?: string
  timestamp: number
  adapter_id?: string
  evaluation_readiness?: PageEvaluationReadiness
  evaluation_ready?: boolean
  quality_reason?: string
}

export type TriggerReason = "page_checkpoint" | "dwell_checkpoint"
export type InteractionLevel = "low" | "medium" | "high"
export type IdleState = "active" | "idle" | "locked"
export type AlignmentState = "on_track" | "drifting" | "off_track" | "uncertain"
export type ModeHint = "search" | "deep_dive" | "feed" | "video" | "break" | "explore" | "unknown"
export type InterventionAction = "silent" | "nudge" | "icebreaker"
export type DisplayInterventionAction = Exclude<InterventionAction, "silent">

export interface BrowserContext {
  is_visible: boolean
  is_focused: boolean
  idle_state: IdleState
  has_media: boolean
}

export interface BehaviorSummary {
  dwell_seconds: number
  active_dwell_seconds: number
  interaction_level: InteractionLevel
  scroll_level: InteractionLevel
}

export interface RecentPageSummary {
  title: string
  url: string
  dwell_seconds: number
}

export interface LLMRequest {
  trigger_reason: TriggerReason
  goal: string | null
  current_page: {
    title: string
    meta: string
    url: string
    excerpt?: string
  }
  browser_context: BrowserContext
  behavior_summary: BehaviorSummary
  recent_pages: RecentPageSummary[]
}

export interface LLMResponse {
  alignment_state: AlignmentState
  mode_hint: ModeHint
  confidence: number
  nudge_message?: string | null
  icebreaker_message?: string | null
  suggested_goal?: string | null
}

export interface RuntimeIntervention extends LLMResponse {
  action: DisplayInterventionAction
  message: string
}

export interface BrowsingRecord {
  id: string
  timestamp: number
  url: string
  title: string
  goal: string | null
  alignment_state: AlignmentState
  mode_hint: ModeHint
  confidence: number
  stay_duration: number
  intervention_type: InterventionAction
  user_feedback?: "up" | "down"
}

export type AttentionState = "active" | "immersive" | "inactive"

export interface RuntimeSummary {
  current_page: PageInfo
  browser_context: BrowserContext
  behavior_summary: BehaviorSummary
  recent_pages: RecentPageSummary[]
}

// 每个 Tab 的独立状态
export interface TabState {
  pageInfo: PageInfo
  pageEnteredAt: number
  pageCheckpointEligibleAt: number | null
  lastTriggeredDwellBoundary: number
  activeDwellSeconds: number
  lastPulseAt: number
  lastActivityAt: number
  lastScrollAt: number
  interactionLevel: InteractionLevel
  scrollLevel: InteractionLevel
  isVisible: boolean
  isFocused: boolean
  idleState: IdleState
  hasMedia: boolean
  recentPages: RecentPageSummary[]
  cooldownUntil: number
  pendingIntervention: RuntimeIntervention | null
  pendingInterventionShown: boolean
  pendingInterventionGoalMissing: boolean
  pendingRequest: boolean
  pendingRequestId: number | null
}
