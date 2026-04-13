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

export interface PageInfo {
  title: string
  meta: string
  url: string
  timestamp: number
}

export interface LLMRequest {
  user_goal: string
  current_page: {
    title: string
    meta: string
    url: string
    stay_time_seconds: number
  }
}

export interface LLMResponse {
  deviation_index: number // 1-5
  message: string
  action: "wait" | "nudge" | "block"
  /** 干预弹窗两个按钮的文案，RPG 风格。留空则用默认随机文案。 */
  button_options?: [string, string]
}

export interface BrowsingRecord {
  id: string
  timestamp: number
  url: string
  title: string
  goal: string
  deviation_index: number
  stay_duration: number
  intervention_type: "silent" | "nudge" | "block"
  user_feedback?: "up" | "down"
}

export type AttentionState = "active" | "immersive" | "inactive"

// 每个 Tab 的独立状态
export interface TabState {
  pageInfo: PageInfo
  startTime: number
  isVisible: boolean
  pendingIntervention: LLMResponse | null
  pendingRequest: boolean
}

// 批量请求条目
export interface BatchEntry {
  tabId: number
  pageInfo: PageInfo
  startTime: number
}
