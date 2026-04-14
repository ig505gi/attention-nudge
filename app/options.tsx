import { useEffect, useMemo, useState } from "react"
import InterventionToast from "~/components/InterventionToast"
import { getSettings, saveSettings } from "~/lib/storage"
import type { Settings } from "~/lib/types"

type ThemeMode = "light" | "dark"
type ThemePreference = "system" | "light" | "dark"
type NavSection = "basic" | "developer"
type ToastPulseMode = "off" | "soft" | "medium"
type ToastPreviewPrefs = {
  message: string
  primaryLabel: string
  secondaryLabel: string
  entryDurationMs: number
  topOffsetPx: number
  pulseMode: ToastPulseMode
}

const THEME_PREF_STORAGE_KEY = "optionsThemePreference"
const TOAST_PREVIEW_PREFS_STORAGE_KEY = "optionsToastPreviewPrefsV1"
const FONT_BODY =
  'ui-rounded, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif'
const FONT_HEADING =
  'ui-rounded, "SF Pro Rounded", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif'
const DEFAULT_TOAST_PREVIEW_PREFS: ToastPreviewPrefs = {
  message: "你刚刚偏离了当前目标，要不要先把注意力带回正在做的事？",
  primaryLabel: "好的，回到任务",
  secondaryLabel: "先缓一会儿",
  entryDurationMs: 620,
  topOffsetPx: 92,
  pulseMode: "soft"
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

function normalizeToastPreviewPrefs(raw: unknown): ToastPreviewPrefs {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}

  const readString = (key: keyof ToastPreviewPrefs, fallback: string) =>
    typeof source[key] === "string" ? (source[key] as string) : fallback
  const readNumber = (key: keyof ToastPreviewPrefs, min: number, max: number, fallback: number) => {
    const value = source[key]
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback
    }
    return Math.min(max, Math.max(min, Math.round(value)))
  }
  const readPulse = (key: keyof ToastPreviewPrefs, fallback: ToastPulseMode): ToastPulseMode => {
    const value = source[key]
    return value === "off" || value === "soft" || value === "medium" ? value : fallback
  }

  return {
    message: readString("message", DEFAULT_TOAST_PREVIEW_PREFS.message),
    primaryLabel: readString("primaryLabel", DEFAULT_TOAST_PREVIEW_PREFS.primaryLabel),
    secondaryLabel: readString("secondaryLabel", DEFAULT_TOAST_PREVIEW_PREFS.secondaryLabel),
    entryDurationMs: readNumber("entryDurationMs", 360, 980, DEFAULT_TOAST_PREVIEW_PREFS.entryDurationMs),
    topOffsetPx: readNumber("topOffsetPx", 48, 180, DEFAULT_TOAST_PREVIEW_PREFS.topOffsetPx),
    pulseMode: readPulse("pulseMode", DEFAULT_TOAST_PREVIEW_PREFS.pulseMode)
  }
}

