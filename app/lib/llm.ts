import type { LLMRequest, LLMResponse, Settings } from "./types"
import { appendDebugLog } from "./storage"

const SYSTEM_PROMPT = `你是一个专注力领航员。你的职责是基于页面、浏览上下文、粗行为摘要和最近页面轨迹，温和判断用户此刻是否仍在主线上。

关键原则：
1. 不要评判用户，即使他们已经偏离，也要用温和、提问式、给台阶的表达
2. pre-LLM 触发很薄，因此你需要综合最近页面轨迹、页面内容、媒体状态、停留时长、交互和滚动强度来理解状态
3. 当用户没有设置目标时，不要强行判断“是否对齐目标”；改为判断当前浏览是否连贯、是否像是在有意识探索，以及是否值得温和地帮助用户明确目标
4. 证据不足时优先保守，输出 uncertain，并把候选干预文案置为 null
5. 你只负责语义判断和候选话术，不决定是否展示页面内提醒；是否打断用户由本地策略决定

输出格式（必须是纯JSON）：
{
  "alignment_state": "on_track" | "drifting" | "off_track" | "uncertain",
  "mode_hint": "search" | "deep_dive" | "feed" | "video" | "break" | "explore" | "unknown",
  "confidence": 0到1之间的数字,
  "nudge_message": "当用户有目标且 drifting/off_track 时的候选轻提醒文案，否则为 null",
  "icebreaker_message": "当用户未设置目标且明显失去方向时的候选问题式文案，否则为 null",
  "suggested_goal": "当用户未设置目标且你能高置信概括当前方向时填写，否则为 null"
}

字数要求：nudge_message 和 icebreaker_message 最多 50 字。

alignment_state 定义：
- on_track = 基本仍在主线上
- drifting = 有点偏，但未明显脱轨
- off_track = 明显偏离当前主线
- uncertain = 证据不足，或当前无目标无法直接判定对齐状态

mode_hint 定义：
- search = 查找资料/问题定位
- deep_dive = 深读/深度处理
- feed = 刷信息流
- video = 看视频/媒体消费
- break = 明显休息/切换
- explore = 无目标下的有意识探索
- unknown = 无法判断

无目标模式约束：
- 默认输出 uncertain，nudge_message 和 icebreaker_message 为 null
- 只有当用户明显失去方向，且提问会明显帮助用户时，才填写 icebreaker_message
- 如果浏览看起来连贯，可以给出 suggested_goal 作为安静草稿；不要为了建议目标而填写 icebreaker_message

请只输出纯 JSON。`

const DEFAULT_MODEL = "deepseek-chat"
const DEFAULT_TEMPERATURE = 0.2
const FALLBACK_TEMPERATURE = 1

const modelTemperaturePreference = new Map<string, number>()

type LLMChatMessage = {
  role: "system" | "user"
  content: string
}

type LLMRequestPayload = {
  model: string
  messages: LLMChatMessage[]
  temperature: number
}

function getModelName(settings: Settings): string {
  return settings.model || DEFAULT_MODEL
}

function getModelCacheKey(settings: Settings, model: string): string {
  return `${settings.apiUrl}::${model}`
}

function formatRecentPages(request: LLMRequest): string {
  if (request.recent_pages.length === 0) {
    return "最近页面轨迹：无"
  }

  return [
    "最近页面轨迹：",
    ...request.recent_pages.map((page, index) =>
      `${index + 1}. ${page.title} | ${page.url} | 停留 ${page.dwell_seconds} 秒`
    )
  ].join("\n")
}

function buildUserPrompt(request: LLMRequest): string {
  const goalLine = request.goal ? `当前目标：${request.goal}` : "当前目标：未设置"
  const excerptLine = request.current_page.excerpt
    ? `页面摘要：${request.current_page.excerpt}`
    : "页面摘要：无"

  return [
    `触发原因：${request.trigger_reason}`,
    goalLine,
    `当前页面标题：${request.current_page.title}`,
    `当前页面 URL：${request.current_page.url}`,
    `页面描述：${request.current_page.meta || "无"}`,
    excerptLine,
    `页面可见：${request.browser_context.is_visible ? "是" : "否"}`,
    `窗口聚焦：${request.browser_context.is_focused ? "是" : "否"}`,
    `系统状态：${request.browser_context.idle_state}`,
    `媒体播放：${request.browser_context.has_media ? "是" : "否"}`,
    `总停留时长：${request.behavior_summary.dwell_seconds}秒`,
    `有效停留时长：${request.behavior_summary.active_dwell_seconds}秒`,
    `交互强度：${request.behavior_summary.interaction_level}`,
    `滚动强度：${request.behavior_summary.scroll_level}`,
    formatRecentPages(request)
  ].join("\n")
}

function buildMessages(request: LLMRequest): LLMChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildUserPrompt(request)
    }
  ]
}

function buildRequestPayload(request: LLMRequest, model: string, temperature: number): LLMRequestPayload {
  return {
    model,
    messages: buildMessages(request),
    temperature
  }
}

async function appendLLMChatLog(
  settings: Settings,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await appendDebugLog({
      tag: "LLM_CHAT",
      event,
      payload
    }, { force: settings.debugMode })
  } catch {
    // Debug logging must never change the LLM control flow.
  }
}

