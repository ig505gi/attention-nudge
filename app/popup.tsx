import { useEffect, useMemo, useState } from "react"
import { getSettings, saveSettings, getUserGoal, saveUserGoal } from "~/lib/storage"
import type { Settings } from "~/lib/types"

const GOAL_DEBOUNCE_MS = 500
const THEME_PREF_STORAGE_KEY = "optionsThemePreference"
const POPUP_WIDTH = 332
const FONT_BODY =
  'ui-rounded, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif'
const FONT_HEADING =
  'ui-rounded, "SF Pro Rounded", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif'

type ThemeMode = "light" | "dark"
type ThemePreference = "system" | "light" | "dark"

function mergeSettings(current: Settings | null, patch: Partial<Settings>): Settings {
  return {
    enabled: patch.enabled ?? current?.enabled ?? true,
    apiKey: patch.apiKey ?? current?.apiKey ?? "",
    apiUrl: patch.apiUrl ?? current?.apiUrl ?? "",
    model: patch.model ?? current?.model ?? "deepseek-chat",
    debugMode: patch.debugMode ?? current?.debugMode ?? false
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light"
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function getExtensionIconUrl(): string {
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest) {
    return ""
  }

  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    action?: {
      default_icon?: string | Record<string, string>
    }
  }

  const iconMap = manifest.icons ?? {}
  const defaultIcon = manifest.action?.default_icon
  const actionIcon =
    typeof defaultIcon === "string"
      ? defaultIcon
      : defaultIcon?.["128"] ?? defaultIcon?.["64"] ?? defaultIcon?.["48"] ?? defaultIcon?.["32"] ?? defaultIcon?.["16"]
  const iconPath = iconMap["128"] ?? iconMap["64"] ?? iconMap["48"] ?? iconMap["32"] ?? iconMap["16"] ?? actionIcon

  return iconPath ? chrome.runtime.getURL(iconPath) : ""
}

function createTheme(mode: ThemeMode) {
  if (mode === "dark") {
    return {
      background:
        "radial-gradient(circle at 14% 14%, rgba(243, 154, 70, 0.16), transparent 46%), radial-gradient(circle at 90% 8%, rgba(139, 136, 232, 0.18), transparent 42%), linear-gradient(160deg, #111826 0%, #151a2f 56%, #0f1628 100%)",
      panelBg: "rgba(19, 25, 41, 0.88)",
      panelBorder: "rgba(178, 190, 220, 0.16)",
      panelShadow: "0 12px 30px rgba(0, 0, 0, 0.3)",
      topbarBg: "rgba(20, 27, 45, 0.92)",
      topbarBorder: "rgba(178, 190, 220, 0.18)",
      title: "#F6F9FF",
      subtitle: "#A8B4CC",
      text: "#E5ECFA",
      helper: "#9EABC6",
      inputBg: "rgba(13, 20, 35, 0.8)",
      inputBorder: "rgba(157, 173, 205, 0.32)",
      inputFocusBorder: "#F39A46",
      inputFocusRing: "0 0 0 3px rgba(243, 154, 70, 0.24)",
      divider: "rgba(178, 190, 220, 0.18)",
      accentBg: "linear-gradient(140deg, #F39A46 0%, #8B88E8 100%)",
      accentText: "#FFFFFF",
      ghostBg: "rgba(26, 34, 56, 0.72)",
      ghostBorder: "rgba(178, 190, 220, 0.24)",
      ghostText: "#D6E1F9"
    }
  }

  return {
    background:
      "radial-gradient(circle at 12% 14%, rgba(243, 154, 70, 0.2), transparent 44%), radial-gradient(circle at 86% 10%, rgba(139, 136, 232, 0.16), transparent 42%), linear-gradient(165deg, #FFF8EF 0%, #FFFDF7 42%, #F4FBFF 100%)",
    panelBg: "rgba(255, 255, 255, 0.82)",
    panelBorder: "rgba(44, 49, 64, 0.1)",
    panelShadow: "0 10px 24px rgba(20, 30, 48, 0.1)",
    topbarBg: "rgba(255, 252, 247, 0.9)",
    topbarBorder: "rgba(44, 49, 64, 0.1)",
    title: "#2C3140",
    subtitle: "#6F7C90",
    text: "#405069",
    helper: "#7B889A",
    inputBg: "rgba(255, 255, 255, 0.9)",
    inputBorder: "rgba(44, 49, 64, 0.2)",
    inputFocusBorder: "#F39A46",
    inputFocusRing: "0 0 0 3px rgba(243, 154, 70, 0.2)",
    divider: "rgba(44, 49, 64, 0.1)",
    accentBg: "linear-gradient(140deg, #F39A46 0%, #8B88E8 100%)",
    accentText: "#FFFFFF",
    ghostBg: "rgba(255, 255, 255, 0.72)",
    ghostBorder: "rgba(44, 49, 64, 0.16)",
    ghostText: "#3D4F66"
  }
}

