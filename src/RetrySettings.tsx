import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { GatewaySettings } from "../shared/types";
import { Check, RotateCcw, Save } from "lucide-react";
import { Button, Input, Select, Switch, TextArea, toast } from "./ui";
import { routingSettingKeys, routingSettingsPatch } from "./settings-patch";
import "./retry-settings.css";

type Props = {
  settings: GatewaySettings;
  onSave: (settings: GatewaySettings, patch: Partial<GatewaySettings>) => Promise<void>;
  saving?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
};
type NumericField = {
  title: string;
  description: string;
  min: number;
  max: number;
  unit?: string;
  step?: number;
};
const numericFields = {
  maxChannelRetries: { title: "跨渠道重试", description: "失败后，最多切换到其他渠道的次数。", min: 0, max: 10 },
  maxSameChannelRetries: { title: "同渠道重试", description: "切换渠道前，在同一渠道再次尝试的次数。", min: 0, max: 5 },
  retryDelayMs: { title: "重试间隔", description: "两次尝试之间的等待时间。", min: 100, max: 10000, unit: "ms" },
  streamFirstTokenTimeout: { title: "首字超时", description: "等待第一个有效内容事件；0 表示关闭。", min: 0, max: 600, unit: "s", step: 0.1 },
  nonStreamTimeout: { title: "完整响应超时", description: "等待完整响应的最长时间；0 表示关闭。", min: 0, max: 600, unit: "s", step: 0.1 },
  threshold: { title: "首字阈值", description: "连续满窗口且均超过阈值时降级。", min: 0.001, max: 600, unit: "s", step: 0.001 },
  responseThreshold: { title: "完整响应阈值", description: "非流式请求的平均完成延迟上限。", min: 0.001, max: 600, unit: "s", step: 0.001 },
  window: { title: "请求窗口", description: "两种响应方式独立统计。", min: 1, max: 1000, unit: "次" },
  windowSeconds: { title: "时间窗口", description: "仅统计该时间内的请求；0 表示不限。", min: 0, max: 86400, unit: "s" },
  samples: { title: "最少样本数", description: "用于失败比例和非流式平均耗时判定。", min: 1, max: 1000, unit: "次" },
  cooldown: { title: "恢复冷却", description: "冷却结束后进入探测恢复。", min: 1, max: 86400, unit: "s" },
  recovery: { title: "恢复次数", description: "连续健康探测达到次数后恢复正常调度。", min: 1, max: 100, unit: "次" },
  autoDisableThreshold: { title: "错误阈值", description: "成功请求将重置连续错误计数。", min: 1, max: 100, unit: "次" },
  autoDisableCooldown: { title: "禁用冷却", description: "冷却结束后允许探测恢复。", min: 1, max: 86400, unit: "s" },
} satisfies Partial<Record<keyof GatewaySettings, NumericField>>;
type NumericKey = keyof typeof numericFields;
const integerFields = new Set<NumericKey>(['maxChannelRetries', 'maxSameChannelRetries', 'retryDelayMs', 'window', 'windowSeconds', 'samples', 'recovery', 'autoDisableThreshold']);
const strategyNames: Record<GatewaySettings["strategy"], string> = {
  failover: "故障转移", adaptive: "自适应", "round-robin": "轮询", weighted: "加权随机", "circuit-breaker": "熔断保护",
};
const routingKeys = routingSettingKeys;
const routingSignature = (value: GatewaySettings) => JSON.stringify(Object.fromEntries(routingKeys.map(key => [key, value[key]])));

