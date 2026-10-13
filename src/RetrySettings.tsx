import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GatewaySettings } from "../shared/types";
import { Save } from "lucide-react";
import { Accordion, Card } from "@heroui/react";
import { Button, Input, Select, Switch, TextArea, toast } from "./ui";
import "./retry-settings.css";

type Props = {
  settings: GatewaySettings;
  onSave: (settings: GatewaySettings) => Promise<void>;
  saving?: boolean;
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
  maxChannelRetries: { title: "最大跨渠道重试次数", description: "失败后，最多切换到其他渠道的次数。", min: 0, max: 10 },
  maxSameChannelRetries: { title: "单渠道最大重试次数", description: "切换渠道前，在同一渠道再次尝试的次数。", min: 0, max: 5 },
  retryDelayMs: { title: "重试延迟", description: "两次尝试之间的等待时间。", min: 100, max: 10000, unit: "ms" },
  streamFirstTokenTimeout: { title: "流式首字超时", description: "等待第一个有效内容事件；0 表示关闭。", min: 0, max: 600, unit: "s", step: 0.1 },
  nonStreamTimeout: { title: "非流式传输超时", description: "等待完整响应的最长时间；0 表示关闭。", min: 0, max: 600, unit: "s", step: 0.1 },
  threshold: { title: "首字延迟健康阈值", description: "流式窗口满 N 次，且每次都正常取得首字并超过阈值，才判为延迟异常。", min: 0.1, max: 600, unit: "s", step: 0.1 },
  responseThreshold: { title: "完整响应健康阈值", description: "非流式请求的平均完成延迟上限。", min: 0.1, max: 600, unit: "s", step: 0.1 },
  window: { title: "最近请求窗口", description: "流式与非流式分别统计最近 N 次实际尝试；首字需连续 N 次都慢。", min: 1, max: 1000, unit: "次" },
  windowSeconds: { title: "窗口时间上限", description: "仅统计该时间内的请求；0 表示不限。", min: 0, max: 86400, unit: "s" },
  samples: { title: "最少样本数", description: "用于失败比例和非流式平均耗时判定；首字延迟需满整个窗口。", min: 1, max: 1000, unit: "次" },
  cooldown: { title: "异常渠道冷却时间", description: "冷却结束后进入探测恢复。", min: 1, max: 3600, unit: "s" },
  recovery: { title: "恢复所需健康次数", description: "连续健康探测达到次数后恢复正常调度。", min: 1, max: 100, unit: "次" },
  autoDisableThreshold: { title: "连续错误阈值", description: "成功请求将重置连续错误计数。", min: 1, max: 100, unit: "次" },
  autoDisableCooldown: { title: "禁用冷却时间", description: "冷却结束后允许探测恢复。", min: 1, max: 86400, unit: "s" },
} satisfies Partial<Record<keyof GatewaySettings, NumericField>>;
type NumericKey = keyof typeof numericFields;
const strategyNames: Record<GatewaySettings["strategy"], string> = {
  failover: "故障转移", adaptive: "自适应", "round-robin": "轮询", weighted: "加权随机", "circuit-breaker": "熔断保护",
};
const errorNames: Record<GatewaySettings["errorMode"], string> = { custom: "自定义错误", generic: "通用错误", raw: "原始错误" };