function createStyles(theme: ReturnType<typeof createTheme>, focused: string | null) {
  return {
    container: {
      width: POPUP_WIDTH,
      minWidth: POPUP_WIDTH,
      minHeight: 424,
      background: theme.background,
      boxSizing: "border-box" as const,
      fontFamily: FONT_BODY,
      padding: 0,
      overflow: "hidden" as const
    },
    panel: {
      border: "none",
      borderRadius: 0,
      overflow: "hidden" as const,
      background: "transparent",
      boxShadow: "none",
      backdropFilter: "none"
    },
    header: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "16px 16px",
      background: theme.topbarBg,
      borderBottom: `1px solid ${theme.topbarBorder}`
    },
    logo: {
      width: 32,
      height: 32,
      borderRadius: 11,
      border: `1px solid ${theme.ghostBorder}`,
      objectFit: "cover" as const,
      boxShadow: "0 4px 10px rgba(0, 0, 0, 0.12)"
    },
    title: {
      fontSize: 15.5,
      lineHeight: 1.25,
      fontWeight: 650,
      color: theme.title,
      margin: 0,
      fontFamily: FONT_HEADING,
      letterSpacing: "0.005em"
    },
    subtitle: {
      fontSize: 11.5,
      color: theme.subtitle,
      marginTop: 4,
      lineHeight: 1.35
    },
    section: {
      padding: "15px 16px"
    },
    checkboxLabel: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13.5,
      color: theme.text,
      cursor: "pointer"
    },
    checkbox: {
      width: 16,
      height: 16,
      accentColor: theme.inputFocusBorder,
      cursor: "pointer"
    },
    helper: {
      fontSize: 11.5,
      color: theme.helper,
      marginLeft: 26,
      display: "block",
      marginTop: 7,
      lineHeight: 1.5
    },
    divider: {
      margin: "0 16px",
      border: "none",
      borderTop: `1px solid ${theme.divider}`
    },
    label: {
      display: "block",
      fontSize: 11.5,
      fontWeight: 600,
      marginBottom: 9,
      color: theme.subtitle,
      letterSpacing: "0.03em",
      textTransform: "uppercase" as const
    },
    input: {
      width: "100%",
      padding: "12px 13px",
      border: `1px solid ${focused === "goal" ? theme.inputFocusBorder : theme.inputBorder}`,
      borderRadius: 12,
      fontSize: 13.5,
      lineHeight: 1.5,
      boxSizing: "border-box" as const,
      background: theme.inputBg,
      color: theme.text,
      outline: "none",
      transition: "all 0.2s ease",
      boxShadow: focused === "goal" ? theme.inputFocusRing : "none"
    },
    footer: {
      fontSize: 10.5,
      color: theme.helper,
      padding: "8px 16px 14px",
      textAlign: "center" as const
    },
    primaryButton: {
      width: "calc(100% - 32px)",
      margin: "2px 16px 12px",
      padding: 12,
      background: theme.accentBg,
      color: theme.accentText,
      border: "none",
      borderRadius: 14,
      fontSize: 13.5,
      fontWeight: 650,
      cursor: "pointer",
      boxShadow: "0 8px 18px rgba(24, 30, 47, 0.16)"
    }
  }
}

