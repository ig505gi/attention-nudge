import { useState, useEffect, useMemo } from "react"

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
  /** 两个按钮的 RPG 文案，默认随机从池中抽取。留空则自动生成。 */
  buttonOptions?: [string, string]
  /** 不再支持自动消失 — 弹窗停留直到用户点击按钮，给人紧迫感。 */
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ACCENT = "#0F766E"

function createStyles(isDark: boolean) {
  const bg = isDark ? "#1E1E2E" : "#FFFFFF"
  const text = isDark ? "#F0F0F0" : "#1A1A2E"
  const text2 = isDark ? "#A0A0B0" : "#6B7280"
  const border = isDark ? "#3A3A4C" : "#E5E7EB"
  const divider = isDark ? "#2E2E3E" : "#F0F0F0"
  const accent = isDark ? "#34D399" : ACCENT
  const neutralBg = isDark ? "#2A2A3A" : "#F3F4F6"
  const neutralHover = isDark ? "#363648" : "#E5E7EB"
  const actionBg = isDark ? "#1E2A2A" : "#F0FDFB"
  const actionHover = isDark ? "#263336" : "#CCFBF1"
  const actionText = isDark ? "#34D399" : "#0F766E"

  return {
    wrapper: {
      position: "fixed" as const,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "100%",
      maxWidth: 680,
      zIndex: 2147483647,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif',
      padding: "0 24px",
      boxSizing: "border-box" as const,
    },
    card: {
      background: bg,
      borderRadius: 12,
      border: `1px solid ${border}`,
      boxShadow: isDark
        ? "0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.25)"
        : "0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)",
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "13px 16px",
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 8,
      background: "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    label: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.05em",
      textTransform: "uppercase" as const,
      color: accent,
      marginBottom: 2,
    },
    message: {
      fontSize: 14,
      color: text,
      lineHeight: 1.5,
    },
    divider: {
      width: 1,
      height: 32,
      background: divider,
      flexShrink: 0,
    },
    actions: {
      display: "flex",
      flexDirection: "column" as const,
      gap: 4,
      flexShrink: 0,
    },
    btnBase: {
      padding: "6px 14px",
      border: `1px solid ${border}`,
      borderRadius: 7,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 500,
      transition: "all 0.18s ease",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif',
      textAlign: "left" as const,
      lineHeight: 1.4,
    },
    btnPrimary: {
      background: actionBg,
      color: actionText,
      borderColor: isDark ? "#1A3530" : "#A7F3D0",
    },
    btnPrimaryHover: {
      background: actionHover,
    },
    btnSecondary: {
      background: neutralBg,
      color: text2,
      borderColor: "transparent",
    },
    btnSecondaryHover: {
      background: neutralHover,
      color: text,
    },
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function InterventionToast({
  message,
  buttonOptions,
}: Props) {
  const [closed, setClosed] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(false)

  // Pick random buttons
  const options = useMemo<[string, string]>(() => {
    if (buttonOptions?.[0] && buttonOptions?.[1]) {
      return buttonOptions
    }
    const pick =
      RPG_BUTTON_POOL[Math.floor(Math.random() * RPG_BUTTON_POOL.length)]
    return pick
  }, [buttonOptions])

  // Auto-dismiss 已移除，弹窗停留直到用户主动点击

  // Detect dark mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setIsDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  if (closed) return null

  const s = createStyles(isDark)

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
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% - 14px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
      <div style={s.wrapper}>
        <div style={{ ...s.card, position: "relative" as const, animation: "toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
          {/* Icon */}
          <div style={s.iconWrap}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDark ? "#34D399" : "#0F766E"}
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
            <div style={s.label}>专注提醒</div>
            <p style={s.message}>{message}</p>
          </div>

          {/* Vertical divider */}
          <div style={s.divider} />

          {/* RPG Action buttons */}
          <div style={s.actions}>
            <button
              style={primaryStyle}
              onClick={() => setClosed(true)}
              onMouseEnter={() => setHoveredBtn("primary")}
              onMouseLeave={() => setHoveredBtn(null)}
            >
              {options[0]}
            </button>
            <button
              style={secondaryStyle}
              onClick={() => setClosed(true)}
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
