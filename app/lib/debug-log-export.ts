import type { DebugLogEntry } from "./storage"

export const DEBUG_BUG_REPORT_LOG_LIMIT = 80

export interface DebugExportPageInfo {
  title: string
  url: string
  meta: string
}

interface BuildBugReportDebugLogTextInput {
  logs: DebugLogEntry[]
  currentPage?: DebugExportPageInfo | null
  generatedAtMs?: number
  maxEntries?: number
}

const SENSITIVE_KEY_MARKERS = ["apikey", "authorization", "token", "secret", "password"]

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase()
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized === marker || normalized.endsWith(marker))
}

function redactSensitiveFields(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value

  if (typeof value !== "object") {
    return value
  }

  if (seen.has(value)) {
    return "[Circular]"
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactSensitiveFields(item, seen)
    ])
  )
}

export function buildBugReportDebugLogText(input: BuildBugReportDebugLogTextInput): string {
  const maxEntries = Math.max(1, Math.min(input.maxEntries ?? DEBUG_BUG_REPORT_LOG_LIMIT, DEBUG_BUG_REPORT_LOG_LIMIT))
  const logs = input.logs.slice(-maxEntries).map((log) => redactSensitiveFields(log))
  const generatedAtMs = input.generatedAtMs ?? Date.now()

  return JSON.stringify({
    source: "AttentionNudge",
    kind: "bug_report_debug_logs",
    generated_at: new Date(generatedAtMs).toISOString(),
    log_count: logs.length,
    current_page: input.currentPage ? redactSensitiveFields(input.currentPage) : null,
    logs
  }, null, 2)
}
