import { useCallback, useEffect, useState } from "react";
import * as api from "../../api";
import type { HermesStatus, HermesDetectedConfig } from "../../api";
import type { TFunction, LocalSettings, SetLocalSettings } from "./types";

interface HermesSettingsTabProps {
  t: TFunction;
  form: LocalSettings;
  setForm: SetLocalSettings;
  persistSettings: (next: LocalSettings) => void;
}

const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";

function PlatformBadge({ name, state }: { name: string; state: string }) {
  const connected = state === "connected";
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-slate-800/60 border border-slate-700/40">
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${connected ? "bg-green-400" : "bg-red-400"}`} />
      <span className="text-xs font-medium text-slate-300 capitalize">{name}</span>
      <span className={`ml-auto text-xs ${connected ? "text-green-400" : "text-red-400"}`}>
        {connected ? "connected" : state}
      </span>
    </div>
  );
}

export default function HermesSettingsTab({ t, form, setForm, persistSettings }: HermesSettingsTabProps) {
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [urlDraft, setUrlDraft] = useState(form.hermesApiUrl ?? DEFAULT_HERMES_URL);
  const [keyDraft, setKeyDraft] = useState(form.hermesApiKey ?? "");

  const [detected, setDetected] = useState<HermesDetectedConfig | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await api.getHermesStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  function handleSave() {
    const next = { ...form, hermesApiUrl: urlDraft.trim() || DEFAULT_HERMES_URL, hermesApiKey: keyDraft.trim() };
    setForm(next);
    persistSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setTimeout(() => void loadStatus(), 300);
  }

  async function handleDetect() {
    setDetectLoading(true);
    setDetectError(null);
    setDetected(null);
    try {
      const result = await api.detectHermesConfig();
      setDetected(result);
    } catch {
      setDetectError(t({ ko: "설정 파일을 읽을 수 없습니다", en: "Could not read config file", ja: "設定ファイルを読み込めません", zh: "无法读取配置文件" }));
    } finally {
      setDetectLoading(false);
    }
  }

  async function handleApply() {
    if (!detected?.api_key_found) return;
    setApplying(true);
    try {
      const result = await api.applyDetectedHermesConfig(true);
      if (result.ok) {
        setUrlDraft(result.api_url);
        setKeyDraft("••••••••");
        setDetected(null);
        // reload form from server
        const next = { ...form, hermesApiUrl: result.api_url, hermesApiKey: "__applied__" };
        setForm(next);
        persistSettings(next);
        setTimeout(() => void loadStatus(), 400);
      }
    } catch {
      setDetectError(t({ ko: "적용 실패", en: "Apply failed", ja: "適用失敗", zh: "应用失败" }));
    } finally {
      setApplying(false);
    }
  }

  const connected = status?.connected ?? false;
  const gatewayState = status?.gateway?.state;
  const platforms = status?.gateway?.platforms ?? {};
  const activeAgents = status?.gateway?.active_agents ?? 0;

  return (
    <div className="space-y-5">
      {/* Connection status banner */}
      <div
        className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
          statusLoading
            ? "bg-slate-800/60 border-slate-700/40"
            : connected
              ? "bg-green-900/20 border-green-700/40"
              : "bg-red-900/20 border-red-700/40"
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full flex-shrink-0 ${
            statusLoading ? "bg-slate-500 animate-pulse" : connected ? "bg-green-400" : "bg-red-400"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
            {statusLoading
              ? t({ ko: "Hermes 연결 확인 중…", en: "Checking Hermes connection…", ja: "Hermes接続を確認中…", zh: "正在检查 Hermes 连接…" })
              : connected
                ? t({ ko: "Hermes 연결됨", en: "Hermes Connected", ja: "Hermes 接続済み", zh: "Hermes 已连接" })
                : t({ ko: "Hermes 연결 실패", en: "Hermes Disconnected", ja: "Hermes 未接続", zh: "Hermes 未连接" })}
          </p>
          {!statusLoading && status && (
            <p className="text-xs text-slate-400 mt-0.5">
              {connected
                ? `${status.api.platform ?? "hermes-agent"} · ${t({ ko: "활성 에이전트", en: "active agents", ja: "アクティブエージェント", zh: "活跃代理" })} ${activeAgents}${gatewayState ? ` · gateway ${gatewayState}` : ""}`
                : (status.api.error ?? t({ ko: "응답 없음", en: "no response", ja: "応答なし", zh: "无响应" }))}
            </p>
          )}
        </div>
        <button
          onClick={() => void loadStatus()}
          disabled={statusLoading}
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded border border-slate-700/50 hover:border-slate-600 disabled:opacity-40"
        >
          {t({ ko: "새로고침", en: "Refresh", ja: "更新", zh: "刷新" })}
        </button>
      </div>

      {/* Auto-detect section */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--th-text-heading)" }}>
              {t({ ko: "~/.hermes/config.yaml 에서 자동 감지", en: "Auto-detect from ~/.hermes/config.yaml", ja: "~/.hermes/config.yaml から自動検出", zh: "从 ~/.hermes/config.yaml 自动检测" })}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t({ ko: "API_SERVER_KEY 를 자동으로 읽어옵니다", en: "Reads API_SERVER_KEY automatically", ja: "API_SERVER_KEY を自動で読み込みます", zh: "自动读取 API_SERVER_KEY" })}
            </p>
          </div>
          <button
            onClick={() => void handleDetect()}
            disabled={detectLoading}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-40"
          >
            {detectLoading
              ? t({ ko: "감지 중…", en: "Detecting…", ja: "検出中…", zh: "检测中…" })
              : t({ ko: "감지", en: "Detect", ja: "検出", zh: "检测" })}
          </button>
        </div>

        {detectError && (
          <p className="text-xs text-red-400">{detectError}</p>
        )}

        {detected && (
          <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${detected.api_key_found ? "bg-green-400" : "bg-red-400"}`} />
              <span className="text-xs text-slate-300">
                {detected.api_key_found
                  ? t({ ko: `API Key 감지됨 (${detected.api_key_preview})`, en: `API Key found (${detected.api_key_preview})`, ja: `API Key 検出済み (${detected.api_key_preview})`, zh: `检测到 API Key (${detected.api_key_preview})` })
                  : t({ ko: "API Key 없음", en: "No API Key found", ja: "API Key なし", zh: "未找到 API Key" })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">URL:</span>
              <span className="text-xs text-slate-300 font-mono">{detected.api_url}</span>
            </div>
            {detected.api_key_found && (
              <button
                onClick={() => void handleApply()}
                disabled={applying}
                className="w-full mt-1 rounded-lg py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40"
              >
                {applying
                  ? t({ ko: "적용 중…", en: "Applying…", ja: "適用中…", zh: "应用中…" })
                  : t({ ko: "이 설정으로 적용", en: "Apply this config", ja: "この設定を適用", zh: "应用此配置" })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* API Endpoint */}
      <div className="space-y-2">
        <label className="block text-sm font-medium" style={{ color: "var(--th-text-heading)" }}>
          {t({ ko: "Hermes API URL", en: "Hermes API URL", ja: "Hermes API URL", zh: "Hermes API URL" })}
        </label>
        <input
          type="text"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder={DEFAULT_HERMES_URL}
          className="w-full rounded-lg px-3 py-2 text-sm bg-slate-800/60 border border-slate-700/50 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-slate-500">
          {t({ ko: "기본값:", en: "Default:", ja: "デフォルト:", zh: "默认值:" })} {DEFAULT_HERMES_URL}
        </p>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="block text-sm font-medium" style={{ color: "var(--th-text-heading)" }}>
          {t({ ko: "API Key", en: "API Key", ja: "API キー", zh: "API 密钥" })}
        </label>
        <input
          type="password"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          placeholder={t({ ko: "Hermes API_SERVER_KEY 입력", en: "Enter Hermes API_SERVER_KEY", ja: "Hermes API_SERVER_KEY を入力", zh: "输入 Hermes API_SERVER_KEY" })}
          className="w-full rounded-lg px-3 py-2 text-sm bg-slate-800/60 border border-slate-700/50 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-slate-500">
          {t({ ko: "~/.hermes/config.yaml 의 API_SERVER_KEY 값", en: "API_SERVER_KEY from ~/.hermes/config.yaml", ja: "~/.hermes/config.yaml の API_SERVER_KEY の値", zh: "~/.hermes/config.yaml 中的 API_SERVER_KEY 值" })}
        </p>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        className="rounded-lg px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
      >
        {saved
          ? t({ ko: "저장됨 ✓", en: "Saved ✓", ja: "保存済み ✓", zh: "已保存 ✓" })
          : t({ ko: "저장", en: "Save", ja: "保存", zh: "保存" })}
      </button>

      {/* Gateway platforms */}
      {Object.keys(platforms).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t({ ko: "Gateway 플랫폼", en: "Gateway Platforms", ja: "ゲートウェイプラットフォーム", zh: "网关平台" })}
          </p>
          <div className="space-y-1.5">
            {Object.entries(platforms).map(([name, info]) => (
              <PlatformBadge key={name} name={name} state={info.state} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
