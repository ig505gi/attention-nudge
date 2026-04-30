/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import InterventionToast from "./InterventionToast"

describe("InterventionToast debug log copy", () => {
  it("shows a debug copy button only when a copy handler is provided", () => {
    const { rerender } = render(createElement(InterventionToast, {
      message: "这个视频看起来跟 AI 应用开发相关，要继续观看吗？",
      buttonOptions: ["回到任务", "继续观看"],
      forceTheme: "light"
    }))

    expect(screen.queryByRole("button", { name: /复制日志/ })).not.toBeInTheDocument()

    rerender(createElement(InterventionToast, {
      message: "这个视频看起来跟 AI 应用开发相关，要继续观看吗？",
      buttonOptions: ["回到任务", "继续观看"],
      forceTheme: "light",
      onCopyDebugLogs: vi.fn()
    }))

    expect(screen.getByRole("button", { name: /复制日志/ })).toBeInTheDocument()
  })

  it("copies debug logs without closing the intervention", async () => {
    const onClose = vi.fn()
    const onCopyDebugLogs = vi.fn().mockResolvedValue(12)

    render(createElement(InterventionToast, {
      message: "这个视频看起来跟 AI 应用开发相关，要继续观看吗？",
      buttonOptions: ["回到任务", "继续观看"],
      forceTheme: "light",
      onClose,
      onCopyDebugLogs
    }))

    fireEvent.click(screen.getByRole("button", { name: /复制日志/ }))

    await waitFor(() => expect(onCopyDebugLogs).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("button", { name: /已复制/ })).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText("这个视频看起来跟 AI 应用开发相关，要继续观看吗？")).toBeInTheDocument()
  })
})
