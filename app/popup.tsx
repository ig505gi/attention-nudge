import { useState, useEffect } from "react"
import { getSettings, saveSettings, getUserGoal, saveUserGoal } from "~/lib/storage"
import type { Settings } from "~/lib/types"

const GOAL_DEBOUNCE_MS = 500

function mergeSettings(current: Settings | null, patch: Partial<Settings>): Settings {
  return {
    enabled: patch.enabled ?? current?.enabled ?? true,
    apiKey: patch.apiKey ?? current?.apiKey ?? "",
    apiUrl: patch.apiUrl ?? current?.apiUrl ?? "",
    model: patch.model ?? current?.model ?? "deepseek-chat",
    debugMode: patch.debugMode ?? current?.debugMode ?? false
  }
}

const styles = {
  container: {
    padding: 0,
    minWidth: 320,
    background: "linear-gradient(160deg, #F8FAFC 0%, #F1F5F9 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif',
    boxSizing: "border-box" as const,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 16px 14px",
    background: "linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)",
    borderRadius: "10px 10px 0 0",
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "2px solid rgba(255,255,255,0.3)",
    objectFit: "cover" as const,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: "#FFFFFF",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    marginTop: 1,
  },
  section: {
    padding: "14px 16px",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 6,
    color: "#6B7280",
    letterSpacing: "0.02em",
    textTransform: "uppercase" as const,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box" as const,
    background: "#FFFFFF",
    color: "#1A1A2E",
    outline: "none",
    transition: "all 0.2s ease",
  },
  inputFocus: {
    borderColor: "#0F766E",
    boxShadow: "0 0 0 3px rgba(15, 118, 110, 0.1)",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#4B5563",
    cursor: "pointer",
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: "#0F766E",
    cursor: "pointer",
  },
  divider: {
    margin: "0 16px",
    border: "none",
    borderTop: "1px solid #E2E8F0",
  },
  optionsButton: {
    width: "calc(100% - 32px)",
    margin: "12px 16px",
    padding: 10,
    background: "#FFFFFF",
    color: "#0F766E",
    border: "1px solid #0F766E",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxSizing: "border-box" as const,
  },
  footer: {
    fontSize: 11,
    color: "#94A3B8",
    padding: "10px 16px 14px",
    textAlign: "center",
  },
}

function IndexPopup() {
  const [enabled, setEnabled] = useState(true)
  const [goal, setGoal] = useState("")
  const [isReady, setIsReady] = useState(false)
  const [lastSavedEnabled, setLastSavedEnabled] = useState<boolean | null>(null)
  const [lastSavedGoal, setLastSavedGoal] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [iconUrl, setIconUrl] = useState<string>("")

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_ICON_URL" }, (res) => {
      if (res?.iconUrl) setIconUrl(res.iconUrl)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [s, g] = await Promise.all([getSettings(), getUserGoal()])
      if (cancelled) return

      const initialEnabled = s?.enabled ?? true
      const initialGoal = g?.goal ?? ""

      setEnabled(initialEnabled)
      setGoal(initialGoal)
      setLastSavedEnabled(initialEnabled)
      setLastSavedGoal(initialGoal)
      setIsReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isReady || lastSavedEnabled === null || enabled === lastSavedEnabled) {
      return
    }

    let cancelled = false
    ;(async () => {
      const current = await getSettings()
      const next = mergeSettings(current, { enabled })
      await saveSettings(next)
      chrome.runtime.sendMessage({ type: "SERVICE_TOGGLE", payload: { enabled } })

      if (!cancelled) {
        setLastSavedEnabled(enabled)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, isReady, lastSavedEnabled])

  useEffect(() => {
    if (!isReady || lastSavedGoal === null || goal === lastSavedGoal) {
      return
    }

    const timer = setTimeout(async () => {
      await saveUserGoal(goal)
      setLastSavedGoal(goal)
    }, GOAL_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [goal, isReady, lastSavedGoal])

  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <img
          src={iconUrl || undefined}
          alt="Logo"
          style={styles.logo}
        />
        <div>
          <span style={styles.title}>AttentionNudge</span>
          <div style={styles.subtitle}>LLM Focus Assistant</div>
        </div>
      </div>

      <section style={styles.section}>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
            }}
            style={styles.checkbox}
          />
          开启服务
        </label>
        <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 24, display: "block", marginTop: 4 }}>
          关闭后不再进行任何监控和干预
        </span>
      </section>

      <hr style={styles.divider} />

      <section style={styles.section}>
        <label style={styles.label}>当前任务</label>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：写 Python 爬虫"
          style={{
            ...styles.input,
            ...(focused === "goal" ? styles.inputFocus : {}),
          }}
          onFocus={() => setFocused("goal")}
          onBlur={() => setFocused(null)}
        />
      </section>

      <hr style={styles.divider} />

      <button
        onClick={handleOpenOptions}
        style={styles.optionsButton}
      >
        更多设置
      </button>

      <p style={styles.footer}>
        自动保存 · BYOK 模式数据直连大模型
      </p>
    </div>
  )
}

export default IndexPopup
