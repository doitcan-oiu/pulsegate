import type { ReactNode } from 'react';
import { Card } from '@heroui/react';
import { ChartNoAxesCombined } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { DashboardData } from '../shared/types';
import type { AnalyticsData } from '../shared/analytics';
import './usage-analytics.css';

const COLORS = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)' };
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
const tooltipStyle = { background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };
const outcomeNames = { success: '直接成功', slow: '成功 · 响应缓慢', failover: '成功 · 渠道切换', error: '请求失败' };
const outcomeColors = { success: COLORS.success, slow: COLORS.warning, failover: COLORS.accent, error: COLORS.danger };

function ChartEmpty({ children = '所选时间范围内暂无请求记录' }: { children?: ReactNode }) {
  return <div className="ua-chart-empty"><ChartNoAxesCombined size={25} strokeWidth={1.5} /><span>{children}</span></div>;
}
function ChartCard({ title, description, legend, children }: { title: string; description: string; legend?: ReactNode; children: ReactNode }) {
  return <Card className="ua-chart-card">
    <Card.Header className="ua-chart-header"><div><h3>{title}</h3><p>{description}</p></div></Card.Header>
    {legend && <div className="ua-legend">{legend}</div>}
    <div className="ua-chart">{children}</div>
  </Card>;
}
function LegendItem({ color, children }: { color: string; children: ReactNode }) {
  return <span><i style={{ background: color }} />{children}</span>;
}
function Stat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return <Card className="ua-stat"><span>{label}</span><strong>{value}</strong><small>{caption}</small></Card>;
}