export default function RetrySettings({ settings, onSave, saving = false, onDirtyChange, onSavingChange }: Props) {
  const [draft, setDraft] = useState(settings);
  const [baseline, setBaseline] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [statuses, setStatuses] = useState(settings.retryStatuses.join(", "));
  const [disableStatuses, setDisableStatuses] = useState(settings.autoDisableStatuses.join(", "));
  const [numericText, setNumericText] = useState<Partial<Record<NumericKey, string>>>({});
  const dirty = routingSignature(draft) !== routingSignature(baseline) || statuses !== baseline.retryStatuses.join(", ") || disableStatuses !== baseline.autoDisableStatuses.join(", ") || (Object.keys(numericText) as NumericKey[]).some(key => numericText[key] !== String(baseline[key]));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reporting = useRef({ onDirtyChange, onSavingChange });
  reporting.current = { onDirtyChange, onSavingChange };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange?.(busy || saving); }, [busy, saving, onSavingChange]);
  useEffect(() => () => {
    reporting.current.onDirtyChange?.(false);
    reporting.current.onSavingChange?.(false);
  }, []);
  const settingsSignature = routingSignature(settings);
  const serverChanged = dirty && settingsSignature !== routingSignature(baseline);
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(settings);
    setBaseline(settings);
    setStatuses(settings.retryStatuses.join(", "));
    setDisableStatuses(settings.autoDisableStatuses.join(", "));
    setNumericText({});
  }, [settingsSignature, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function reset() {
    setDraft(settings);
    setBaseline(settings);
    setStatuses(settings.retryStatuses.join(", "));
    setDisableStatuses(settings.autoDisableStatuses.join(", "));
    setNumericText({});
    setSaveError(null);
  }
  const change = <K extends keyof GatewaySettings>(key: K, value: GatewaySettings[K]) => setDraft(old => ({ ...old, [key]: value }));
  const field = (key: NumericKey) => {
    const spec: NumericField = numericFields[key];
    return (
      <label className="rs-field">
        <strong>{spec.title}</strong>
        <span><Input type="number" min={spec.min} max={spec.max} step={spec.step ?? 1}
          value={numericText[key] ?? String(draft[key])} aria-label={spec.title}
          onChange={event => {
            const text = event.target.value;
            setNumericText(old => ({ ...old, [key]: text }));
            change(key, Number(text));
          }} />{spec.unit && <em>{spec.unit}</em>}</span>
        <small>{spec.description}</small>
      </label>
    );
  };
  const toggle = (key: keyof GatewaySettings, title: string, description: string) => (
    <div className="rs-toggle"><span><strong>{title}</strong><small>{description}</small></span>
      <Switch aria-label={title} checked={Boolean(draft[key])} onChange={event => change(key, event.target.checked as never)} />
    </div>
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || saving || !dirty || serverChanged) return;
    const parse = (text: string) => {
      const list = text.split(/[,，\s]+/).filter(Boolean).map(Number);
      if (list.some(value => !Number.isInteger(value) || value < 400 || value > 599))
        throw new Error("错误状态码须为 400–599，使用逗号分隔");
      return [...new Set(list)];
    };
    try {
      for (const key of Object.keys(numericFields) as NumericKey[]) {
        const spec: NumericField = numericFields[key];
        const text = numericText[key] ?? String(draft[key]);
        const value = Number(text);
        if (!text.trim()) throw new Error(`请填写${spec.title}`);
        if (!Number.isFinite(value) || value < spec.min || value > spec.max)
          throw new Error(`${spec.title}须在 ${spec.min}–${spec.max}${spec.unit ?? ""} 之间`);
        if (integerFields.has(key) && !Number.isInteger(value))
          throw new Error(`${spec.title}须为整数`);
      }
      if (draft.errorMode === "custom" && !draft.customErrorMessage.trim()) throw new Error("请填写自定义错误消息");
      const value = { ...settings, ...Object.fromEntries(routingKeys.map(key => [key, draft[key]])), retryStatuses: parse(statuses), autoDisableStatuses: parse(disableStatuses) } as GatewaySettings;
      if (value.samples > value.window) throw new Error("最少样本数不能大于最近请求窗口");
      setBusy(true);
      setSaveError(null);
      await onSave(value, routingSettingsPatch(baseline, value));
      setDraft(value);
      setBaseline(value);
      setStatuses(value.retryStatuses.join(", "));
      setDisableStatuses(value.autoDisableStatuses.join(", "));
      setNumericText({});
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }));
      toast.success("调度与重试策略已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setSaveError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="rs-root" onSubmit={save} noValidate>
      <div className="rs-toolbar">
        <span className={dirty ? "rs-status rs-status-dirty" : "rs-status"} role="status">{dirty ? "未保存" : <><Check size={13} />{savedAt ? "已保存 " + savedAt : "已同步"}</>}</span>
        <div><Button type="button" variant="tertiary" size="sm" disabled={!dirty || busy || saving} onClick={reset}><RotateCcw size={14} />{serverChanged ? "重新载入" : "放弃更改"}</Button><Button variant="primary" size="sm" type="submit" disabled={!dirty || serverChanged || busy || saving}><Save size={14} />{busy || saving ? "保存中…" : "保存更改"}</Button></div>
      </div>
      {serverChanged && <p className="rs-server-update" role="alert">服务器策略已更新，草稿已保留。请重新载入后继续编辑。</p>}
      {saveError && <p className="rs-save-error" role="alert">{saveError}</p>}
      <fieldset className="rs-fields" disabled={busy || saving} aria-label="调度策略配置">
        <section className="rs-section">
          <header><h3>路由</h3><p>{strategyNames[draft.strategy]}</p></header>
          <div className="rs-section-content"><div className="rs-grid">
            <label className="rs-field"><strong>调度方式</strong><Select aria-label="负载均衡策略" value={draft.strategy} onChange={event => change("strategy", event.target.value as GatewaySettings["strategy"])}><option value="failover">故障转移</option><option value="adaptive">自适应延迟</option><option value="round-robin">轮询</option><option value="weighted">加权随机</option><option value="circuit-breaker">熔断保护</option></Select><small>{draft.strategy === "adaptive" ? "健康渠道优先选择平均延迟较低的上游。" : "在授权且健康的渠道间调度。"}</small></label>
            <label className="rs-field"><strong>会话粘性</strong><Select aria-label="会话粘性" value={draft.stickyMode} onChange={event => change("stickyMode", event.target.value as GatewaySettings["stickyMode"])}><option value="prefer">优先最近的健康渠道</option><option value="off">关闭</option></Select><small>通过 trace / thread 关联会话。</small></label>
          </div></div>
        </section>
        <section className="rs-section">
          <header><h3>重试</h3><p>{draft.retryEnabled ? "已启用" : "已关闭"}</p></header>
          <div className="rs-section-content">
            {toggle("retryEnabled", "自动重试", "仅在开始输出前重试，已输出的内容不会跨渠道拼接。")}
            <div className="rs-grid">{field("maxChannelRetries")}{field("maxSameChannelRetries")}{field("retryDelayMs")}<label className="rs-field"><strong>重试状态码</strong><Input aria-label="可重试状态码" value={statuses} onChange={event => setStatuses(event.target.value)} placeholder="408, 429, 500, 502, 503, 504" /><small>逗号分隔；留空关闭状态码重试。</small></label>{field("streamFirstTokenTimeout")}{field("nonStreamTimeout")}</div>
            {draft.streamFirstTokenTimeout > 0 && draft.streamFirstTokenTimeout <= draft.threshold && <p className="rs-group-note">首字超时不高于健康阈值，请求会先超时。需要统计连续慢响应时，请调高首字超时或设为 0。</p>}
            {toggle("emptyResponseDetection", "检测空响应", "文本、推理内容或工具调用视为有效输出。")}
            <div className="rs-grid"><label className="rs-field"><strong>错误消息</strong><Select aria-label="上游错误展示" value={draft.errorMode} onChange={event => change("errorMode", event.target.value as GatewaySettings["errorMode"])}><option value="custom">自定义</option><option value="generic">通用消息</option><option value="raw">原始错误</option></Select><small>日志保留脱敏后的错误详情。</small></label>{draft.errorMode === "custom" && <label className="rs-field"><strong>自定义消息</strong><TextArea aria-label="自定义错误消息" rows={2} maxLength={1000} value={draft.customErrorMessage} onChange={event => change("customErrorMessage", event.target.value)} /></label>}</div>
          </div>
        </section>
        <section className="rs-section">
          <header><h3>健康检查</h3><p>延迟与恢复</p></header>
          <div className="rs-section-content">
            <div className="rs-grid">{field("threshold")}{field("responseThreshold")}{field("window")}{field("samples")}{field("windowSeconds")}{field("cooldown")}{field("recovery")}</div>
            {toggle("autoSwitch", "自动切换", "异常渠道暂不接收新的路由请求。")}
            {toggle("autoRecover", "自动恢复", "冷却后探测，连续健康达到配置次数后恢复。")}
            <details className="rs-rules"><summary>判定规则</summary><p>流式首字需连续满窗口且每次均超过阈值；一次快请求会打断连续慢请求。非流式达到最少样本后，按平均完成耗时判定。两种方式分别采样。</p></details>
          </div>
        </section>
        <section className="rs-section">
          <header><h3>自动禁用</h3><p>{draft.autoDisableEnabled ? "已启用" : "已关闭"}</p></header>
          <div className="rs-section-content">
            {toggle("autoDisableEnabled", "启用自动禁用", "仅作用于上游渠道或凭证。")}
            <div className="rs-grid"><label className="rs-field"><strong>禁用对象</strong><Select aria-label="禁用对象" value={draft.autoDisableTarget} onChange={event => change("autoDisableTarget", event.target.value as GatewaySettings["autoDisableTarget"])}><option value="key">上游密钥</option><option value="channel">整个渠道</option></Select></label><label className="rs-field"><strong>触发状态码</strong><Input aria-label="触发状态码" value={disableStatuses} onChange={event => setDisableStatuses(event.target.value)} /></label>{field("autoDisableThreshold")}{field("autoDisableCooldown")}</div>
            {toggle("autoDisableRecover", "自动恢复已禁用项", "关闭后需手动启用，渠道可单独覆盖。")}
          </div>
        </section>
      </fieldset>
    </form>
  );
}