function IndexPopup() {
  const [enabled, setEnabled] = useState(true)
  const [goal, setGoal] = useState("")
  const [isReady, setIsReady] = useState(false)
  const [lastSavedEnabled, setLastSavedEnabled] = useState<boolean | null>(null)
  const [lastSavedGoal, setLastSavedGoal] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [iconUrl, setIconUrl] = useState<string>("")
  const [version, setVersion] = useState("0.0.0")
  const [themePreference, setThemePreference] = useState<ThemePreference>("system")
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)

  useEffect(() => {
    setIconUrl(getExtensionIconUrl())
    if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
      setVersion(chrome.runtime.getManifest().version || "0.0.0")
    }
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const html = document.documentElement
    const body = document.body
    const plasmoRoot = document.getElementById("__plasmo")

    const prev = {
      htmlMargin: html.style.margin,
      htmlPadding: html.style.padding,
      htmlBackground: html.style.background,
      bodyMargin: body.style.margin,
      bodyPadding: body.style.padding,
      bodyBackground: body.style.background,
      bodyWidth: body.style.width,
      bodyMinWidth: body.style.minWidth,
      bodyHeight: body.style.height,
      rootMargin: plasmoRoot?.style.margin ?? "",
      rootPadding: plasmoRoot?.style.padding ?? "",
      rootBackground: plasmoRoot?.style.background ?? "",
      rootWidth: plasmoRoot?.style.width ?? "",
      rootMinWidth: plasmoRoot?.style.minWidth ?? "",
      rootHeight: plasmoRoot?.style.height ?? ""
    }

    html.style.margin = "0"
    html.style.padding = "0"
    html.style.background = "transparent"
    body.style.margin = "0"
    body.style.padding = "0"
    body.style.background = "transparent"
    body.style.width = `${POPUP_WIDTH}px`
    body.style.minWidth = `${POPUP_WIDTH}px`
    body.style.height = "auto"

    if (plasmoRoot) {
      plasmoRoot.style.margin = "0"
      plasmoRoot.style.padding = "0"
      plasmoRoot.style.background = "transparent"
      plasmoRoot.style.width = `${POPUP_WIDTH}px`
      plasmoRoot.style.minWidth = `${POPUP_WIDTH}px`
      plasmoRoot.style.height = "auto"
    }

    return () => {
      html.style.margin = prev.htmlMargin
      html.style.padding = prev.htmlPadding
      html.style.background = prev.htmlBackground
      body.style.margin = prev.bodyMargin
      body.style.padding = prev.bodyPadding
      body.style.background = prev.bodyBackground
      body.style.width = prev.bodyWidth
      body.style.minWidth = prev.bodyMinWidth
      body.style.height = prev.bodyHeight
      if (plasmoRoot) {
        plasmoRoot.style.margin = prev.rootMargin
        plasmoRoot.style.padding = prev.rootPadding
        plasmoRoot.style.background = prev.rootBackground
        plasmoRoot.style.width = prev.rootWidth
        plasmoRoot.style.minWidth = prev.rootMinWidth
        plasmoRoot.style.height = prev.rootHeight
      }
    }
  }, [])

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return
    }
    chrome.storage.local.get([THEME_PREF_STORAGE_KEY]).then((result) => {
      const pref = result[THEME_PREF_STORAGE_KEY]
      if (pref === "system" || pref === "light" || pref === "dark") {
        setThemePreference(pref)
      }
    })
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const computeMode = (): ThemeMode => {
      if (themePreference === "system") {
        return media.matches ? "dark" : "light"
      }
      return themePreference
    }

    setThemeMode(computeMode())

    if (themePreference !== "system") {
      return
    }

    const onChange = (event: MediaQueryListEvent) => {
      setThemeMode(event.matches ? "dark" : "light")
    }

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    }

    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [themePreference])

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

  const theme = useMemo(() => createTheme(themeMode), [themeMode])
  const styles = useMemo(() => createStyles(theme, focused), [theme, focused])

  return (
    <div style={styles.container}>
      <main style={styles.panel}>
        <header style={styles.header}>
          <img src={iconUrl || undefined} alt="AttentionNudge Logo" style={styles.logo} />
          <div>
            <p style={styles.title}>AttentionNudge</p>
            <div style={styles.subtitle}>Cozy Co-pilot · v{version}</div>
          </div>
        </header>

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
          <span style={styles.helper}>关闭后不再进行监控与干预。</span>
        </section>

        <hr style={styles.divider} />

        <section style={styles.section}>
          <label style={styles.label}>今天最想完成的事</label>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例如：完成本周需求评审"
            style={styles.input}
            onFocus={() => setFocused("goal")}
            onBlur={() => setFocused(null)}
          />
        </section>

        <button onClick={handleOpenOptions} style={styles.primaryButton}>
          打开完整设置
        </button>

        <p style={styles.footer}>
          主题来源：{themePreference === "system" ? "跟随系统" : themePreference === "dark" ? "深色" : "浅色"} · 自动保存
        </p>
      </main>
    </div>
  )
}

export default IndexPopup
