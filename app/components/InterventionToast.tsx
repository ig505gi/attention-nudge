import { useState } from "react"

interface Props {
  message: string
  onFeedback: (up: boolean) => void
}

export default function InterventionToast({ message, onFeedback }: Props) {
  const [closed, setClosed] = useState(false)
  const [sent, setSent] = useState(false)

  if (closed) return null

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 320,
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        zIndex: 2147483647
      }}>
      <div style={{ fontSize: 14, color: "#333", marginBottom: 12, lineHeight: 1.5 }}>
        ⚓ {message}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setClosed(true)}
          style={{
            flex: 1,
            padding: 8,
            background: "#f3f4f6",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13
          }}>
          👍 知道了
        </button>
        <button
          onClick={() => {
            if (!sent) {
              onFeedback(false)
              setSent(true)
            }
          }}
          style={{
            flex: 1,
            padding: 8,
            background: sent ? "#22c55e" : "#fee2e2",
            color: sent ? "#fff" : "#dc2626",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13
          }}>
          {sent ? "✓ 已反馈" : "👎 不准确"}
        </button>
      </div>
    </div>
  )
}
