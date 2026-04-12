import type { LLMRequest, LLMResponse, Settings } from "./types"

const SYSTEM_PROMPT = `你是一个专注力领航员。你的职责是温和地帮助用户意识到当前浏览状态是否偏离了他们的主线任务。

关键原则：
1. 不要评判用户的"意志力薄弱"——即使他们在主动摸鱼，也用"迷失方向"的视角来描述
2. 采用提问式而非命令式的温和语气
3. 保护用户的自我效能感，给他们台阶下

输出格式（必须是纯JSON）：
{
  "deviation_index": 1-5的数字,
  "message": "一句温柔的提醒话术",
  "action": "wait" | "nudge" | "block"
}

deviation_index 定义：
1 = 完全相关（如正在查阅技术文档、StackOverflow）
2 = 略微相关但非核心（如在找灵感的相关文章）
3 = 有些偏离（明显不是当前任务的直接内容）
4 = 严重偏离（如在娱乐网站、视频平台）
5 = 完全无关/无意义摸鱼

action 定义：
wait = 继续观察，不需要干预
nudge = 轻轻提醒一下
block = 需要更强干预（如页面变灰需确认）

请根据用户目标与当前页面的语义关联度，给出判断。`

export async function callLLM(
  settings: Settings,
  request: LLMRequest
): Promise<LLMResponse | null> {
  if (!settings.apiKey || !settings.apiUrl) {
    return null
  }

  try {
    const response = await fetch(settings.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `用户目标：${request.user_goal}\n当前页面标题：${request.current_page.title}\n页面描述：${request.current_page.meta}\n停留时间：${request.current_page.stay_time_seconds}秒`
          }
        ],
        temperature: 0.3
      })
    })

    if (!response.ok) {
      console.error("LLM API error:", response.status)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) return null

    // 解析 JSON 响应（处理 markdown 代码块包裹的情况）
    let jsonStr = content.trim()
    // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      jsonStr = match[1].trim()
    }

    const parsed = JSON.parse(jsonStr)
    return {
      deviation_index: Math.min(5, Math.max(1, parsed.deviation_index || 3)),
      message: parsed.message || "注意偏离了主线任务哦",
      action: ["wait", "nudge", "block"].includes(parsed.action)
        ? parsed.action
        : "wait"
    }
  } catch (err) {
    console.error("LLM call failed:", err)
    return null
  }
}