function createTheme(mode: ThemeMode) {
  if (mode === "dark") {
    return {
      background:
        "radial-gradient(circle at 13% 14%, rgba(243, 154, 70, 0.14), transparent 45%), radial-gradient(circle at 86% 8%, rgba(139, 136, 232, 0.16), transparent 42%), linear-gradient(160deg, #101625 0%, #151b30 56%, #0f1628 100%)",
      haloA: "rgba(243, 154, 70, 0.18)",
      haloB: "rgba(139, 136, 232, 0.18)",
      shellBackground: "rgba(19, 25, 41, 0.88)",
      shellBorder: "rgba(178, 190, 220, 0.18)",
      shellShadow: "0 18px 42px rgba(0, 0, 0, 0.34)",
      topbarBackground: "rgba(21, 28, 46, 0.92)",
      topbarBorder: "rgba(178, 190, 220, 0.16)",
      sidebarBackground: "rgba(25, 33, 54, 0.7)",
      sidebarBorder: "rgba(178, 190, 220, 0.15)",
      contentBackground: "rgba(20, 27, 45, 0.62)",
      contentBorder: "rgba(178, 190, 220, 0.14)",
      title: "#F6F9FF",
      subtitle: "#A8B4CC",
      label: "#CED9EF",
      text: "#E5ECFA",
      helper: "#9EABC6",
      inputBg: "rgba(13, 20, 35, 0.82)",
      inputBorder: "rgba(157, 173, 205, 0.3)",
      inputFocusBorder: "#F39A46",
      inputFocusRing: "0 0 0 3px rgba(243, 154, 70, 0.22)",
      divider: "rgba(178, 190, 220, 0.16)",
      buttonBg: "linear-gradient(140deg, #F39A46 0%, #8B88E8 100%)",
      buttonSavedBg: "linear-gradient(140deg, #4AAE98 0%, #7D88E6 100%)",
      buttonText: "#FFFFFF",
      navItemActiveBg: "rgba(243, 154, 70, 0.2)",
      navItemActiveBorder: "rgba(243, 154, 70, 0.4)",
      navItemText: "#C8D4EC",
      navItemActiveText: "#FFF5EA",
      chipBg: "rgba(26, 34, 56, 0.72)",
      chipBorder: "rgba(178, 190, 220, 0.24)",
      chipActiveBg: "rgba(243, 154, 70, 0.2)",
      chipActiveBorder: "rgba(243, 154, 70, 0.45)",
      chipText: "#D6E1F9",
      chipActiveText: "#FFF3E3"
    }
  }

  return {
    background:
      "radial-gradient(circle at 12% 14%, rgba(243, 154, 70, 0.18), transparent 44%), radial-gradient(circle at 86% 10%, rgba(139, 136, 232, 0.14), transparent 42%), linear-gradient(165deg, #FFF8EF 0%, #FFFDF7 42%, #F4FBFF 100%)",
    haloA: "rgba(243, 154, 70, 0.2)",
    haloB: "rgba(139, 136, 232, 0.16)",
    shellBackground: "rgba(255, 255, 255, 0.82)",
    shellBorder: "rgba(44, 49, 64, 0.12)",
    shellShadow: "0 16px 36px rgba(20, 30, 48, 0.12)",
    topbarBackground: "rgba(255, 252, 247, 0.9)",
    topbarBorder: "rgba(44, 49, 64, 0.1)",
    sidebarBackground: "rgba(255, 255, 255, 0.62)",
    sidebarBorder: "rgba(44, 49, 64, 0.1)",
    contentBackground: "rgba(255, 255, 255, 0.64)",
    contentBorder: "rgba(44, 49, 64, 0.1)",
    title: "#2C3140",
    subtitle: "#6F7C90",
    label: "#4A5C73",
    text: "#405069",
    helper: "#7B889A",
    inputBg: "rgba(255, 255, 255, 0.9)",
    inputBorder: "rgba(44, 49, 64, 0.2)",
    inputFocusBorder: "#F39A46",
    inputFocusRing: "0 0 0 3px rgba(243, 154, 70, 0.2)",
    divider: "rgba(44, 49, 64, 0.1)",
    buttonBg: "linear-gradient(140deg, #F39A46 0%, #8B88E8 100%)",
    buttonSavedBg: "linear-gradient(140deg, #4AAE98 0%, #8B88E8 100%)",
    buttonText: "#FFFFFF",
    navItemActiveBg: "rgba(243, 154, 70, 0.16)",
    navItemActiveBorder: "rgba(243, 154, 70, 0.36)",
    navItemText: "#50647D",
    navItemActiveText: "#5B3214",
    chipBg: "rgba(255, 255, 255, 0.8)",
    chipBorder: "rgba(44, 49, 64, 0.18)",
    chipActiveBg: "rgba(243, 154, 70, 0.16)",
    chipActiveBorder: "rgba(243, 154, 70, 0.36)",
    chipText: "#4B5E75",
    chipActiveText: "#5B3214"
  }
}

