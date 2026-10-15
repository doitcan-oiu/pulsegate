import type { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { DashboardData } from '../shared/types';
import type { AnalyticsData } from '../shared/analytics';
import './usage-analytics.css';

const COLORS = { accent: 'var(--foreground)', success: 'color-mix(in oklab, var(--foreground) 60%, var(--surface))', warning: 'color-mix(in oklab, var(--foreground) 38%, var(--surface))', danger: 'color-mix(in oklab, var(--foreground) 22%, var(--surface))' };
const count = (value: number) => value.toLocaleString('zh-CN');
const compact = (value: number) => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const seconds = (value: number | null) => value === null ? '—' : `${value.toFixed(2)} s`;
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
const throughput = (value: number) => new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 3 }).format(value);
const shortName = (value: string) => {
  let length = 0, label = '';
  for (const character of value) {
    length += /[^\x00-\x7f]/.test(character) ? 2 : 1;
    if (length > 16) return label + '…';
    label += character;
  }
  return label;
};
const tooltipStyle = { background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 13 };
const outcomeNames = { success: '直接成功', slow: '成功 · 响应缓慢', failover: '成功 · 渠道切换', error: '请求失败' };
const outcomeColors = { success: COLORS.success, slow: COLORS.warning, failover: COLORS.accent, error: COLORS.danger };

function ChartEmpty({ children = '所选时间范围内暂无请求记录' }: { children?: ReactNode }) {
  return <div className="ua-chart-empty"><span>{children}</span></div>;
}
function ChartCard({ title, description, legend, children }: { title: string; description: string; legend?: ReactNode; children: ReactNode }) {
  return <article className="ua-chart-card">
    <header className="ua-chart-header"><div><h3>{title}</h3><p>{description}</p></div></header>
    {legend && <div className="ua-legend">{legend}</div>}
    <div className="ua-chart" role="group" aria-label={title}>{children}</div>
  </article>;
}
function LegendItem({ color, children }: { color: string; children: ReactNode }) {
  return <span><i style={{ background: color }} />{children}</span>;
}
function Stat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return <div className="ua-stat"><span>{label}</span><strong>{value}</strong><small>{caption}</small></div>;
}