export default function UsageAnalytics({ dashboard }: { dashboard: DashboardData }) {
  // Older responses may arrive while the worker reloads; avoid inventing latency or usage series.
  const analytics = dashboard.analytics as AnalyticsData | undefined;
  if (!analytics) return <Card className="ua-unavailable"><ChartEmpty>统计数据尚未加载，请刷新页面。</ChartEmpty></Card>;
  const { totals, summary, timeline, range, intervalMinutes } = analytics;
  const hasRequests = totals.requests > 0;
  const timeTick = (value: string) => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit',
    ...(range === '7d' ? { month: 'numeric', day: 'numeric' } : {}),
  });
  const timeLabel = (value: unknown) => new Date(String(value)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const models = analytics.models.slice(0, 8);
  const channels = analytics.channels.slice(0, 8).map(channel => ({ ...channel, p95Ttft: channel.ttft.p95 }));
  const generation = channels.filter(channel => channel.generationSpeed !== null);
  const outcomes = analytics.outcomes.filter(outcome => outcome.requests > 0);
  const hasUsage = totals.inputTokens + totals.outputTokens > 0;
  const ttftPoints = timeline.some(point => point.ttftP50 !== null);
  const durationPoints = timeline.some(point => point.durationAverage !== null);

  return <div className="ua-page">
    <section className="ua-primary" aria-labelledby="ua-performance-title">
      <div className="ua-section-heading"><h2 id="ua-performance-title">运行表现</h2><span>{analytics.rangeLabel} · 不含健康探测</span></div>
      <div className="ua-stats">
        <Stat label="请求数" value={count(totals.requests)} caption={`${count(summary.streamRequests)} 次流式请求`} />
        <Stat label="成功率" value={hasRequests ? percent(totals.successRate) : '—'} caption={`${count(summary.successfulRequests)} 次成功 · ${count(summary.failedRequests)} 次失败`} />
        <Stat label="P95 首字延迟" value={seconds(summary.ttft.p95)} caption={`${count(summary.ttft.samples)} 次成功 SSE 样本`} />
        <Stat label="P95 完成耗时" value={seconds(summary.duration.p95)} caption={`${count(summary.duration.samples)} 次成功请求 · 含重试等待`} />
      </div>
      <dl className="ua-performance-details">
        <div><dt>平均首字</dt><dd>{seconds(summary.ttft.average)}</dd></div>
        <div><dt>P50 首字</dt><dd>{seconds(summary.ttft.p50)}</dd></div>
        <div><dt>平均完成</dt><dd>{seconds(summary.duration.average)}</dd></div>
        <div><dt>重试率</dt><dd>{hasRequests ? percent(summary.retryRate) : '—'}</dd></div>
        <div><dt>渠道切换率</dt><dd>{hasRequests ? percent(summary.switchRate) : '—'}</dd></div>
        <div><dt>平均吞吐</dt><dd>{hasRequests ? `${throughput(summary.throughput)} 次/min` : '—'}</dd></div>
        <div><dt>生成速度</dt><dd>{summary.generationSpeed === null ? '—' : `${summary.generationSpeed.toFixed(1)} token/s`}</dd></div>
      </dl>
    </section>

    <section className="ua-usage-section" aria-labelledby="ua-usage-title">
      <div className="ua-section-heading"><h2 id="ua-usage-title">Token 与费用</h2><span>按上游返回的 usage 统计</span></div>
      <Card className="ua-usage-summary">
        <div><span>输入 Tokens</span><strong>{hasUsage ? count(totals.inputTokens) : '—'}</strong></div>
        <div><span>输出 Tokens</span><strong>{hasUsage ? count(totals.outputTokens) : '—'}</strong></div>
        <div><span>已配置价格的费用</span><strong>{summary.pricedTokens ? `$${totals.cost.toFixed(4)}` : '—'}</strong></div>
        <div className="ua-usage-coverage"><span>用量数据覆盖</span><strong>{hasRequests ? percent(summary.usageCoverage) : '—'}</strong><small>{count(summary.usageRequests)} / {count(totals.requests)} 次请求</small></div>
      </Card>
    </section>

    <section aria-labelledby="ua-trends-title">
      <div className="ua-section-heading"><h2 id="ua-trends-title">趋势与分布</h2><span>时间以北京时间显示 · 每 {intervalMinutes < 60 ? `${intervalMinutes} 分钟` : `${intervalMinutes / 60} 小时`}聚合</span></div>
      <div className="ua-charts-grid">
        <ChartCard title="请求量与成功率" description="左轴：请求数 · 右轴：成功率" legend={<><LegendItem color={COLORS.accent}>请求数</LegendItem><LegendItem color={COLORS.success}>成功率</LegendItem></>}>
          {!hasRequests ? <ChartEmpty /> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis yAxisId="requests" allowDecimals={false} width={40} tickFormatter={compact} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} width={42} tickFormatter={value => `${value}%`} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [name === '成功率' ? percent(Number(value)) : `${count(Number(value))} 次`, name]} />
            <Bar yAxisId="requests" dataKey="requests" name="请求数" fill={COLORS.accent} radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Line yAxisId="rate" dataKey="successRate" name="成功率" stroke={COLORS.success} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="首字延迟分位趋势" description="单位：秒 · 仅成功且有有效首字的 SSE 请求" legend={<><LegendItem color={COLORS.accent}>P50</LegendItem><LegendItem color={COLORS.warning}>P95</LegendItem></>}>
          {!ttftPoints ? <ChartEmpty>暂无成功 SSE 请求的有效首字样本</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={40} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [seconds(Number(value)), name]} />
            <Line dataKey="ttftP50" name="P50" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line dataKey="ttftP95" name="P95" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="完整请求耗时" description="单位：秒 · 含重试等待 · 仅成功请求" legend={<><LegendItem color={COLORS.accent}>平均耗时</LegendItem><LegendItem color={COLORS.warning}>P95</LegendItem></>}>
          {!durationPoints ? <ChartEmpty>暂无成功请求的完成耗时样本</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={40} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [seconds(Number(value)), name]} />
            <Line dataKey="durationAverage" name="平均耗时" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line dataKey="durationP95" name="P95" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="Token 用量趋势" description="单位：Tokens · 包含重试时上游已返回的用量" legend={<><LegendItem color={COLORS.accent}>输入</LegendItem><LegendItem color={COLORS.success}>输出</LegendItem></>}>
          {!hasUsage ? <ChartEmpty>上游尚未返回可统计的 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis width={42} tickFormatter={compact} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeLabel} formatter={(value, name) => [`${count(Number(value))} Tokens`, name]} />
            <Area dataKey="inputTokens" name="输入" stackId="usage" stroke={COLORS.accent} fill={COLORS.accent} fillOpacity={0.18} strokeWidth={2} />
            <Area dataKey="outputTokens" name="输出" stackId="usage" stroke={COLORS.success} fill={COLORS.success} fillOpacity={0.18} strokeWidth={2} />
          </AreaChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="模型用量排行" description="按请求模型归集 · Token 总量前 8 名" legend={<><LegendItem color={COLORS.accent}>输入 Tokens</LegendItem><LegendItem color={COLORS.success}>输出 Tokens</LegendItem></>}>
          {!hasUsage ? <ChartEmpty>上游尚未返回可统计的 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><BarChart data={models} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis dataKey="model" type="category" width={106} tickFormatter={shortName} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${count(Number(value))} Tokens`, name]} />
            <Bar dataKey="inputTokens" name="输入" stackId="usage" fill={COLORS.accent} maxBarSize={24} />
            <Bar dataKey="outputTokens" name="输出" stackId="usage" fill={COLORS.success} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="渠道成功率与首字性能" description="按上游尝试统计 · 尝试数前 8 个渠道" legend={<><LegendItem color={COLORS.success}>成功率 %</LegendItem><LegendItem color={COLORS.accent}>P95 首字 s</LegendItem></>}>
          {!channels.length ? <ChartEmpty>所选时间范围内暂无上游尝试</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={channels} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tickFormatter={shortName} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis yAxisId="rate" domain={[0, 100]} width={42} tickFormatter={value => `${value}%`} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="latency" orientation="right" width={38} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [name === '成功率' ? percent(Number(value)) : seconds(Number(value)), name]} />
            <Bar yAxisId="rate" dataKey="successRate" name="成功率" fill={COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Line yAxisId="latency" dataKey="p95Ttft" name="P95 首字" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="请求结果分布" description="按最终请求结果统计 · 切换与缓慢请求仍计入成功率">
          {!hasRequests ? <ChartEmpty /> : <div className="ua-outcome-chart"><ResponsiveContainer width="54%" height="100%"><PieChart>
            <Pie data={outcomes} dataKey="requests" nameKey="result" innerRadius="55%" outerRadius="78%" paddingAngle={outcomes.length > 1 ? 3 : 0} stroke="var(--surface)">
              {outcomes.map(outcome => <Cell key={outcome.result} fill={outcomeColors[outcome.result]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${count(Number(value))} 次`, outcomeNames[String(name) as keyof typeof outcomeNames] ?? name]} />
          </PieChart></ResponsiveContainer><ul>{analytics.outcomes.map(outcome => <li key={outcome.result}><i style={{ background: outcomeColors[outcome.result] }} /><span>{outcomeNames[outcome.result]}</span><strong>{count(outcome.requests)}</strong></li>)}</ul></div>}
        </ChartCard>

        <ChartCard title="渠道生成速度" description="单位：token/s · 输出 Tokens ÷ 有效生成总时长">
          {!generation.length ? <ChartEmpty>需要成功 SSE 请求的首字、耗时与输出 usage</ChartEmpty> : <ResponsiveContainer width="100%" height="100%"><BarChart data={generation} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={106} tickFormatter={shortName} tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={value => [`${Number(value).toFixed(1)} token/s`, '生成速度']} />
            <Bar dataKey="generationSpeed" name="生成速度" fill={COLORS.accent} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart></ResponsiveContainer>}
        </ChartCard>
      </div>
    </section>
    <div className="ua-methodology">
      <p>延迟分位仅统计成功请求，失败和取消不进入延迟样本。首字延迟反映最终上游尝试；完成耗时包含整个请求的重试等待。生成速度基于 {count(summary.generationSamples)} 个有效成功 SSE 样本，生成时长为上游完成耗时减首字延迟。</p>
      <p>重试率包含同渠道重试，切换率包含跨渠道尝试。吞吐为所选时间范围内的平均请求数。费用按当前渠道配置的 USD / 百万 Token 价格计算；{summary.unpricedTokens > 0 ? `${count(summary.unpricedTokens)} Tokens 尚未配置价格。` : '未返回 usage 的请求不估算用量或费用。'}</p>
    </div>
  </div>;
}