function createStyles(theme: ReturnType<typeof createTheme>, focused: string | null, saved: boolean, compact: boolean) {
  return {
    page: {
      height: "100vh",
      width: "100%",
      maxWidth: "100%",
      background: theme.background,
      padding: compact ? 0 : 10,
      boxSizing: "border-box" as const,
      fontFamily: FONT_BODY,
      position: "relative" as const,
      overflowX: "hidden" as const,
      overflowY: "hidden" as const,
      display: "flex"
    },
    haloTop: {
      position: "absolute" as const,
      width: 320,
      height: 320,
      borderRadius: "999px",
      background: theme.haloA,
      filter: "blur(36px)",
      top: -110,
      left: -100,
      pointerEvents: "none" as const
    },
    haloBottom: {
      position: "absolute" as const,
      width: 300,
      height: 300,
      borderRadius: "999px",
      background: theme.haloB,
      filter: "blur(42px)",
      right: -120,
      bottom: -120,
      pointerEvents: "none" as const
    },
    shell: {
      width: "100%",
      maxWidth: "none",
      margin: 0,
      background: theme.shellBackground,
      border: compact ? "none" : `1px solid ${theme.shellBorder}`,
      borderRadius: compact ? 0 : 20,
      boxSizing: "border-box" as const,
      boxShadow: compact ? "none" : theme.shellShadow,
      backdropFilter: "blur(10px)",
      position: "relative" as const,
      zIndex: 1,
      overflow: "hidden" as const,
      height: "100%",
      display: "flex" as const,
      flexDirection: "column" as const,
      minHeight: 0
    },
    topbar: {
      display: "flex",
      alignItems: compact ? "stretch" : "center",
      flexDirection: compact ? "column" : "row",
      justifyContent: "space-between",
      gap: 14,
      padding: "18px 22px",
      borderBottom: `1px solid ${theme.topbarBorder}`,
      background: theme.topbarBackground,
      backdropFilter: "blur(8px)"
    },
    brandWrap: {
      display: "flex",
      alignItems: "center",
      gap: 12
    },
    logo: {
      width: 28,
      height: 28,
      borderRadius: 10,
      border: `1px solid ${theme.chipBorder}`,
      objectFit: "cover" as const,
      boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)"
    },
    brandTitle: {
      margin: 0,
      fontSize: 15.5,
      lineHeight: 1.25,
      fontWeight: 650,
      color: theme.title,
      fontFamily: FONT_HEADING,
      letterSpacing: "0.005em"
    },
    version: {
      marginTop: 4,
      fontSize: 10.5,
      color: theme.helper,
      letterSpacing: "0.02em"
    },
    themeChips: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap" as const,
      justifyContent: compact ? ("flex-start" as const) : ("flex-end" as const)
    },
    body: {
      display: compact ? ("block" as const) : ("grid" as const),
      gridTemplateColumns: compact ? undefined : "220px minmax(0, 1fr)",
      minHeight: 0,
      height: compact ? "auto" : undefined,
      flex: 1
    },
    sidebar: {
      padding: 18,
      borderRight: compact ? "none" : `1px solid ${theme.sidebarBorder}`,
      borderBottom: compact ? `1px solid ${theme.sidebarBorder}` : "none",
      background: theme.sidebarBackground
    },
    sidebarTitle: {
      margin: "5px 0 13px",
      fontSize: 10.5,
      color: theme.helper,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const
    },
    nav: {
      display: compact ? ("flex" as const) : ("grid" as const),
      gap: 10,
      flexWrap: compact ? ("wrap" as const) : undefined
    },
    navItem: (active: boolean) => ({
      textAlign: "left" as const,
      padding: "12px 14px",
      borderRadius: 14,
      border: `1px solid ${active ? theme.navItemActiveBorder : "transparent"}`,
      background: active ? theme.navItemActiveBg : "transparent",
      color: active ? theme.navItemActiveText : theme.navItemText,
      fontSize: 13.5,
      fontWeight: active ? 650 : 500,
      cursor: "pointer",
      transition: "all 0.18s ease",
      boxShadow: active ? "0 8px 18px rgba(24, 30, 47, 0.08)" : "none"
    }),
    content: {
      padding: compact ? "20px 16px 16px" : "26px 30px 24px",
      background: theme.contentBackground,
      overflowY: compact ? ("visible" as const) : ("auto" as const),
      minHeight: 0
    },
    heading: {
      margin: 0,
      fontSize: 21,
      lineHeight: 1.24,
      fontWeight: 650,
      color: theme.title,
      fontFamily: FONT_HEADING,
      letterSpacing: "0.005em"
    },
    subtitle: {
      marginTop: 10,
      marginBottom: 24,
      fontSize: 13.5,
      color: theme.subtitle,
      lineHeight: 1.62
    },
    section: {
      marginBottom: 20
    },
    label: {
      display: "block",
      fontSize: 10.5,
      fontWeight: 600,
      marginBottom: 9,
      color: theme.label,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const
    },
    input: (field: string) => ({
      width: "100%",
      padding: "12px 14px",
      border: `1px solid ${focused === field ? theme.inputFocusBorder : theme.inputBorder}`,
      borderRadius: 13,
      fontSize: 13.5,
      lineHeight: 1.52,
      boxSizing: "border-box" as const,
      background: theme.inputBg,
      color: theme.text,
      outline: "none",
      transition: "all 0.2s ease",
      boxShadow: focused === field ? theme.inputFocusRing : "none"
    }),
    textarea: (field: string) => ({
      width: "100%",
      minHeight: 88,
      padding: "12px 14px",
      border: `1px solid ${focused === field ? theme.inputFocusBorder : theme.inputBorder}`,
      borderRadius: 13,
      fontSize: 13.5,
      lineHeight: 1.52,
      boxSizing: "border-box" as const,
      background: theme.inputBg,
      color: theme.text,
      outline: "none",
      transition: "all 0.2s ease",
      boxShadow: focused === field ? theme.inputFocusRing : "none",
      resize: "vertical" as const
    }),
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
      lineHeight: 1.48
    },
    helperStandalone: {
      fontSize: 11.5,
      color: theme.helper,
      marginTop: 7,
      lineHeight: 1.48
    },
    previewButton: {
      marginTop: 12,
      width: "100%",
      padding: 12,
      background: theme.chipBg,
      color: theme.chipText,
      border: `1px solid ${theme.chipBorder}`,
      borderRadius: 14,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.2s ease",
      boxShadow: "0 6px 14px rgba(24, 30, 47, 0.08)"
    },
    previewCloseButton: {
      marginTop: 10,
      width: "100%",
      padding: 11,
      background: "transparent",
      color: theme.chipText,
      border: `1px solid ${theme.chipBorder}`,
      borderRadius: 12,
      fontSize: 12.5,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.2s ease"
    },
    previewResetButton: {
      marginTop: 4,
      width: "100%",
      padding: 10,
      background: "transparent",
      color: theme.helper,
      border: `1px dashed ${theme.chipBorder}`,
      borderRadius: 11,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.2s ease"
    },
    previewHint: {
      marginTop: 8,
      marginBottom: 0,
      fontSize: 11,
      color: theme.helper,
      lineHeight: 1.45
    },
    previewPanel: {
      marginTop: 14,
      padding: "14px 13px 12px",
      borderRadius: 14,
      border: `1px solid ${theme.chipBorder}`,
      background: theme.chipBg
    },
    controlBlock: {
      marginBottom: 12
    },
    rangeRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
      marginBottom: 8
    },
    rangeLabel: {
      fontSize: 12,
      color: theme.label,
      fontWeight: 600
    },
    rangeValue: {
      fontSize: 12,
      color: theme.helper,
      fontVariantNumeric: "tabular-nums"
    },
    rangeInput: {
      width: "100%",
      accentColor: theme.inputFocusBorder,
      cursor: "pointer"
    },
    modeChips: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap" as const
    },
    modeChip: (active: boolean) => ({
      padding: "6px 10px",
      borderRadius: 10,
      border: `1px solid ${active ? theme.chipActiveBorder : theme.chipBorder}`,
      background: active ? theme.chipActiveBg : theme.chipBg,
      color: active ? theme.chipActiveText : theme.chipText,
      fontSize: 11.5,
      lineHeight: 1.2,
      cursor: "pointer",
      transition: "all 0.18s ease"
    }),
    divider: {
      margin: "24px 0",
      border: "none",
      borderTop: `1px solid ${theme.divider}`
    },
    button: {
      width: "100%",
      padding: 13,
      background: saved ? theme.buttonSavedBg : theme.buttonBg,
      color: theme.buttonText,
      border: "none",
      borderRadius: 14,
      fontSize: 13.5,
      fontWeight: 650,
      cursor: "pointer",
      transition: "all 0.2s ease",
      boxShadow: "0 10px 20px rgba(24, 30, 47, 0.16)"
    },
    themeChip: (active: boolean) => ({
      padding: "8px 12px",
      borderRadius: 12,
      border: `1px solid ${active ? theme.chipActiveBorder : theme.chipBorder}`,
      background: active ? theme.chipActiveBg : theme.chipBg,
      color: active ? theme.chipActiveText : theme.chipText,
      fontSize: 12.5,
      lineHeight: 1.15,
      cursor: "pointer",
      transition: "all 0.18s ease"
    }),
    note: {
      marginTop: 13,
      fontSize: 10.5,
      color: theme.helper,
      textAlign: "center" as const,
      letterSpacing: "0.02em",
      lineHeight: 1.55
    }
  }
}