function isTemperatureOneOnlyError(errorText: string): boolean {
  if (!errorText) return false

  const text = errorText.toLowerCase()
  const hasTempKeyword = text.includes("temperature") || errorText.includes("温度")
  if (!hasTempKeyword) return false

  const englishPattern =
    /(?:must|only|require|required|supports)\D{0,20}1(?:\.0)?/i.test(text) ||
    /1(?:\.0)?\D{0,20}(?:must|only|required)/i.test(text)
  const chinesePattern = /温度.{0,8}(?:仅|只|必须|只能).{0,8}1/.test(errorText)

  return englishPattern || chinesePattern
}

async function requestLLM(
  settings: Settings,
  payload: LLMRequestPayload
): Promise<Response> {
  return fetch(settings.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  })
}

async function parseLLMResponse(response: Response): Promise<{
  rawContent: string | null
  parsed: LLMResponse | null
}> {
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) return { rawContent: null, parsed: null }

  // 解析 JSON 响应（处理 markdown 代码块包裹的情况）
  let jsonStr = content.trim()
  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    jsonStr = match[1].trim()
  }

  const parsed = JSON.parse(jsonStr)

  // 软截断：在 50 字附近找自然断点（句号/逗号/顿号）
  const softTruncate = (text: string, maxLen = 50) => {
    if (text.length <= maxLen) return text
    const segment = text.slice(0, maxLen + 10)
    const lastBreak = Math.max(
      segment.lastIndexOf("。"),
      segment.lastIndexOf("，"),
      segment.lastIndexOf("、")
    )
    return lastBreak > 10 ? text.slice(0, lastBreak + 1) : text.slice(0, maxLen) + "…"
  }

  const allowedAlignment = new Set(["on_track", "drifting", "off_track", "uncertain"])
  const allowedModeHints = new Set(["search", "deep_dive", "feed", "video", "break", "explore", "unknown"])
  const alignmentState = allowedAlignment.has(parsed.alignment_state)
    ? parsed.alignment_state
    : "uncertain"
  const modeHint = allowedModeHints.has(parsed.mode_hint)
    ? parsed.mode_hint
    : "unknown"
  const confidence = typeof parsed.confidence === "number"
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5
  const normalizeCandidateMessage = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? softTruncate(value.trim())
      : null
  const legacyMessage = typeof parsed.message === "string" && parsed.message.trim()
    ? parsed.message.trim()
    : null
  const nudgeMessage = normalizeCandidateMessage(
    parsed.nudge_message ?? (parsed.action === "nudge" ? legacyMessage : null)
  )
  const icebreakerMessage = normalizeCandidateMessage(
    parsed.icebreaker_message ?? (parsed.action === "icebreaker" ? legacyMessage : null)
  )
  const suggestedGoal = typeof parsed.suggested_goal === "string" && parsed.suggested_goal.trim()
    ? parsed.suggested_goal.trim().slice(0, 80)
    : null

  return {
    rawContent: content,
    parsed: {
      alignment_state: alignmentState,
      mode_hint: modeHint,
      confidence,
      nudge_message: nudgeMessage,
      icebreaker_message: icebreakerMessage,
      suggested_goal: suggestedGoal
    }
  }
}

export function resetTemperaturePreferenceCacheForTest(): void {
  modelTemperaturePreference.clear()
}

export async function callLLM(
  settings: Settings,
  request: LLMRequest
): Promise<LLMResponse | null> {
  if (!settings.apiKey || !settings.apiUrl) {
    return null
  }

  const model = getModelName(settings)
  const cacheKey = getModelCacheKey(settings, model)
  const preferredTemperature = modelTemperaturePreference.get(cacheKey) ?? DEFAULT_TEMPERATURE

  try {
    let payload = buildRequestPayload(request, model, preferredTemperature)
    await appendLLMChatLog(settings, "request", {
      model,
      temperature: preferredTemperature,
      triggerReason: request.trigger_reason,
      currentPage: request.current_page,
      messages: payload.messages
    })

    let response = await requestLLM(settings, payload)

    if (!response.ok) {
      const errorText = await response.text()
      await appendLLMChatLog(settings, "api_error", {
        model,
        temperature: payload.temperature,
        status: response.status,
        errorText
      })

      const shouldRetryWithFallback =
        preferredTemperature !== FALLBACK_TEMPERATURE &&
        isTemperatureOneOnlyError(errorText)

      if (!shouldRetryWithFallback) {
        console.error("LLM API error:", response.status)
        return null
      }

      modelTemperaturePreference.set(cacheKey, FALLBACK_TEMPERATURE)
      payload = buildRequestPayload(request, model, FALLBACK_TEMPERATURE)
      await appendLLMChatLog(settings, "request", {
        model,
        temperature: FALLBACK_TEMPERATURE,
        triggerReason: request.trigger_reason,
        currentPage: request.current_page,
        retryReason: "temperature_fallback",
        messages: payload.messages
      })
      response = await requestLLM(settings, payload)
    }

    if (!response.ok) {
      await appendLLMChatLog(settings, "api_error", {
        model,
        temperature: payload.temperature,
        status: response.status
      })
      console.error("LLM API error:", response.status)
      return null
    }

    const { rawContent, parsed } = await parseLLMResponse(response)
    if (!parsed) {
      await appendLLMChatLog(settings, "response", {
        model,
        temperature: payload.temperature,
        rawContent,
        parsed: null
      })
      return null
    }

    await appendLLMChatLog(settings, "response", {
      model,
      temperature: payload.temperature,
      rawContent,
      parsed
    })

    return parsed
  } catch (err) {
    await appendLLMChatLog(settings, "exception", {
      model,
      triggerReason: request.trigger_reason,
      error: err
    })
    console.error("LLM call failed:", err)
    return null
  }
}
