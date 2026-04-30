import { describe, expect, it } from "vitest"
import type { DebugLogEntry } from "./storage"
import { DEBUG_BUG_REPORT_LOG_LIMIT, buildBugReportDebugLogText } from "./debug-log-export"

function makeLog(index: number, payload: unknown = { index }): DebugLogEntry {
  return {
    id: `debug-${index}`,
    timestamp: new Date(1_716_000_000_000 + index).toISOString(),
    epoch_ms: 1_716_000_000_000 + index,
    tag: "TEST",
    event: `event-${index}`,
    payload
  }
}

describe("debug log export", () => {
  it("builds a pasteable bug report from the retained recent logs and current page", () => {
    const logs = Array.from({ length: DEBUG_BUG_REPORT_LOG_LIMIT + 5 }, (_, index) => makeLog(index))

    const text = buildBugReportDebugLogText({
      logs,
      generatedAtMs: 1_716_000_010_000,
      currentPage: {
        title: "YouTube LLM video",
        url: "https://www.youtube.com/watch?v=abc",
        meta: "A video about LLM app development"
      }
    })
    const parsed = JSON.parse(text)

    expect(parsed).toMatchObject({
      source: "AttentionNudge",
      kind: "bug_report_debug_logs",
      generated_at: "2024-05-18T02:40:10.000Z",
      log_count: 80,
      current_page: {
        title: "YouTube LLM video",
        url: "https://www.youtube.com/watch?v=abc",
        meta: "A video about LLM app development"
      }
    })
    expect(DEBUG_BUG_REPORT_LOG_LIMIT).toBe(80)
    expect(parsed.logs).toHaveLength(80)
    expect(parsed.logs[0].event).toBe("event-5")
    expect(parsed.logs[79].event).toBe("event-84")
  })

  it("redacts sensitive fields defensively before copying", () => {
    const text = buildBugReportDebugLogText({
      generatedAtMs: 1_716_000_010_000,
      logs: [
        makeLog(1, {
          apiKey: "sk-secret",
          authorization: "Bearer secret",
          nested: {
            token: "private-token",
            password: "secret-password",
            safe: "kept"
          }
        })
      ]
    })
    const parsed = JSON.parse(text)
    const serialized = JSON.stringify(parsed)

    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("Bearer secret")
    expect(serialized).not.toContain("private-token")
    expect(serialized).not.toContain("secret-password")
    expect(parsed.logs[0].payload).toMatchObject({
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      nested: {
        token: "[REDACTED]",
        password: "[REDACTED]",
        safe: "kept"
      }
    })
  })
})
