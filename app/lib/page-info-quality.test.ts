import { describe, expect, it } from "vitest"
import { removeGenericMeta } from "./page-info-quality"

describe("page info quality", () => {
  it("removes generic ChatGPT product meta", () => {
    const result = removeGenericMeta({
      adapterId: "chatgpt",
      meta: "ChatGPT 是一款供日常使用的 AI 聊天机器人，可帮助你写作、学习、头脑风暴等。"
    })

    expect(result).toEqual({
      meta: "",
      removed: true,
      reason: "generic_chatgpt_meta"
    })
  })

  it("removes generic DeepSeek product meta", () => {
    const result = removeGenericMeta({
      adapterId: "deepseek",
      meta: "DeepSeek 是一款智能助手，可帮助你高效完成各种任务。"
    })

    expect(result).toMatchObject({
      meta: "",
      removed: true,
      reason: "generic_deepseek_meta"
    })
  })

  it("keeps specific article meta for unknown sites", () => {
    const result = removeGenericMeta({
      adapterId: "generic",
      meta: "这篇文章介绍如何用 RAG 和 evals 改进客服问答系统。"
    })

    expect(result).toEqual({
      meta: "这篇文章介绍如何用 RAG 和 evals 改进客服问答系统。",
      removed: false
    })
  })

  it("handles empty meta without failing", () => {
    expect(removeGenericMeta({
      adapterId: "chatgpt",
      meta: "   "
    })).toEqual({
      meta: "",
      removed: true,
      reason: "empty_meta"
    })
  })
})