export default function UsageAnalytics({ dashboard }: { dashboard: DashboardData }) {
  // Older responses may arrive while the worker reloads; avoid inventing latency or usage series.
  const analytics = dashboard.analytics as AnalyticsData | undefined;
  if (!analytics) return <div className="ua-unavailable"><ChartEmpty>统计数据尚未加载，请刷新页面。</ChartEmpty></div>;
  const { totals, summary, timeline, range, intervalMinutes } = analytics;
  const hasRequests = totals.requests > 0;
  const timeTick = (value: string) => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit',
    ...(range === '7d' ? { month: 'numeric', day: 'numeric' } : {}),
  });
  const timeLabel = (value: unknown) => new Date(String(value)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const models = analytics.models.slice(0, 8);
  const channels = analytics.channels.slice(0, 8).map(channel => ({ ...channel, p95Ttft: channel.ttft.p95 }));
  const generation = analytics.channels.filter(channel => channel.generationSpeed !== null).sort((a, b) => (b.generationSpeed ?? 0) - (a.generationSpeed ?? 0)).slice(0, 8);
  const outcomes = analytics.outcomes.filter(outcome => outcome.requests > 0);
  const hasUsage = totals.inputTokens + totals.outputTokens > 0;
  const ttftPoints = timeline.some(point => point.ttftP50 !== null);
  const durationPoints = timeline.some(point => point.durationAverage !== null);

  return <div className="ua-page">
    <section className="ua-primary" aria-label="用量概况">
      <div className="ua-context"><span>{analytics.rangeLabel}</span><span>业务请求 · 不含健康探测</span></div>
      <div className="ua-stats">
        <Stat label="请求数" value={count(totals.requests)} caption={`${count(summary.streamRequests)} 次流式`} />
        <Stat label="成功率" value={hasRequests ? percent(totals.successRate) : '—'} caption={`${count(summary.failedRequests)} 次失败`} />
        <Stat label="P95 首字" value={seconds(summary.ttft.p95)} caption={`${count(summary.ttft.samples)} 个 SSE 样本`} />
        <Stat label="P95 完成" value={seconds(summary.duration.p95)} caption="包含重试等待" />
        <Stat label="总 Tokens" value={hasUsage ? count(totals.inputTokens + totals.outputTokens) : '—'} caption={`输入 ${count(totals.inputTokens)} · 输出 ${count(totals.outputTokens)}`} />
        <Stat label="估算费用" value={summary.pricedTokens ? `$${totals.cost.toFixed(4)}` : '—'} caption={`usage 覆盖 ${hasRequests ? percent(summary.usageCoverage) : '—'}`} />
      </div>
      <dl className="ua-performance-details" aria-label="请求性能补充指标">
        <div><dt>平均首字</dt><dd>{seconds(summary.ttft.average)}</dd></div>
        <div><dt>P50 首字</dt><dd>{seconds(summary.ttft.p50)}</dd></div>
        <div><dt>平均完成</dt><dd>{seconds(summary.duration.average)}</dd></div>
        <div><dt>重试率</dt><dd>{hasRequests ? percent(summary.retryRate) : '—'}</dd></div>
        <div><dt>渠道切换</dt><dd>{hasRequests ? percent(summary.switchRate) : '—'}</dd></div>
        <div><dt>吞吐</dt><dd>{hasRequests ? `${throughput(summary.throughput)} 次/min` : '—'}</dd></div>
        <div><dt>生成速度</dt><dd>{summary.generationSpeed === null ? '—' : `${summary.generationSpeed.toFixed(1)} token/s`}</dd></div>
      </dl>
      {hasRequests && summary.usageCoverage < 100 && <p className="ua-coverage-note">{count(totals.requests - summary.usageRequests)} 次请求未返回 usage，用量与费用仅统计已获取的数据。</p>}
    </section>

    <section aria-labelledby="ua-trends-title">
      <div className="ua-section-heading"><h2 id="ua-trends-title">请求趋势</h2><span>北京时间 · {intervalMinutes < 60 ? `${intervalMinutes} 分钟` : `${intervalMinutes / 60} 小时`} / 点</span></div>
      {!hasRequests ? <div className="ua-empty-overview"><ChartEmpty>此时间范围内暂无业务请求。可在测试场发起请求，再查看延迟、用量和渠道表现。</ChartEmpty></div> : <div className="ua-charts-grid">
        <ChartCard title="请求量与成功率" description="左轴：请求数 · 右轴：成功率" legend={<><LegendItem color={COLORS.accent}>请求数</LegendItem><LegendItem color={COLORS.success}>成功率</LegendItem></>}>
          {!hasRequests ? <ChartEmpty /> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis yAxisId="requests" allowDecimals={false} width={40} tickFormatter={compact} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} width={42} tickFormatter={value => `${value}%`} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [name === '成功率' ? percent(Number(value)) : `${count(Number(value))} 次`, name]} />
            <Bar yAxisId="requests" dataKey="requests" name="请求数" fill={COLORS.accent} radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Line yAxisId="rate" dataKey="successRate" name="成功率" stroke={COLORS.success} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="首字延迟" description="秒 · 成功 SSE 请求" legend={<><LegendItem color={COLORS.accent}>P50</LegendItem><LegendItem color={COLORS.warning}>P95</LegendItem></>}>
          {!ttftPoints ? <ChartEmpty>暂无成功 SSE 请求的有效首字样本</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={40} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [seconds(Number(value)), name]} />
            <Line dataKey="ttftP50" name="P50" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line dataKey="ttftP95" name="P95" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="完成耗时" description="秒 · 成功请求，含重试等待" legend={<><LegendItem color={COLORS.accent}>平均耗时</LegendItem><LegendItem color={COLORS.warning}>P95</LegendItem></>}>
          {!durationPoints ? <ChartEmpty>暂无成功请求的完成耗时样本</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={40} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [seconds(Number(value)), name]} />
            <Line dataKey="durationAverage" name="平均耗时" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line dataKey="durationP95" name="P95" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="Token 用量" description="Tokens · 含重试用量" legend={<><LegendItem color={COLORS.accent}>输入</LegendItem><LegendItem color={COLORS.success}>输出</LegendItem></>}>
          {!hasUsage ? <ChartEmpty>上游尚未返回可统计的 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={42} tickFormatter={compact} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [`${count(Number(value))} Tokens`, name]} />
            <Area dataKey="inputTokens" name="输入" stackId="usage" stroke={COLORS.accent} fill={COLORS.accent} fillOpacity={0.18} strokeWidth={2} />
            <Area dataKey="outputTokens" name="输出" stackId="usage" stroke={COLORS.success} fill={COLORS.success} fillOpacity={0.18} strokeWidth={2} />
          </AreaChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="模型用量排行" description="Token 总量前 8 名" legend={<><LegendItem color={COLORS.accent}>输入 Tokens</LegendItem><LegendItem color={COLORS.success}>输出 Tokens</LegendItem></>}>
          {!hasUsage ? <ChartEmpty>上游尚未返回可统计的 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><BarChart data={models} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis dataKey="model" type="category" width={106} tickFormatter={shortName} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${count(Number(value))} Tokens`, name]} />
            <Bar dataKey="inputTokens" name="输入" stackId="usage" fill={COLORS.accent} maxBarSize={24} />
            <Bar dataKey="outputTokens" name="输出" stackId="usage" fill={COLORS.success} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="渠道表现" description="尝试数前 8 个渠道" legend={<><LegendItem color={COLORS.success}>成功率 %</LegendItem><LegendItem color={COLORS.accent}>P95 首字 s</LegendItem></>}>
          {!channels.length ? <ChartEmpty>所选时间范围内暂无上游尝试</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={channels} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tickFormatter={shortName} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis yAxisId="rate" domain={[0, 100]} width={42} tickFormatter={value => `${value}%`} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="latency" orientation="right" width={38} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [name === '成功率' ? percent(Number(value)) : seconds(Number(value)), name]} />
            <Bar yAxisId="rate" dataKey="successRate" name="成功率" fill={COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Line yAxisId="latency" dataKey="p95Ttft" name="P95 首字" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="请求结果" description="按最终请求结果统计">
          {!hasRequests ? <ChartEmpty /> : <div className="ua-outcome-chart"><ResponsiveContainer width="54%" height="100%"><PieChart>
            <Pie data={outcomes} dataKey="requests" nameKey="result" innerRadius="55%" outerRadius="78%" paddingAngle={outcomes.length > 1 ? 3 : 0} stroke="var(--surface)">
              {outcomes.map(outcome => <Cell key={outcome.result} fill={outcomeColors[outcome.result]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${count(Number(value))} 次`, outcomeNames[String(name) as keyof typeof outcomeNames] ?? name]} />
          </PieChart></ResponsiveContainer><ul>{analytics.outcomes.map(outcome => <li key={outcome.result}><i style={{ background: outcomeColors[outcome.result] }} /><span>{outcomeNames[outcome.result]}</span><strong>{count(outcome.requests)}</strong></li>)}</ul></div>}
        </ChartCard>

        <ChartCard title="渠道生成速度" description="token/s · 速度前 8 个渠道">
          {!generation.length ? <ChartEmpty>需要成功 SSE 请求的首字、耗时与输出 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><BarChart data={generation} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={106} tickFormatter={shortName} tick={{ fontSize: 13, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={value => [`${Number(value).toFixed(1)} token/s`, '生成速度']} />
            <Bar dataKey="generationSpeed" name="生成速度" fill={COLORS.accent} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart></ResponsiveContainer>}
        </ChartCard>
      </div>}
    </section>
    <details className="ua-methodology">
      <summary>统计口径与费用说明</summary>
      <p>延迟分位仅统计成功请求，失败和取消不进入延迟样本。首字延迟反映最终上游尝试；完成耗时包含整个请求的重试等待。生成速度基于 {count(summary.generationSamples)} 个有效成功 SSE 样本，生成时长为上游完成耗时减首字延迟。</p>
      <p>重试率包含同渠道重试，切换率包含跨渠道尝试。吞吐为所选时间范围内的平均请求数。费用按当前渠道配置的 USD / 百万 Token 价格计算；{summary.unpricedTokens > 0 ? `${count(summary.unpricedTokens)} Tokens 尚未配置价格。` : '未返回 usage 的请求不估算用量或费用。'}</p>
    </details>
  </div>;
}
