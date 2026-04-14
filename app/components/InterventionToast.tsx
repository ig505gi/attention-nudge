import { useEffect, useMemo, useState } from "react"

// ─── RPG Button Pool ─────────────────────────────────────────────────────────
// 左侧：接受/认同类（继续专注）  右侧：轻松化解类（给自己台阶）
const RPG_BUTTON_POOL: [string, string][] = [
  ["好的，回到任务", "就逛一会儿…"],
  ["知道了，继续干", "好吧，再看五分钟"],
  ["记下了，撤", "但这个真的很有趣"],
  ["明白了，专注", "就瞄一眼…"],
  ["收到，回归正题", "再刷最后一条"],
  ["嗯，回神了", "等我看完这个"],
  ["了解，稳住", "让我先收藏一下"],
  ["好的，切换模式", "啊这个我必须看看"],
  ["知道了，收心", "就查一个东西"],
  ["明白，专注模式开启", "等下，这个很重要"],
  ["收到，走了", "让我先截个图"],
  ["好的，回来", "但我想了解下这个"],
  ["嗯，记住了", "这文章必须读完"],
]

interface Props {
  message: string
  buttonOptions?: [string, string]
  forceTheme?: "light" | "dark"
  entryDurationMs?: number
  topOffsetPx?: number
  pulseMode?: "off" | "soft" | "medium"
  onClose?: (choice: "primary" | "secondary") => void
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const FONT_BODY =
  'ui-rounded, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif'

function createStyles(
  themeMode: "light" | "dark",
  compact: boolean,
  topOffsetPx?: number,
  pulseMode: "off" | "soft" | "medium" = "soft"
) {
  const isDark = themeMode === "dark"
  const cardBg = isDark
    ? "linear-gradient(160deg, rgba(23, 31, 50, 0.97) 0%, rgba(17, 24, 41, 0.97) 100%)"
    : "linear-gradient(160deg, rgba(255, 255, 255, 0.97) 0%, rgba(255, 251, 243, 0.97) 100%)"
  const border = isDark ? "rgba(170, 185, 216, 0.24)" : "rgba(44, 49, 64, 0.14)"
  const shadow = isDark
    ? "0 18px 44px rgba(4, 9, 20, 0.52), 0 3px 12px rgba(4, 9, 20, 0.34)"
    : "0 18px 42px rgba(24, 38, 63, 0.18), 0 2px 10px rgba(24, 38, 63, 0.1)"
  const pulseShadowSoft = isDark
    ? "0 24px 52px rgba(4, 9, 20, 0.58), 0 0 0 1px rgba(243, 154, 70, 0.2)"
    : "0 22px 48px rgba(24, 38, 63, 0.22), 0 0 0 1px rgba(243, 154, 70, 0.2)"
  const pulseShadowMedium = isDark
    ? "0 28px 56px rgba(4, 9, 20, 0.62), 0 0 0 1px rgba(243, 154, 70, 0.28)"
    : "0 26px 52px rgba(24, 38, 63, 0.26), 0 0 0 1px rgba(243, 154, 70, 0.28)"
  const pulseShadow = pulseMode === "medium" ? pulseShadowMedium : pulseMode === "soft" ? pulseShadowSoft : shadow
  const text = isDark ? "#E7EEFC" : "#3E4D63"
  const iconStroke = isDark ? "#FFCAA2" : "#B95D1D"
  const iconBg = isDark
    ? "linear-gradient(145deg, rgba(243, 154, 70, 0.22), rgba(139, 136, 232, 0.2))"
    : "linear-gradient(145deg, rgba(243, 154, 70, 0.2), rgba(139, 136, 232, 0.18))"
  const primaryBg = "linear-gradient(140deg, #F39A46 0%, #8B88E8 100%)"
  const primaryShadow = isDark ? "0 8px 18px rgba(5, 8, 18, 0.42)" : "0 8px 18px rgba(31, 45, 74, 0.2)"
  const secondaryBg = isDark ? "rgba(27, 37, 60, 0.84)" : "rgba(255, 255, 255, 0.84)"
  const secondaryHover = isDark ? "rgba(36, 47, 74, 0.94)" : "rgba(249, 252, 255, 1)"
  const secondaryBorder = isDark ? "rgba(170, 185, 216, 0.26)" : "rgba(44, 49, 64, 0.16)"
  const secondaryText = isDark ? "#D4E0F7" : "#556A82"
  const top = typeof topOffsetPx === "number" ? `${topOffsetPx}px` : "clamp(56px, 14vh, 132px)"

  return {
    wrapper: {
      position: "fixed" as const,
      top,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 760,
      zIndex: 2147483647,
      fontFamily: FONT_BODY,
      padding: compact ? "0 12px" : "0 20px",
      boxSizing: "border-box" as const,
      pointerEvents: "none" as const
    },
    card: {
      background: cardBg,
      borderRadius: 18,
      border: `1px solid ${border}`,
      boxShadow: shadow,
      display: "flex",
      alignItems: compact ? "stretch" : "center",
      gap: compact ? 10 : 14,
      flexWrap: "wrap" as const,
      padding: compact ? "12px 12px 11px" : "15px 17px",
      pointerEvents: "auto" as const
    },
    iconWrap: {
      width: compact ? 34 : 40,
      height: compact ? 34 : 40,
      borderRadius: compact ? 12 : 14,
      background: iconBg,
      border: `1px solid ${isDark ? "rgba(255, 227, 200, 0.2)" : "rgba(44, 49, 64, 0.12)"}`,
      boxShadow: isDark ? "inset 0 1px 0 rgba(255, 255, 255, 0.05)" : "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      animation: "toastIconPulse 2.6s ease-in-out 0.5s 2"
    },
    content: {
      flex: compact ? "1 1 100%" : "1 1 240px",
      minWidth: 0
    },
    message: {
      margin: 0,
      fontSize: compact ? 13.5 : 14,
      fontWeight: 500,
      color: text,
      lineHeight: 1.56,
      overflowWrap: "anywhere" as const,
      wordBreak: "break-word" as const
    },
    actions: {
      display: "flex",
      gap: 8,
      flexShrink: 1,
      flexWrap: "wrap" as const,
      marginLeft: compact ? 0 : "auto",
      minWidth: 0,
      width: compact ? "100%" : undefined,
      justifyContent: compact ? ("stretch" as const) : ("flex-end" as const)
    },
    btnBase: {
      padding: "9px 13px",
      borderRadius: 12,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12.5,
      fontWeight: 600,
      transition: "all 0.18s ease",
      fontFamily: FONT_BODY,
      textAlign: "center" as const,
      lineHeight: 1.25,
      minWidth: compact ? 0 : 126,
      flex: compact ? "1 1 100%" : "1 1 168px",
      maxWidth: "100%",
      whiteSpace: "normal" as const,
      overflowWrap: "anywhere" as const,
      wordBreak: "break-word" as const
    },
    btnPrimary: {
      background: primaryBg,
      color: "#FFFFFF",
      border: "none",
      boxShadow: primaryShadow
    },
    btnPrimaryHover: {
      filter: "brightness(1.06)"
    },
    btnSecondary: {
      background: secondaryBg,
      color: secondaryText,
      border: `1px solid ${secondaryBorder}`
    },
    btnSecondaryHover: {
      background: secondaryHover,
      color: text
    },
    iconStroke,
    shadow,
    pulseShadow
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function InterventionToast({
  message,
  buttonOptions,
  forceTheme,
  entryDurationMs,
  topOffsetPx,
  pulseMode = "soft",
  onClose
}: Props) {
  const [closed, setClosed] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<"light" | "dark">(forceTheme ?? "light")
  const [compact, setCompact] = useState(false)

  // Pick random buttons
  const options = useMemo<[string, string]>(() => {
    if (buttonOptions?.[0] && buttonOptions?.[1]) {
      return buttonOptions
    }
    const pick =
      RPG_BUTTON_POOL[Math.floor(Math.random() * RPG_BUTTON_POOL.length)]
    return pick
  }, [buttonOptions])

  // Detect dark mode
  useEffect(() => {
    if (forceTheme) {
      setThemeMode(forceTheme)
      return
    }

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setThemeMode("light")
      return
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setThemeMode(mq.matches ? "dark" : "light")

    const handler = (e: MediaQueryListEvent) => setThemeMode(e.matches ? "dark" : "light")
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    }

    mq.addListener(handler)
    return () => mq.removeListener(handler)
  }, [forceTheme])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const onResize = () => setCompact(window.innerWidth < 560)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  if (closed) return null

  const safeEntryDuration = Math.max(320, Math.min(1200, entryDurationMs ?? 620))
  const safeTopOffset = typeof topOffsetPx === "number" ? Math.max(40, Math.min(260, topOffsetPx)) : undefined
  const s = createStyles(themeMode, compact, safeTopOffset, pulseMode)
  const pulseAnim =
    pulseMode === "off"
      ? ""
      : `, toastCardPulse ${pulseMode === "medium" ? "2.1s" : "2.4s"} ease-in-out ${Math.round(safeEntryDuration * 1.15)}ms 2`

  const handleClose = (choice: "primary" | "secondary") => {
    setClosed(true)
    onClose?.(choice)
  }

  const primaryStyle = {
    ...s.btnBase,
    ...s.btnPrimary,
    ...(hoveredBtn === "primary" ? s.btnPrimaryHover : {}),
  }
  const secondaryStyle = {
    ...s.btnBase,
    ...s.btnSecondary,
    ...(hoveredBtn === "secondary" ? s.btnSecondaryHover : {}),
  }

  return (
    <>
      <style>{`
        @keyframes toastSlideInSoft {
          from { opacity: 0; transform: translateY(-14px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastCardPulse {
          0%, 100% { box-shadow: ${s.shadow}; }
          50% { box-shadow: ${s.pulseShadow}; }
        }
        @keyframes toastIconPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
      <div style={s.wrapper}>
        <div
          style={{
            ...s.card,
            position: "relative" as const,
            animation: `toastSlideInSoft ${safeEntryDuration}ms cubic-bezier(0.16, 0.84, 0.2, 1) both${pulseAnim}`
          }}>
          {/* Icon */}
          <div style={s.iconWrap}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={s.iconStroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="2" />
              <line x1="12" y1="7" x2="12" y2="22" />
              <path d="M5 12 H19" />
              <path d="M8 22 Q12 17 16 22" />
            </svg>
          </div>

          {/* Content */}
          <div style={s.content}>
            <p style={s.message}>{message}</p>
          </div>

          {/* RPG Action buttons */}
          <div style={s.actions}>
            <button
              style={primaryStyle}
              onClick={() => handleClose("primary")}
              onMouseEnter={() => setHoveredBtn("primary")}
              onMouseLeave={() => setHoveredBtn(null)}
            >
              {options[0]}
            </button>
            <button
              style={secondaryStyle}
              onClick={() => handleClose("secondary")}
              onMouseEnter={() => setHoveredBtn("secondary")}
              onMouseLeave={() => setHoveredBtn(null)}
            >
              {options[1]}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