export default function OptionsPage() {
  const [apiKey, setApiKey] = useState("")
  const [apiUrl, setApiUrl] = useState("")
  const [model, setModel] = useState("deepseek-chat")
  const [debugMode, setDebugMode] = useState(false)
  const [section, setSection] = useState<NavSection>("basic")
  const [saved, setSaved] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const [themePreference, setThemePreference] = useState<ThemePreference>("system")
  const [version, setVersion] = useState("0.0.0")
  const [iconUrl, setIconUrl] = useState("")
  const [compact, setCompact] = useState(false)
  const [showToastPreview, setShowToastPreview] = useState(false)
  const [toastPreviewKey, setToastPreviewKey] = useState(0)
  const [toastPreviewMessage, setToastPreviewMessage] = useState(DEFAULT_TOAST_PREVIEW_PREFS.message)
  const [toastPrimaryLabel, setToastPrimaryLabel] = useState(DEFAULT_TOAST_PREVIEW_PREFS.primaryLabel)
  const [toastSecondaryLabel, setToastSecondaryLabel] = useState(DEFAULT_TOAST_PREVIEW_PREFS.secondaryLabel)
  const [toastEntryDurationMs, setToastEntryDurationMs] = useState(DEFAULT_TOAST_PREVIEW_PREFS.entryDurationMs)
  const [toastTopOffsetPx, setToastTopOffsetPx] = useState(DEFAULT_TOAST_PREVIEW_PREFS.topOffsetPx)
  const [toastPulseMode, setToastPulseMode] = useState<ToastPulseMode>(DEFAULT_TOAST_PREVIEW_PREFS.pulseMode)
  const [toastPrefsLoaded, setToastPrefsLoaded] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      if (!s) return
      setApiKey(s.apiKey ?? "")
      setApiUrl(s.apiUrl ?? "")
      setModel(s.model ?? "deepseek-chat")
      setDebugMode(s.debugMode ?? false)
    })
  }, [])

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setToastPrefsLoaded(true)
      return
    }

    chrome.storage.local
      .get([TOAST_PREVIEW_PREFS_STORAGE_KEY])
      .then((result) => {
        const prefs = normalizeToastPreviewPrefs(result[TOAST_PREVIEW_PREFS_STORAGE_KEY])
        setToastPreviewMessage(prefs.message)
        setToastPrimaryLabel(prefs.primaryLabel)
        setToastSecondaryLabel(prefs.secondaryLabel)
        setToastEntryDurationMs(prefs.entryDurationMs)
        setToastTopOffsetPx(prefs.topOffsetPx)
        setToastPulseMode(prefs.pulseMode)
      })
      .finally(() => {
        setToastPrefsLoaded(true)
      })
  }, [])

  useEffect(() => {
    if (!toastPrefsLoaded || typeof chrome === "undefined" || !chrome.storage?.local) {
      return
    }
    const prefs: ToastPreviewPrefs = {
      message: toastPreviewMessage,
      primaryLabel: toastPrimaryLabel,
      secondaryLabel: toastSecondaryLabel,
      entryDurationMs: toastEntryDurationMs,
      topOffsetPx: toastTopOffsetPx,
      pulseMode: toastPulseMode
    }
    chrome.storage.local.set({ [TOAST_PREVIEW_PREFS_STORAGE_KEY]: prefs })
  }, [toastPrefsLoaded, toastPreviewMessage, toastPrimaryLabel, toastSecondaryLabel, toastEntryDurationMs, toastTopOffsetPx, toastPulseMode])

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
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return
    }
    chrome.storage.local.set({ [THEME_PREF_STORAGE_KEY]: themePreference })
  }, [themePreference])

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
      setVersion(chrome.runtime.getManifest().version || "0.0.0")
    }
    setIconUrl(getExtensionIconUrl())
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
      htmlOverflowX: html.style.overflowX,
      htmlOverflowY: html.style.overflowY,
      htmlHeight: html.style.height,
      bodyMargin: body.style.margin,
      bodyPadding: body.style.padding,
      bodyBackground: body.style.background,
      bodyOverflowX: body.style.overflowX,
      bodyOverflowY: body.style.overflowY,
      bodyHeight: body.style.height,
      rootMargin: plasmoRoot?.style.margin ?? "",
      rootPadding: plasmoRoot?.style.padding ?? "",
      rootBackground: plasmoRoot?.style.background ?? "",
      rootWidth: plasmoRoot?.style.width ?? "",
      rootHeight: plasmoRoot?.style.height ?? ""
    }

    html.style.margin = "0"
    html.style.padding = "0"
    html.style.background = "transparent"
    html.style.overflowX = "hidden"
    html.style.overflowY = "hidden"
    html.style.height = "100%"
    body.style.margin = "0"
    body.style.padding = "0"
    body.style.background = "transparent"
    body.style.overflowX = "hidden"
    body.style.overflowY = "hidden"
    body.style.height = "100%"

    if (plasmoRoot) {
      plasmoRoot.style.margin = "0"
      plasmoRoot.style.padding = "0"
      plasmoRoot.style.background = "transparent"
      plasmoRoot.style.width = "100%"
      plasmoRoot.style.height = "100%"
    }

    return () => {
      html.style.margin = prev.htmlMargin
      html.style.padding = prev.htmlPadding
      html.style.background = prev.htmlBackground
      html.style.overflowX = prev.htmlOverflowX
      html.style.overflowY = prev.htmlOverflowY
      html.style.height = prev.htmlHeight
      body.style.margin = prev.bodyMargin
      body.style.padding = prev.bodyPadding
      body.style.background = prev.bodyBackground
      body.style.overflowX = prev.bodyOverflowX
      body.style.overflowY = prev.bodyOverflowY
      body.style.height = prev.bodyHeight
      if (plasmoRoot) {
        plasmoRoot.style.margin = prev.rootMargin
        plasmoRoot.style.padding = prev.rootPadding
        plasmoRoot.style.background = prev.rootBackground
        plasmoRoot.style.width = prev.rootWidth
        plasmoRoot.style.height = prev.rootHeight
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const onResize = () => setCompact(window.innerWidth < 820)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
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

  const handleSave = async () => {
    const current = await getSettings()
    const next = mergeSettings(current, {
      apiKey,
      apiUrl,
      model,
      debugMode
    })

    await saveSettings(next)
    chrome.runtime.sendMessage({ type: "DEBUG_MODE_CHANGED", payload: { debugMode } })

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handlePreviewToast = () => {
    setShowToastPreview(true)
    setToastPreviewKey((prev) => prev + 1)
  }

  const handleResetToastPreviewDefaults = () => {
    setToastPreviewMessage(DEFAULT_TOAST_PREVIEW_PREFS.message)
    setToastPrimaryLabel(DEFAULT_TOAST_PREVIEW_PREFS.primaryLabel)
    setToastSecondaryLabel(DEFAULT_TOAST_PREVIEW_PREFS.secondaryLabel)
    setToastEntryDurationMs(DEFAULT_TOAST_PREVIEW_PREFS.entryDurationMs)
    setToastTopOffsetPx(DEFAULT_TOAST_PREVIEW_PREFS.topOffsetPx)
    setToastPulseMode(DEFAULT_TOAST_PREVIEW_PREFS.pulseMode)
    if (showToastPreview) {
      setToastPreviewKey((prev) => prev + 1)
    }
  }

  const previewMessage = toastPreviewMessage.trim() || DEFAULT_TOAST_PREVIEW_PREFS.message
  const previewButtonOptions: [string, string] = [
    toastPrimaryLabel.trim() || DEFAULT_TOAST_PREVIEW_PREFS.primaryLabel,
    toastSecondaryLabel.trim() || DEFAULT_TOAST_PREVIEW_PREFS.secondaryLabel
  ]

  const theme = useMemo(() => createTheme(themeMode), [themeMode])
  const styles = useMemo(() => createStyles(theme, focused, saved, compact), [theme, focused, saved, compact])

  return (
    <div style={styles.page}>
      <div style={styles.haloTop} />
      <div style={styles.haloBottom} />

      <main style={styles.shell}>
        <header style={styles.topbar}>
          <div style={styles.brandWrap}>
            <img src={iconUrl || undefined} alt="AttentionNudge Logo" style={styles.logo} />
            <div>
              <p style={styles.brandTitle}>AttentionNudge</p>
              <div style={styles.version}>v{version}</div>
            </div>
          </div>

          <div style={styles.themeChips}>
            <button type="button" style={styles.themeChip(themePreference === "system")} onClick={() => setThemePreference("system")}>
              跟随系统
            </button>
            <button type="button" style={styles.themeChip(themePreference === "light")} onClick={() => setThemePreference("light")}>
              浅色
            </button>
            <button type="button" style={styles.themeChip(themePreference === "dark")} onClick={() => setThemePreference("dark")}>
              深色
            </button>
          </div>
        </header>

        <div style={styles.body}>
          <aside style={styles.sidebar}>
            <div style={styles.sidebarTitle}>导航</div>
            <nav style={styles.nav}>
              <button type="button" style={styles.navItem(section === "basic")} onClick={() => setSection("basic")}>
                基本设置
              </button>
              <button type="button" style={styles.navItem(section === "developer")} onClick={() => setSection("developer")}>
                开发者设置
              </button>
            </nav>
          </aside>

          <section style={styles.content}>
            {section === "basic" ? (
              <>
                <h1 style={styles.heading}>模型配置</h1>
                <p style={styles.subtitle}>设置 API URL、API Key 与模型名称。</p>

                <section style={styles.section}>
                  <label style={styles.label}>API URL</label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="https://api.deepseek.com"
                    style={styles.input("apiUrl")}
                    onFocus={() => setFocused("apiUrl")}
                    onBlur={() => setFocused(null)}
                  />
                </section>

                <section style={styles.section}>
                  <label style={styles.label}>API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    style={styles.input("apiKey")}
                    onFocus={() => setFocused("apiKey")}
                    onBlur={() => setFocused(null)}
                  />
                </section>

                <section style={styles.section}>
                  <label style={styles.label}>模型</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="deepseek-chat"
                    style={styles.input("model")}
                    onFocus={() => setFocused("model")}
                    onBlur={() => setFocused(null)}
                  />
                </section>
              </>
            ) : (
              <>
                <h1 style={styles.heading}>开发者设置</h1>
                <p style={styles.subtitle}>用于诊断状态机与 LLM 触发流程。</p>

                <section style={styles.section}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={debugMode}
                      onChange={(e) => setDebugMode(e.target.checked)}
                      style={styles.checkbox}
                    />
                    Debug 模式
                  </label>
                  <p style={styles.helperStandalone}>开启后在 Service Worker 与页面控制台输出详细状态。</p>

                  <div style={styles.previewPanel}>
                    <div style={styles.controlBlock}>
                      <label style={styles.label}>示例文案</label>
                      <textarea
                        rows={3}
                        value={toastPreviewMessage}
                        onChange={(e) => setToastPreviewMessage(e.target.value)}
                        style={styles.textarea("toastPreviewMessage")}
                        onFocus={() => setFocused("toastPreviewMessage")}
                        onBlur={() => setFocused(null)}
                      />
                    </div>

                    <div style={styles.controlBlock}>
                      <label style={styles.label}>主按钮文案</label>
                      <input
                        type="text"
                        value={toastPrimaryLabel}
                        onChange={(e) => setToastPrimaryLabel(e.target.value)}
                        style={styles.input("toastPrimaryLabel")}
                        onFocus={() => setFocused("toastPrimaryLabel")}
                        onBlur={() => setFocused(null)}
                      />
                    </div>

                    <div style={styles.controlBlock}>
                      <label style={styles.label}>次按钮文案</label>
                      <input
                        type="text"
                        value={toastSecondaryLabel}
                        onChange={(e) => setToastSecondaryLabel(e.target.value)}
                        style={styles.input("toastSecondaryLabel")}
                        onFocus={() => setFocused("toastSecondaryLabel")}
                        onBlur={() => setFocused(null)}
                      />
                    </div>

                    <div style={styles.controlBlock}>
                      <div style={styles.rangeRow}>
                        <span style={styles.rangeLabel}>入场时长</span>
                        <span style={styles.rangeValue}>{(toastEntryDurationMs / 1000).toFixed(2)}s</span>
                      </div>
                      <input
                        type="range"
                        min={360}
                        max={980}
                        step={20}
                        value={toastEntryDurationMs}
                        onChange={(e) => setToastEntryDurationMs(Number(e.target.value))}
                        style={styles.rangeInput}
                      />
                    </div>

                    <div style={styles.controlBlock}>
                      <div style={styles.rangeRow}>
                        <span style={styles.rangeLabel}>上边距</span>
                        <span style={styles.rangeValue}>{toastTopOffsetPx}px</span>
                      </div>
                      <input
                        type="range"
                        min={48}
                        max={180}
                        step={2}
                        value={toastTopOffsetPx}
                        onChange={(e) => setToastTopOffsetPx(Number(e.target.value))}
                        style={styles.rangeInput}
                      />
                    </div>

                    <div style={styles.controlBlock}>
                      <label style={styles.label}>脉冲强度</label>
                      <div style={styles.modeChips}>
                        <button type="button" style={styles.modeChip(toastPulseMode === "off")} onClick={() => setToastPulseMode("off")}>
                          关闭
                        </button>
                        <button type="button" style={styles.modeChip(toastPulseMode === "soft")} onClick={() => setToastPulseMode("soft")}>
                          柔和
                        </button>
                        <button type="button" style={styles.modeChip(toastPulseMode === "medium")} onClick={() => setToastPulseMode("medium")}>
                          明显
                        </button>
                      </div>
                    </div>

                    <button type="button" style={styles.previewResetButton} onClick={handleResetToastPreviewDefaults}>
                      恢复默认参数
                    </button>
                  </div>

                  <button type="button" style={styles.previewButton} onClick={handlePreviewToast}>
                    {showToastPreview ? "重新播放预览" : "预览干预弹窗样式"}
                  </button>
                  {showToastPreview ? (
                    <button type="button" style={styles.previewCloseButton} onClick={() => setShowToastPreview(false)}>
                      关闭预览
                    </button>
                  ) : null}
                  <p style={styles.previewHint}>用于样式调试，不会写入任何业务状态。</p>
                </section>
              </>
            )}

            <hr style={styles.divider} />

            <button onClick={handleSave} style={styles.button}>
              {saved ? "✓ 已保存" : "保存设置"}
            </button>

            <p style={styles.note}>
              主题偏好：{themePreference === "system" ? "跟随系统" : themePreference === "dark" ? "深色" : "浅色"} · 当前显示：
              {themeMode === "dark" ? "深色" : "浅色"}
            </p>
          </section>
        </div>
      </main>

      {showToastPreview ? (
        <InterventionToast
          key={toastPreviewKey}
          message={previewMessage}
          buttonOptions={previewButtonOptions}
          forceTheme={themeMode}
          entryDurationMs={toastEntryDurationMs}
          topOffsetPx={toastTopOffsetPx}
          pulseMode={toastPulseMode}
          onClose={() => setShowToastPreview(false)}
        />
      ) : null}
    </div>
  )
}
