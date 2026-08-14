import { Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { apiFetch } from "../api";

type Props = {
  onAuth: (token: string, username: string) => void;
};

export default function AuthScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await apiFetch("/auth/register", null, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
      }
      const payload = (await apiFetch("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      })) as { access_token: string };
      onAuth(payload.access_token, username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>🧭 Meridian</h1>
          <p>个人资料仓库 · 您的 AI 管家</p>
        </div>
        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button>
        </div>
        <form onSubmit={submit}>
          <label className="field-label">用户名</label>
          <input className="field-input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={12} minLength={1} required autoComplete="username" placeholder="1–12 个字符" />
          <label className="field-label">密码</label>
          <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={12} minLength={6} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="6–12 个字符" />
          <button className="btn-primary auth-submit" type="submit" disabled={busy}>
            {busy && <Loader2 className="spin" size={16} />}
            {mode === "login" ? "进入仓库" : "创建账户"}
          </button>
        </form>
        {error && <div className="status-banner err">{error}</div>}
      </div>
    </div>
  );
}
