import { useState, useEffect } from "react"
import { getSettings, saveSettings, getUserGoal, saveUserGoal } from "~/lib/storage"
import type { Settings } from "~/lib/types"

function IndexPopup() {
  const [apiKey, setApiKey] = useState("")
  const [apiUrl, setApiUrl] = useState("")
  const [model, setModel] = useState("deepseek-chat")
  const [goal, setGoal] = useState("")
  const [debugMode, setDebugMode] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      if (s) {
        setApiKey(s.apiKey)
        setApiUrl(s.apiUrl)
        setModel(s.model)
        setDebugMode(s.debugMode ?? false)
      }
    })
    getUserGoal().then((g) => {
      if (g) setGoal(g.goal)
    })
  }, [])

  const handleSave = async () => {
    await saveSettings({ apiKey, apiUrl, model, debugMode } as Settings)
    await saveUserGoal(goal)
    // 通知 background debug 模式变化
    chrome.runtime.sendMessage({ type: "DEBUG_MODE_CHANGED", payload: { debugMode } })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div
      style={{
        padding: 16,
        width: 320,
        fontFamily: "system-ui, sans-serif"
      }}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>⚓ AttentionNudge</h2>

      <section style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#666" }}>
          当前任务
        </label>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：写 Python 爬虫"
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 14,
            boxSizing: "border-box"
          }}
        />
      </section>

      <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />

      <section style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#666" }}>
          API URL
        </label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="https://api.deepseek.com"
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 12,
            boxSizing: "border-box"
          }}
        />
      </section>

      <section style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#666" }}>
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 12,
            boxSizing: "border-box"
          }}
        />
      </section>

      <section style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
          />
          Debug 模式（开启后控制台输出详细状态）
        </label>
      </section>

      <section style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#666" }}>
          模型
        </label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="deepseek-chat"
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 12,
            boxSizing: "border-box"
          }}
        />
      </section>

      <button
        onClick={handleSave}
        style={{
          width: "100%",
          padding: 10,
          background: saved ? "#22c55e" : "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          cursor: "pointer",
          transition: "background 0.2s"
        }}>
        {saved ? "✓ 已保存" : "保存设置"}
      </button>

      <p style={{ fontSize: 11, color: "#999", marginTop: 12, textAlign: "center" }}>
        BYOK 模式 · 数据直连大模型，不经过任何服务器
      </p>
    </div>
  )
}

export default IndexPopup