export default function RetrySettings({ settings, onSave, saving = false }: Props) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState(settings.retryStatuses.join(", "));
  const [disableStatuses, setDisableStatuses] = useState(settings.autoDisableStatuses.join(", "));
  const [numericText, setNumericText] = useState<Partial<Record<NumericKey, string>>>({});
  const settingsSignature = JSON.stringify(settings);
  useEffect(() => {
    setDraft(settings);
    setStatuses(settings.retryStatuses.join(", "));
    setDisableStatuses(settings.autoDisableStatuses.join(", "));
    setNumericText({});
  }, [settingsSignature]);
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
    if (busy || saving) return;
    const parse = (text: string) => {
      const list = text.split(/[,，\s]+/).filter(Boolean).map(Number);
      if (!list.length || list.some(value => !Number.isInteger(value) || value < 400 || value > 599))
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
        const step = spec.step ?? 1;
        if (Math.abs(value / step - Math.round(value / step)) > 1e-7)
          throw new Error(`${spec.title}${step === 1 ? "须为整数" : `最多保留一位小数`}`);
      }
      if (draft.errorMode === "custom" && !draft.customErrorMessage.trim()) throw new Error("请填写自定义错误消息");
      const value = { ...draft, retryStatuses: parse(statuses), autoDisableStatuses: parse(disableStatuses) };
      if (value.samples > value.window) throw new Error("最少样本数不能大于最近请求窗口");
      setBusy(true);
      await onSave(value);
      toast.success("调度与重试策略已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="rs-root" onSubmit={save} noValidate>
      <Card className="rs-section rs-core">
        <div className="rs-section-heading"><h3>请求调度</h3><span>{strategyNames[draft.strategy]}</span></div>
        <div className="rs-grid">
          <label className="rs-field"><strong>负载均衡策略</strong>
            <Select aria-label="负载均衡策略" value={draft.strategy} onChange={event => change("strategy", event.target.value as GatewaySettings["strategy"])}>
              <option value="failover">故障转移 · 按优先级</option><option value="adaptive">自适应 · 优先低延迟</option>
              <option value="round-robin">轮询</option><option value="weighted">加权随机</option><option value="circuit-breaker">熔断保护</option>
            </Select><small>{draft.strategy === "adaptive" ? "在健康渠道中按平均延迟排序；未满慢请求窗口时，也可能选择其他渠道。" : "先检查健康、权限与模型，再按策略排序。"}</small>
          </label>
          <label className="rs-field"><strong>会话粘性</strong>
            <Select aria-label="会话粘性" value={draft.stickyMode} onChange={event => change("stickyMode", event.target.value as GatewaySettings["stickyMode"])}>
              <option value="prefer">优先最近选中的渠道</option><option value="off">关闭粘性</option>
            </Select><small>优先沿用 trace / thread 最近的健康渠道。</small>
          </label>
        </div>
        {toggle("retryEnabled", "启用重试", "在开始输出前，自动重试失败或超时请求。")}
        <div className="rs-grid rs-timeouts">{field("streamFirstTokenTimeout")}{field("nonStreamTimeout")}</div>
        {draft.streamFirstTokenTimeout > 0 && draft.streamFirstTokenTimeout <= draft.threshold && (
          <p className="rs-group-note">当前首字超时（{draft.streamFirstTokenTimeout} s）不高于健康阈值（{draft.threshold} s）。达到超时后，本次请求立即失败并按重试设置重试，无需满健康窗口。若要统计连续慢响应，请将首字超时调高或设为 0。</p>
        )}
      </Card>
      <Card className="rs-section rs-advanced-section">
        <h3>高级设置</h3>
        <Accordion className="rs-advanced" allowsMultipleExpanded>
          <Accordion.Item id="retry-options">
            <Accordion.Heading><Accordion.Trigger><span className="rs-accordion-title">重试与错误处理</span>
              <small>{draft.retryEnabled ? `跨渠道 ${draft.maxChannelRetries} 次 · 同渠道 ${draft.maxSameChannelRetries} 次 · ${draft.retryDelayMs} ms` : "重试已关闭"} · {errorNames[draft.errorMode]}</small><Accordion.Indicator />
            </Accordion.Trigger></Accordion.Heading>
            <Accordion.Panel><Accordion.Body>
              <p className="rs-group-note">开始向客户端输出内容后，不再重试或切换渠道。</p>
              <div className="rs-grid">{field("maxChannelRetries")}{field("maxSameChannelRetries")}{field("retryDelayMs")}
                <label className="rs-field"><strong>可重试状态码</strong><Input aria-label="可重试状态码" value={statuses} onChange={event => setStatuses(event.target.value)} placeholder="408, 429, 500, 502, 503, 504" /><small>身份验证失败不会通过此列表自动重试。</small></label>
              </div>
              {toggle("emptyResponseDetection", "空响应检测", "预读流式响应；真实内容或工具调用才算有效输出。")}
              <div className="rs-error-settings">
                <label className="rs-field"><strong>上游错误展示</strong>
                  <Select aria-label="上游错误展示" value={draft.errorMode} onChange={event => change("errorMode", event.target.value as GatewaySettings["errorMode"])}>
                    <option value="custom">使用自定义消息</option><option value="generic">使用通用错误消息</option><option value="raw">展示原始上游错误</option>
                  </Select><small>请求日志始终保留原始错误。</small>
                </label>
                {draft.errorMode === "custom" && <label className="rs-field"><strong>自定义错误消息</strong><TextArea aria-label="自定义错误消息" rows={2} maxLength={1000} value={draft.customErrorMessage} onChange={event => change("customErrorMessage", event.target.value)} /></label>}
              </div>
            </Accordion.Body></Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item id="latency-health">
            <Accordion.Heading><Accordion.Trigger><span className="rs-accordion-title">延迟健康检查</span>
              <small>首字连续 {draft.window} 次 &gt; {draft.threshold} s · 完成 {draft.responseThreshold} s{draft.autoSwitch ? " · 自动切换" : " · 仅记录"}</small><Accordion.Indicator />
            </Accordion.Trigger></Accordion.Heading>
            <Accordion.Panel><Accordion.Body>
              <p className="rs-group-note">流式需满窗口且每次首字都超过阈值；快请求会打断连续慢请求。非流式达到最少样本后，按平均完成延迟判定。</p>
              <div className="rs-grid">{field("threshold")}{field("responseThreshold")}</div>
              <h4 className="rs-group-title">采样窗口</h4>
              <div className="rs-grid">{field("window")}{field("samples")}{field("windowSeconds")}</div>
              <h4 className="rs-group-title">切换与恢复</h4>
              <div className="rs-grid">{field("cooldown")}{field("recovery")}</div>
              {toggle("autoSwitch", "延迟异常自动切换", "将后续请求转移到其他健康且已授权的渠道。")}
              {toggle("autoRecover", "自动探测恢复", "冷却后探测异常渠道，连续健康后恢复调度。")}
            </Accordion.Body></Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item id="auto-disable">
            <Accordion.Heading><Accordion.Trigger><span className="rs-accordion-title">自动禁用与恢复</span>
              <small>{draft.autoDisableEnabled ? `${draft.autoDisableTarget === "key" ? "上游密钥" : "渠道"} · 连续 ${draft.autoDisableThreshold} 次错误 · ${draft.autoDisableCooldown} s 冷却` : "已关闭"}</small><Accordion.Indicator />
            </Accordion.Trigger></Accordion.Heading>
            <Accordion.Panel><Accordion.Body>
              <p className="rs-group-note">仅作用于上游渠道与凭证，不禁用调用网关的 API Key。</p>
              {toggle("autoDisableEnabled", "启用自动禁用", "指定状态码达到连续错误阈值后，暂时禁用上游项。")}
              <div className="rs-grid">
                <label className="rs-field"><strong>禁用对象</strong><Select aria-label="禁用对象" value={draft.autoDisableTarget} onChange={event => change("autoDisableTarget", event.target.value as GatewaySettings["autoDisableTarget"])}><option value="key">上游密钥</option><option value="channel">整个渠道</option></Select></label>
                <label className="rs-field"><strong>触发状态码</strong><Input aria-label="触发状态码" value={disableStatuses} onChange={event => setDisableStatuses(event.target.value)} /></label>
                {field("autoDisableThreshold")}{field("autoDisableCooldown")}
              </div>
              {toggle("autoDisableRecover", "自动恢复已禁用项", "关闭后需手动启用；渠道可单独覆盖此策略。")}
            </Accordion.Body></Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Card>
      <footer className="rs-footer"><span>保存后生效</span><Button className="rs-save" variant="primary" type="submit" disabled={busy || saving}><Save size={16} />{busy || saving ? "保存中…" : "保存策略"}</Button></footer>
    </form>
  );
}
