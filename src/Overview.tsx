import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, Copy, Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData, GatewayChannel, GatewaySettings } from "../shared/types";
import type { ConsolePage } from "./navigation";
import { Button } from "./ui";
import ProviderIcon from "./ProviderIcon";
import "./overview.css";

const count = (value: number) => value.toLocaleString("zh-CN");
const strategyNames: Record<GatewaySettings["strategy"], string> = { failover: "故障转移", adaptive: "低延迟优先", "round-robin": "轮询", weighted: "加权随机", "circuit-breaker": "熔断保护" };
function channelState(channel: GatewayChannel) {
  if (!channel.enabled) return { label: "已停用", kind: "muted" };
  if (channel.config.protocol !== "mock" && !channel.credentialCount) return { label: "待配置", kind: "warning" };
  if (channel.status === "offline") return { label: "不可用", kind: "error" };
  if (channel.status === "degraded") return { label: "延迟异常", kind: "warning" };
  if (channel.config.protocol !== "mock" && !channel.health.samples) return { label: "待检测", kind: "muted" };
  return { label: "正常", kind: "success" };
}

export default function Overview({ dashboard, channels, settings, range, onNavigate, onEdit, onCreate, onCopyAddress }: {
  dashboard: DashboardData; channels: GatewayChannel[]; settings: GatewaySettings; range: string;
  onNavigate: (page: ConsolePage) => void; onEdit: (channel: GatewayChannel) => void; onCreate: () => void; onCopyAddress: () => void;
}) {
  const [chartMode, setChartMode] = useState<"requests" | "latency">("requests");
  const visible = channels.filter(channel => !channel.archived);
  const enabled = visible.filter(channel => channel.enabled);
  const issues = enabled.filter(channel => ["warning", "error"].includes(channelState(channel).kind));
  const pending = enabled.filter(channel => channelState(channel).kind === "muted");
  const totals = dashboard.totals;
  const rangeName = range === "1h" ? "过去 1 小时" : range === "7d" ? "过去 7 天" : "过去 24 小时";
  const points = useMemo(() => {
    const interval = range === "1h" ? 300000 : range === "7d" ? 43200000 : 3600000;
    // The rolling range includes a partial bucket at both ends.
    const length = range === "1h" ? 13 : range === "7d" ? 15 : 25;
    const end = Math.floor(Date.now() / interval) * interval;
    const samples = new Map(dashboard.latency.map(point => [Date.parse(point.time), point]));
    return Array.from({ length }, (_, index) => {
      const timestamp = end - (length - index - 1) * interval;
      return samples.get(timestamp) ?? { time: new Date(timestamp).toISOString(), requests: 0, primary: null, backup: null };
    });
  }, [dashboard.latency, range]);
  const timeLabel = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", ...(range === "7d" ? { month: "numeric", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hour12: false }) });
  const tooltipTimeLabel = (value: unknown) => new Date(String(value)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return <div className="ov-page">
    <div className="ov-status-line">
      <span className={`ov-live ${issues.length ? "ov-live-warning" : pending.length || !enabled.length ? "ov-live-muted" : ""}`}><i />{!visible.length ? "尚未接入渠道" : !enabled.length ? "所有渠道已停用" : issues.length ? `${issues.length} 个渠道需要关注` : pending.length ? `${pending.length} 个渠道待检测` : "渠道运行正常"}</span>
      <span>{enabled.length} 个启用 · {visible.length} 个渠道</span>
      <button className="ov-address" onClick={onCopyAddress}><Copy size={12} />复制接入地址</button>
    </div>
    <dl className="ov-metrics" aria-label="网关关键指标">
      <div><dt>请求总数</dt><dd>{count(totals.requests)}<small>次</small></dd><span>{rangeName}</span></div>
      <div><dt>成功率</dt><dd>{totals.requests ? totals.successRate.toFixed(1) : "—"}<small>%</small></dd><span>按最终请求结果</span></div>
      <div><dt>平均首字延迟</dt><dd>{totals.averageTtft ? totals.averageTtft.toFixed(2) : "—"}<small>s</small></dd><span>流式请求</span></div>
      <div><dt>Token 用量</dt><dd>{count(totals.inputTokens + totals.outputTokens)}<small>tokens</small></dd><span>输入 {count(totals.inputTokens)} · 输出 {count(totals.outputTokens)}</span></div>
    </dl>
    <div className="ov-main-grid">
      <section className="ov-traffic" aria-label="请求趋势">
        <div className="ov-section-heading"><h2>{chartMode === "requests" ? "请求流量" : "首字延迟"}</h2><div className="ov-chart-tabs" role="group" aria-label="图表指标"><button aria-pressed={chartMode === "requests"} onClick={() => setChartMode("requests")}>请求量</button><button aria-pressed={chartMode === "latency"} onClick={() => setChartMode("latency")}>延迟</button></div></div>
        <div className="ov-chart">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === "requests" ? <BarChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: -23 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={46} tickFormatter={timeLabel} tick={{ fill: "var(--muted)", fontSize: 13 }} dy={10} />
              <YAxis allowDecimals={false} domain={[0, (maximum: number) => Math.max(1, maximum)]} tickCount={3} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 13 }} />
              <Tooltip labelFormatter={tooltipTimeLabel} formatter={value => [count(Number(value)), "请求"]} cursor={{ fill: "var(--surface-secondary)" }} contentStyle={{ border: "1px solid var(--border)", borderRadius: 4, boxShadow: "none", fontSize: 13 }} />
              <Bar dataKey="requests" fill="var(--data-primary)" radius={[2, 2, 0, 0]} barSize={10} isAnimationActive={false} />
            </BarChart> : <LineChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={46} tickFormatter={timeLabel} tick={{ fill: "var(--muted)", fontSize: 13 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 13 }} />
              <Tooltip labelFormatter={tooltipTimeLabel} formatter={(value, name) => [`${Number(value).toFixed(2)} s`, name]} contentStyle={{ border: "1px solid var(--border)", borderRadius: 4, fontSize: 13 }} />
              <Line name="优先渠道" dataKey="primary" stroke="var(--data-primary)" strokeWidth={1.8} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
              <Line name="其他渠道" dataKey="backup" stroke="var(--data-secondary)" strokeWidth={1.8} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>}
          </ResponsiveContainer>
        </div>
        <div className="ov-chart-caption"><span>{chartMode === "requests" ? "不含健康探测" : "单位：秒 · 仅成功流式请求"}</span><button onClick={() => onNavigate("analytics")}>查看用量分析<ArrowRight size={12} /></button></div>
      </section>
      <aside className="ov-routing">
        <div className="ov-section-heading"><h2>当前路由</h2><button aria-label="查看调度设置" onClick={() => onNavigate("routing")}><ArrowDownRight size={16} /></button></div>
        <strong className="ov-strategy">{strategyNames[settings.strategy]}</strong>
        <dl className="ov-routing-details"><div><dt>首字超时</dt><dd>{settings.streamFirstTokenTimeout ? `${settings.streamFirstTokenTimeout} s` : "关闭"}</dd></div><div><dt>重试 · 同渠道 / 跨渠道</dt><dd>{settings.retryEnabled ? `${settings.maxSameChannelRetries} / ${settings.maxChannelRetries}` : "关闭"}</dd></div><div><dt>会话粘性</dt><dd>{settings.stickyMode === "prefer" ? "已开启" : "已关闭"}</dd></div><div><dt>渠道切换请求</dt><dd>{count(totals.failovers)} 次</dd></div></dl>
        <Button variant="outline" size="sm" onClick={() => onNavigate("playground")}>打开测试场<ArrowRight size={13} /></Button>
      </aside>
    </div>
    <div className="ov-lower-grid">
      <section className="ov-channels">
        <div className="ov-section-heading"><h2>渠道状态<span>{visible.length}</span></h2><button onClick={() => onNavigate("channels")}>管理渠道<ArrowRight size={12} /></button></div>
        {visible.length ? <div className="ov-table-wrap"><table className="ov-table"><thead><tr><th>渠道</th><th>状态</th><th>首字</th><th title="包含重试与健康探测">累计尝试</th><th aria-label="编辑渠道" /></tr></thead><tbody>{visible.slice(0, 6).map(channel => { const state = channelState(channel); return <tr key={channel.id}><td><button className="ov-channel-name" onClick={() => onEdit(channel)}><ProviderIcon provider={channel.config.protocol} size={17} /><span>{channel.name}<small>{channel.config.protocol === "mock" ? "本地测试" : channel.provider}</small></span></button></td><td><span className={`ov-table-status ov-table-status-${state.kind}`}><i />{state.label}</span></td><td className="ov-numeric">{channel.health.averageTtft == null ? "—" : `${channel.health.averageTtft.toFixed(2)} s`}</td><td className="ov-numeric">{count(channel.requests)}</td><td><button className="ov-row-open" aria-label={`编辑 ${channel.name}`} onClick={() => onEdit(channel)}><ArrowRight size={13} /></button></td></tr>; })}</tbody></table></div> : <div className="ov-empty"><p>接入第一个上游渠道，开始转发请求。</p><Button variant="primary" size="sm" onClick={onCreate}><Plus size={14} />添加渠道</Button></div>}
      </section>
      <section className="ov-events">
        <div className="ov-section-heading"><h2>近期事件</h2><span>健康与调度</span></div>
        {dashboard.events.length ? <ol>{dashboard.events.slice(0, 4).map(event => <li key={event.id}><i className={`ov-event-dot ov-event-${event.type}`} /><div><strong>{event.title}</strong><p>{event.description}</p><time>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false })}</time></div></li>)}</ol> : <div className="ov-no-events"><span className="ov-event-line" /><p>暂无调度事件</p><small>渠道切换与恢复将记录在这里</small></div>}
      </section>
    </div>
  </div>;
}
