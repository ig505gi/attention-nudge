type MetaQualityResult = {
  meta: string
  removed: boolean
  reason?: string
}

function normalizeMeta(meta: string): string {
  return meta.replace(/\s+/g, " ").trim()
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

export function removeGenericMeta(input: {
  adapterId: string
  meta: string
}): MetaQualityResult {
  const meta = normalizeMeta(input.meta)
  if (!meta) {
    return {
      meta: "",
      removed: true,
      reason: "empty_meta"
    }
  }

  const lower = meta.toLowerCase()
  const adapterId = input.adapterId.toLowerCase()

  if (
    adapterId === "chatgpt" &&
    (lower.includes("chatgpt") ||
      containsAny(meta, ["AI 聊天机器人", "日常使用的 AI", "帮助你写作、学习"]))
  ) {
    return {
      meta: "",
      removed: true,
      reason: "generic_chatgpt_meta"
    }
  }

  if (
    adapterId === "deepseek" &&
    (lower.includes("deepseek") ||
      containsAny(meta, ["智能助手", "帮助你高效完成各种任务"]))
  ) {
    return {
      meta: "",
      removed: true,
      reason: "generic_deepseek_meta"
    }
  }

  if (
    (adapterId === "google-search" || adapterId === "baidu-search") &&
    containsAny(lower, ["search engine", "搜索引擎", "百度一下", "google search"])
  ) {
    return {
      meta: "",
      removed: true,
      reason: "generic_search_meta"
    }
  }

  if (
    containsAny(lower, ["login", "sign in", "sign up", "privacy policy"]) ||
    containsAny(meta, ["登录", "注册", "验证码", "隐私政策"])
  ) {
    return {
      meta: "",
      removed: true,
      reason: "generic_account_meta"
    }
  }

  return {
    meta,
    removed: false
  }
}
