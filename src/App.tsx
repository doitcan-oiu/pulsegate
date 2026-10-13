import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Database,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  Globe2,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  Chip,
  Toast,
  Table,
  Alert,
  Avatar,
  Spinner,
  Tabs,
} from "@heroui/react";
import { Button, Input, Select, Switch, Dialog, toast } from "./ui";
import type {
  AttemptRecord,
  BootstrapData,
  DashboardData,
  GatewayApiKey,
  GatewayChannel,
  GatewayLog,
  GatewaySettings,
} from "../shared/types";
import { defaultSettings } from "../shared/types";
import { api, ApiError } from "./api";
import ChannelEditor from "./ChannelEditor";
import { providerModelSuggestions } from "./provider-models";
import ChannelManager from "./ChannelManager";
import ApiKeys from "./ApiKeys";
import RetrySettings from "./RetrySettings";
import Playground from "./Playground";
import UsageAnalytics from "./UsageAnalytics";
import RequestLogs from "./RequestLogs";
import "./app-functional.css";

type Page =
  | "overview"
  | "channels"
  | "keys"
  | "routing"
  | "playground"
  | "requests"
  | "analytics"
  | "settings";
type Session = {
  authenticated: boolean;
  devMode: boolean;
  configured: boolean;
};
const navItems = [
  { id: "overview", label: "网关概览", icon: LayoutDashboard },
  { id: "channels", label: "渠道管理", icon: Server },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "playground", label: "测试场", icon: FlaskConical },
  { id: "requests", label: "请求日志", icon: FileText },
  { id: "analytics", label: "用量分析", icon: TrendingUp },
  { id: "settings", label: "网关设置", icon: Settings2 },
] as const;
const details: Record<
  Page,
  { title: string; description: string; eyebrow: string }
> = {
  overview: {
    title: "网关概览",
    description: "感知每一次响应，让请求始终走向健康的渠道。",
    eyebrow: "GATEWAY OVERVIEW",
  },
  channels: {
    title: "渠道管理",
    description: "管理上游、标签和模型，追踪每个渠道的真实健康状态。",
    eyebrow: "UPSTREAM CHANNELS",
  },
  keys: {
    title: "API Keys",
    description: "为每个应用划定渠道范围，让授权与智能调度一起生效。",
    eyebrow: "ACCESS & PROFILES",
  },
  routing: {
    title: "调度策略",
    description: "从 HTTP 状态到首字延迟，为大模型定义真正的健康标准。",
    eyebrow: "INTELLIGENT ROUTING",
  },
  playground: {
    title: "测试场",
    description: "测试单个渠道或完整网关，查看响应和每一次重试。",
    eyebrow: "MODEL PLAYGROUND",
  },
  requests: {
    title: "请求日志",
    description: "追溯首字延迟、上游错误，以及请求经过的每一个渠道。",
    eyebrow: "REQUEST EXPLORER",
  },
  analytics: {
    title: "用量分析",
    description: "从实际请求记录了解模型用量与运行效率。",
    eyebrow: "USAGE & INSIGHTS",
  },
  settings: {
    title: "网关设置",
    description: "管理网关接入、调度、重试和运行配置。",
    eyebrow: "GATEWAY SETTINGS",
  },
};
const emptyDashboard: DashboardData = {
  totals: {
    requests: 0,
    successRate: 0,
    averageTtft: 0,
    failovers: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  },
  latency: [],
  events: [],
  channels: [],
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";
const count = (value: number) => value.toLocaleString("zh-CN");
const seconds = (value: number | null) =>
  value == null ? "—" : value.toFixed(2) + " s";
const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const resultNames = {
  success: "成功",
  slow: "响应缓慢",
  failover: "已切换",
  error: "失败",
  empty: "空响应",
  cancelled: "已取消",
};
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}
function download(name: string, value: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const Modal = Dialog;
function Badge({
  result,
}: {
  result: keyof typeof resultNames | "healthy" | "degraded" | "offline";
}) {
  const label =
    result in resultNames
      ? resultNames[result as keyof typeof resultNames]
      : { healthy: "健康", degraded: "延迟异常", offline: "不可用" }[
          result as "healthy"
        ];
  return (
    <Chip
      size="sm"
      variant="soft"
      color={
        result === "error" || result === "offline"
          ? "danger"
          : result === "slow" || result === "degraded" || result === "empty"
            ? "warning"
            : result === "failover"
              ? "accent"
              : result === "cancelled"
                ? "default"
                : "success"
      }
    >
      {label}
    </Chip>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="fn-empty">
      <Activity size={30} />
      <p>{children}</p>
    </div>
  );
}
function Heading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Card.Header className="panel-heading">
      <div>
        <Card.Title>{title}</Card.Title>
        {subtitle && <Card.Description>{subtitle}</Card.Description>}
      </div>
      {action}
    </Card.Header>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [settingsTab, setSettingsTab] = useState("connection");
  const [mobileNav, setMobileNav] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [token, setToken] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [channels, setChannels] = useState<GatewayChannel[]>([]);
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [settings, setSettings] = useState<GatewaySettings>(defaultSettings);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [range, setRange] = useState("24h");
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<GatewayChannel | "new" | null>(null);
  const [guide, setGuide] = useState(false);
  const [playChannel, setPlayChannel] = useState<string>();
  const [playVersion, setPlayVersion] = useState(0);
  const [logs, setLogs] = useState<GatewayLog[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsClearing, setLogsClearing] = useState(false);
  const logsRequestId = useRef(0);
  const logsClearingRef = useRef(false);
  const logDetailRequestId = useRef(0);
  const [logDetail, setLogDetail] = useState<{
    log: GatewayLog;
    attempts: AttemptRecord[];
  } | null>(null);
  const seenEvent = useRef<string | null>(null);
  const startSession = useCallback(async () => {
    setConnectionError("");
    try {
      let next = await api<Session>("/api/session");
      if (!next.authenticated && next.devMode) {
        await api("/api/session", {
          method: "POST",
          body: JSON.stringify({ dev: true }),
        });
        next = await api<Session>("/api/session");
      }
      setSession(next);
    } catch (e) {
      setConnectionError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void startSession();
  }, [startSession]);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const [bootstrap, metrics] = await Promise.all([
          api<BootstrapData>("/api/bootstrap"),
          api<DashboardData>("/api/dashboard?range=" + range),
        ]);
        setChannels(bootstrap.channels);
        setKeys(bootstrap.keys);
        setTags(bootstrap.tags);
        setSettings(bootstrap.settings);
        setDashboard(metrics);
        setReady(true);
        setConnectionError("");
        const latest = metrics.events[0];
        if (
          seenEvent.current &&
          latest &&
          latest.id !== seenEvent.current &&
          bootstrap.settings.notifications
        )
          toast(latest.title, { description: latest.description });
        if (latest) seenEvent.current = latest.id;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setSession((old) => (old ? { ...old, authenticated: false } : old));
          setReady(false);
        } else {
          setConnectionError(errorText(e));
          if (!quiet) toast.error(errorText(e));
        }
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [range],
  );
  useEffect(() => {
    if (session?.authenticated) void refresh();
  }, [session?.authenticated, refresh]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [session?.authenticated, refresh]);
  const refreshLogs = useCallback(async () => {
    if (logsClearingRef.current) return;
    const requestId = ++logsRequestId.current;
    setLogsLoading(true);
    const params = new URLSearchParams({
      limit: "25",
      offset: String((logPage - 1) * 25),
      q: query,
      result,
    });
    try {
      const data = await api<{ logs: GatewayLog[]; total: number }>(
        "/api/logs?" + params,
      );
      if (requestId !== logsRequestId.current || logsClearingRef.current) return;
      setLogs(data.logs);
      setTotalLogs(data.total);
      if (logPage > 1 && (logPage - 1) * 25 >= data.total)
        setLogPage(Math.max(1, Math.ceil(data.total / 25)));
    } catch (e) {
      if (requestId === logsRequestId.current) toast.error(errorText(e));
    } finally {
      if (requestId === logsRequestId.current) setLogsLoading(false);
    }
  }, [logPage, query, result]);
  useEffect(() => {
    if (session?.authenticated && page === "requests") {
      const timer = setTimeout(() => void refreshLogs(), 250);
      return () => clearTimeout(timer);
    }
  }, [page, session?.authenticated, refreshLogs, dashboard]);
  const navigate = (next: Page) => {
    if (next === "routing") { setSettingsTab("routing"); setPage("settings"); }
    else { if (next === "settings") setSettingsTab("connection"); setPage(next); }
    setMobileNav(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
  const playground = (id?: string) => {
    setPlayChannel(id);
    setPlayVersion((n) => n + 1);
    navigate("playground");
  };
  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    try {
      await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setToken("");
      await startSession();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoginBusy(false);
    }
  }
  async function saveSettings(next: GatewaySettings) {
    const response = await api<{ settings: GatewaySettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(next),
    });
    setSettings(response.settings);
    await refresh(true);
  }
  async function showLog(id: string) {
    if (logsClearingRef.current) return;
    const requestId = ++logDetailRequestId.current;
    try {
      const detail = await api<{ log: GatewayLog; attempts: AttemptRecord[] }>("/api/logs/" + encodeURIComponent(id));
      if (requestId === logDetailRequestId.current && !logsClearingRef.current) setLogDetail(detail);
    } catch (e) {
      if (requestId === logDetailRequestId.current) toast.error(errorText(e));
    }
  }
  async function clearLogs() {
    if (logsClearingRef.current) return;
    logsClearingRef.current = true;
    setLogsClearing(true);
    setLogsLoading(false);
    ++logsRequestId.current;
    ++logDetailRequestId.current;
    try {
      await api("/api/logs", { method: "DELETE" });
      setLogs([]);
      setTotalLogs(0);
      setQuery("");
      setResult("");
      setLogPage(1);
      setLogDetail(null);
      toast.success("全部请求日志已清空");
      await refresh(true);
    } catch (error) {
      toast.error(errorText(error));
      throw error;
    } finally {
      logsClearingRef.current = false;
      setLogsClearing(false);
    }
  }
  async function exportLogs() {
    try {
      const data = await api<{ logs: GatewayLog[]; total: number }>(
        "/api/logs?limit=200&q=" +
          encodeURIComponent(query) +
          "&result=" +
          result,
      );
      const rows = [
        [
          "请求 ID",
          "时间",
          "模型",
          "渠道",
          "流式",
          "首字(s)",
          "完成(s)",
          "HTTP",
          "结果",
          "尝试次数",
        ],
        ...data.logs.map((l) => [
          l.id,
          dateTime(l.createdAt),
          l.model,
          l.channel,
          l.stream ? "是" : "否",
          l.ttft,
          l.duration,
          l.status,
          resultNames[l.result],
          l.attempts,
        ]),
      ];
      download(
        "pulsegate-requests.csv",
        "\uFEFF" +
          rows
            .map((row) =>
              row
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\r\n"),
        "text/csv;charset=utf-8",
      );
      toast.success(
        "已导出 " + data.logs.length + " 条记录（每次最多 200 条）",
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  const visibleChannels = channels.filter((c) => !c.archived);
  const healthy = visibleChannels.filter(
    (c) => c.enabled && c.status === "healthy",
  );
  const abnormal = visibleChannels.filter(
    (c) => c.enabled && c.status !== "healthy",
  );
  const totals = dashboard.totals;
  const metrics = [
    {
      label: "实际请求",
      value: count(totals.requests),
      unit: "次",
      icon: Activity,
      caption: "API / 测试场，不含健康探测",
    },
    {
      label: "请求成功率",
      value: totals.requests ? totals.successRate.toFixed(1) : "—",
      unit: "%",
      icon: ShieldCheck,
      caption: "包含成功切换后的请求",
    },
    {
      label: "平均有效首字",
      value: totals.averageTtft ? totals.averageTtft.toFixed(2) : "—",
      unit: "s",
      icon: Zap,
      caption: "健康阈值 " + settings.threshold + " s",
    },
    {
      label: "成功故障转移",
      value: count(totals.failovers),
      unit: "次",
      icon: GitBranch,
      caption: "在授权范围内自动切换",
    },
  ];
  const toaster = <Toast.Provider placement="bottom end" />;
  if (!session || !session.authenticated || !ready)
    return (
      <div className="fn-login">
        {toaster}
        <div className="fn-login-card">
          <div className="brand-icon">
            <Activity size={28} />
          </div>
          <h1>PulseGate</h1>
          <p>智能大模型网关</p>
          {connectionError ? (
            <>
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>
                    无法连接管理服务：{connectionError}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
              <p className="fn-muted">
                本地开发请运行 npm run setup:local 和 npm run dev。
              </p>
              <Button
                className="button button-primary"
                onClick={() =>
                  void (session?.authenticated ? refresh() : startSession())
                }
              >
                <RefreshCw size={16} />
                重新连接
              </Button>
            </>
          ) : !session || session.authenticated ? (
            <p className="fn-loading">
              <Spinner size="sm" />
              正在连接 D1 工作空间…
            </p>
          ) : (
            <form onSubmit={login}>
              <div className="form-field">
                <span>管理员令牌</span>
                <Input
                  aria-label={"管理员令牌"}
                  required
                  type="password"
                  autoComplete="current-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ADMIN_TOKEN"
                />
              </div>
              {!session.configured && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      请先为 Worker 配置 ADMIN_TOKEN 和 ENCRYPTION_KEY。
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <Button
                type="submit"
                className="button button-primary"
                disabled={loginBusy || !session.configured}
              >
                {loginBusy ? "登录中…" : "进入工作空间"}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      {toaster}
      {mobileNav && (
        <div className="nav-overlay" onClick={() => setMobileNav(false)} />
      )}
      <aside className={"sidebar " + (mobileNav ? "open" : "")}>
        <a
          href="#overview"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <div className="brand-icon">
            <Activity size={25} strokeWidth={2.3} />
          </div>
          <div>
            PulseGate<span>智能大模型网关</span>
          </div>
        </a>
        <Button
          className="workspace-picker"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-icon">
            <Layers size={18} />
          </span>
          <span>
            <strong>默认工作空间</strong>
            <small>
              {session.devMode ? "Local D1 workspace" : "Cloudflare workspace"}
            </small>
          </span>
          <ChevronDown size={14} />
        </Button>
        <div className="nav-section-label">
          工作空间 <span>WORKSPACE</span>
        </div>
        <nav aria-label="主导航">
          {navItems.map((item) => (
            <Button
              variant={page === item.id ? "primary" : "ghost"}
              key={item.id}
              className={"nav-item " + (page === item.id ? "selected" : "")}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "channels" ? (
                <Chip size="sm" variant="soft">
                  {visibleChannels.length}
                </Chip>
              ) : (
                page === item.id && <span className="nav-active-dot" />
              )}
            </Button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Button className="sidebar-help" onClick={() => setGuide(true)}>
            <BookOpen size={17} />
            使用指南
            <ArrowUpRight size={13} />
          </Button>
          <div className="sidebar-user">
            <Avatar size="sm">
              <Avatar.Fallback>D</Avatar.Fallback>
            </Avatar>
            <div>
              <strong>Administrator</strong>
              <small>
                {session.devMode ? "本地开发环境" : "Cloudflare Workers"}
              </small>
            </div>
            <Button
              className="icon-button"
              aria-label="网关设置"
              onClick={() => navigate("settings")}
            >
              <Settings2 size={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </Button>
            <Globe2 size={15} />
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{details[page].title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="fn-environment">
              <Database size={13} />
              D1 已连接
            </span>
            <Chip size="sm" variant="soft">
              {session.devMode ? "LOCAL" : "WORKERS"}
            </Chip>
            <Button
              className="topbar-avatar"
              isIconOnly
              variant="ghost"
              aria-label="管理设置"
              onClick={() => navigate("settings")}
            >
              <Avatar size="sm">
                <Avatar.Fallback>D</Avatar.Fallback>
              </Avatar>
            </Button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{details[page].eyebrow}</div>
              <h1>
                {details[page].title}
                <span className="page-title-dot" />
              </h1>
              <p>{details[page].description}</p>
            </div>
            <div className="heading-actions">
              {["overview", "analytics"].includes(page) && (
                <Select
                  className="fn-range"
                  aria-label="统计时间范围"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <option value="1h">最近 1 小时</option>
                  <option value="24h">最近 24 小时</option>
                  <option value="7d">最近 7 天</option>
                </Select>
              )}
              <Button
                className={
                  "button button-secondary refresh-button " +
                  (refreshing || (page === "requests" && logsLoading) ? "refreshing" : "")
                }
                onClick={() => {
                  void refresh();
                  if (page === "requests") void refreshLogs();
                }}
                disabled={refreshing || (page === "requests" && (logsLoading || logsClearing))}
              >
                <RefreshCw size={14} />
                刷新
              </Button>
              {page === "channels" && (
                <Button
                  className="button button-primary"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={15} />
                  添加渠道
                </Button>
              )}
              {page === "requests" && (
                <Button
                  className="button button-primary"
                  onClick={() => void exportLogs()}
                  disabled={logsClearing}
                >
                  <Download size={15} />
                  导出日志
                </Button>
              )}
            </div>
          </div>
          {connectionError && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  数据刷新失败：{connectionError}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {page === "overview" && (
            <>
              <div className="health-banner">
                <div className="health-banner-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <strong>
                    {visibleChannels.length
                      ? healthy.length +
                        " 个健康渠道 · " +
                        abnormal.length +
                        " 个异常渠道"
                      : "工作空间已就绪，添加第一个上游渠道"}
                  </strong>
                  <span>
                    {visibleChannels.length
                      ? "最近 " +
                        settings.window +
                        " 次尝试判断健康，连续 " +
                        settings.recovery +
                        " 次健康探测后恢复。"
                      : "配置真实上游，或在测试场创建本地测试渠道验证故障切换。"}
                  </span>
                </div>
                <Button
                  onClick={() =>
                    navigate(visibleChannels.length ? "routing" : "playground")
                  }
                >
                  {visibleChannels.length ? "查看策略" : "打开测试场"}
                  <ArrowRight size={13} />
                </Button>
              </div>
              <div className="metrics-grid">
                {metrics.map((m) => (
                  <Card className="metric-card" key={m.label}>
                    <div className="metric-top">
                      {m.label}
                      <div className="metric-icon">
                        <m.icon size={17} />
                      </div>
                    </div>
                    <div className="metric-value">
                      {m.value}
                      <span>{m.unit}</span>
                    </div>
                    <div className="metric-bottom">
                      <small>{m.caption}</small>
                    </div>
                  </Card>
                ))}
              </div>
              <div className="overview-grid">
                <Card className="panel latency-panel">
                  <Heading
                    title="首字延迟趋势"
                    subtitle="仅统计真实 SSE 请求的有效首字延迟"
                  />
                  <div className="fn-chart-legend">
                    <span>
                      <i style={{ background: "var(--accent)" }} />
                      优先渠道
                    </span>
                    <span>
                      <i style={{ background: "var(--success)" }} />
                      其他渠道
                    </span>
                    <span>阈值 {settings.threshold}s</span>
                  </div>
                  <LatencyChart
                    data={dashboard.latency}
                    threshold={settings.threshold}
                  />
                </Card>
                <Card className="panel routing-panel">
                  <Heading
                    title="当前调度"
                    subtitle="先权限筛选，再选择健康渠道"
                  />
                  <div className="fn-routing">
                    <div className="fn-route-mode">
                      <GitBranch size={20} />
                      <strong>
                        {
                          {
                            failover: "故障转移",
                            adaptive: "低延迟优先",
                            "round-robin": "轮询",
                            weighted: "加权随机",
                            "circuit-breaker": "熔断保护",
                          }[settings.strategy]
                        }
                      </strong>
                    </div>
                    <dl>
                      <div>
                        <dt>有效首字超时</dt>
                        <dd>
                          {settings.streamFirstTokenTimeout
                            ? settings.streamFirstTokenTimeout + " s"
                            : "已关闭"}
                        </dd>
                      </div>
                      <div>
                        <dt>同渠道 / 跨渠道重试</dt>
                        <dd>
                          {settings.maxSameChannelRetries} /{" "}
                          {settings.maxChannelRetries}
                        </dd>
                      </div>
                      <div>
                        <dt>会话粘性</dt>
                        <dd>
                          {settings.stickyMode === "prefer"
                            ? "trace → thread"
                            : "关闭"}
                        </dd>
                      </div>
                    </dl>
                    <Button
                      className="button button-secondary"
                      onClick={() => playground()}
                    >
                      <FlaskConical size={15} />
                      验证调度策略
                    </Button>
                  </div>
                </Card>
                <Card className="panel channels-panel">
                  <Heading
                    title="渠道健康"
                    subtitle="最近的实际尝试与窗口平均值"
                    action={
                      <Button
                        className="text-button"
                        onClick={() => navigate("channels")}
                      >
                        全部渠道
                        <ChevronRight size={14} />
                      </Button>
                    }
                  />
                  <div className="table-scroll">
                    <Table>
                      <Table.ScrollContainer>
                        <Table.Content
                          aria-label="渠道健康"
                          className="channel-table compact"
                          onRowAction={(id) => {
                            const found = channels.find(
                              (channel) => channel.id === String(id),
                            );
                            if (found) setEditor(found);
                          }}
                        >
                          <Table.Header>
                            <Table.Column id="column-0" isRowHeader>
                              渠道
                            </Table.Column>
                            <Table.Column id="column-1">状态</Table.Column>
                            <Table.Column id="column-2">平均首字</Table.Column>
                            <Table.Column id="column-3">请求</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {visibleChannels.slice(0, 6).map((c) => (
                              <Table.Row key={c.id} id={c.id}>
                                <Table.Cell>
                                  <strong>{c.name}</strong>
                                </Table.Cell>
                                <Table.Cell>
                                  <Badge
                                    result={c.enabled ? c.status : "offline"}
                                  />
                                </Table.Cell>
                                <Table.Cell className="mono">
                                  {seconds(c.health.averageTtft)}
                                </Table.Cell>
                                <Table.Cell className="mono">
                                  {count(c.requests)}
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </div>
                  {!visibleChannels.length && (
                    <Empty>还没有渠道，添加上游后即可开始调度。</Empty>
                  )}
                </Card>
                <Card className="panel events-panel">
                  <Heading
                    title="调度事件"
                    subtitle="健康判定、切换与恢复的实际记录"
                  />
                  <div className="fn-events">
                    {dashboard.events.slice(0, 5).map((event) => (
                      <div className="fn-event" key={event.id}>
                        <span className={"fn-event-symbol fn-" + event.type}>
                          <Activity size={15} />
                        </span>
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.description}</p>
                          <small>{dateTime(event.createdAt)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!dashboard.events.length && <Empty>还没有调度事件。</Empty>}
                </Card>
              </div>
            </>
          )}
          {page === "channels" && (
            <ChannelManager
              channels={channels}
              setChannels={setChannels}
              onEdit={setEditor}
              onNavigateKeys={() => {
                void refresh(true);
                navigate("keys");
              }}
              onNavigatePlayground={playground}
              onRefresh={() => refresh(true)}
            />
          )}
          {page === "keys" && (
            <ApiKeys
              channels={channels}
              keys={keys}
              tags={tags}
              onChange={() => refresh(true)}
            />
          )}
          {page === "playground" && (
            <Playground
              key={playVersion}
              channels={channels}
              keys={keys}
              initialChannelId={playChannel}
              onRefresh={() => refresh(true)}
              devMode={session.devMode}
            />
          )}
          {page === "requests" && (
            <RequestLogs
              logs={logs}
              total={totalLogs}
              query={query}
              result={result}
              page={logPage}
              loading={logsLoading}
              clearing={logsClearing}
              onQuery={(value) => { if (value === query) return; ++logsRequestId.current; setLogsLoading(true); setQuery(value); setLogPage(1); }}
              onResult={(value) => { if (value === result) return; ++logsRequestId.current; setLogsLoading(true); setResult(value); setLogPage(1); }}
              onPage={(value) => { ++logsRequestId.current; setLogsLoading(true); setLogPage(value); }}
              onOpen={(id) => void showLog(id)}
              onClear={clearLogs}
            />
          )}
          {page === "analytics" && <UsageAnalytics dashboard={dashboard} />}
          {page === "settings" && (
            <Tabs selectedKey={settingsTab} onSelectionChange={(id) => setSettingsTab(String(id))} variant="secondary" className="fn-settings-tabs">
              <Tabs.ListContainer>
                <Tabs.List aria-label="网关设置分类">
                  <Tabs.Tab id="connection">接入与运行<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="routing">调度与健康<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="connection" shouldForceMount className={settingsTab === "connection" ? "" : "fn-hidden-panel"}>
            <ConnectionSettings
              settings={settings}
              devMode={session.devMode}
              onSave={async (patch) => {
                const response = await api<{ settings: GatewaySettings }>(
                  "/api/settings",
                  { method: "PATCH", body: JSON.stringify(patch) },
                );
                setSettings(response.settings);
                await refresh(true);
              }}
              onLogout={async () => {
                await api("/api/session", { method: "DELETE" });
                setSession((old) =>
                  old ? { ...old, authenticated: false } : old,
                );
                setReady(false);
              }}
            />
              </Tabs.Panel>
              <Tabs.Panel id="routing" shouldForceMount className={settingsTab === "routing" ? "fn-policy" : "fn-hidden-panel"}>
                <RetrySettings settings={settings} onSave={saveSettings} />
              </Tabs.Panel>
            </Tabs>
          )}
          <footer className="page-footer">
            <span>PulseGate · Workers + D1</span>
            <span>
              数据来自实际请求 · {session.devMode ? "本地运行" : "Cloudflare"}
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <ChannelEditor
          key={editor === "new" ? "new" : editor.id}
          channel={editor === "new" ? undefined : editor}
          devMode={session.devMode}
          tags={tags}
          modelSuggestions={providerModelSuggestions}
          close={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh(true);
          }}
        />
      )}
      {logDetail && (
        <Modal title="请求追踪" close={() => setLogDetail(null)} wide>
          <div className="fn-detail">
            <div className="fn-detail-summary">
              <code>{logDetail.log.id}</code>
              <Button
                className="icon-button"
                aria-label="复制请求 ID"
                onClick={() => void copy(logDetail.log.id)}
              >
                <Copy size={15} />
              </Button>
              <Badge result={logDetail.log.result} />
            </div>
            <p>
              {dateTime(logDetail.log.createdAt)} · {logDetail.log.model} ·{" "}
              {logDetail.log.stream ? "SSE" : "JSON"}
            </p>
            {logDetail.log.error && (
              <pre className="fn-error-pre">{logDetail.log.error}</pre>
            )}
            <ol className="fn-attempts">
              {logDetail.attempts.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.channelName}</strong>
                    <Badge result={a.result} />
                  </div>
                  <p>
                    {a.model} · HTTP {a.status} · 首字 {seconds(a.ttft)} · 完成{" "}
                    {seconds(a.duration)}
                  </p>
                  <small>
                    {a.inputTokens} 输入 / {a.outputTokens} 输出 Tokens ·{" "}
                    {a.credentialId
                      ? "密钥 " + a.credentialId.slice(0, 8)
                      : "无上游密钥"}
                  </small>
                  {a.error && <pre>{a.error}</pre>}
                </li>
              ))}
            </ol>
            {!logDetail.attempts.length && <Empty>此请求尚未到达上游。</Empty>}
          </div>
        </Modal>
      )}
      {guide && (
        <Modal title="开始使用 PulseGate" close={() => setGuide(false)}>
          <div className="fn-guide">
            <ol>
              <li>
                在渠道管理添加上游，选择模型获取与渠道测试的接口类型，填写基础 URL、模型 ID 与上游密钥。
              </li>
              <li>创建 API Key，通过标签、指定渠道和模型白名单限制访问。</li>
              <li>配置首字健康阈值、超时、重试次数和自动恢复。</li>
              <li>在测试场测试单渠道或 API Key 的完整路由，展开请求追踪。</li>
            </ol>
            <div className="fn-code">
              <code>{location.origin}/v1/chat/completions</code>
              <Button
                className="icon-button"
                aria-label="复制网关地址"
                onClick={() => void copy(location.origin + "/v1")}
              >
                <Copy size={16} />
              </Button>
            </div>
            <p>
              OpenAI Chat Completions 使用 Authorization: Bearer pg_live_…；
              Anthropic Messages 使用 /v1/messages 和 x-api-key: pg_live_…。
              完整 API Key 仅创建或轮换时显示一次。
            </p>
            <p>
              公开调用保持客户端入口路径和请求格式，不按渠道接口类型转换参数；
              NewAPI / Sub2API 余额监控独立开启。
            </p>
            {session.devMode && (
              <p>
                本地测试渠道可模拟延迟、HTTP
                错误、空响应、暂时失败与流中断，不会调用真实模型。
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function LatencyChart({
  data,
  threshold,
}: {
  data: DashboardData["latency"];
  threshold: number;
}) {
  if (!data.length)
    return <Empty>发起流式请求后，这里会显示真实首字延迟。</Empty>;
  return (
    <div className="fn-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 16, right: 22, bottom: 10, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="time"
            tickFormatter={(value) =>
              new Date(value).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Shanghai",
              })
            }
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            unit="s"
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(value) => dateTime(String(value))}
            formatter={(value, name) => [
              typeof value === "number" ? value.toFixed(2) + " s" : "—",
              name,
            ]}
            contentStyle={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <ReferenceLine
            y={threshold}
            stroke="var(--warning)"
            strokeDasharray="4 4"
          />
          <Line
            name="优先渠道"
            dataKey="primary"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
          <Line
            name="其他渠道"
            dataKey="backup"
            stroke="var(--success)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ConnectionSettings({
  settings,
  devMode,
  onSave,
  onLogout,
}: {
  settings: GatewaySettings;
  devMode: boolean;
  onSave: (
    patch: Partial<GatewaySettings> & {
      aiGatewayToken?: string;
      clearAiGatewayToken?: boolean;
    },
  ) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [account, setAccount] = useState(settings.account);
  const [gateway, setGateway] = useState(settings.gateway);
  const [enabled, setEnabled] = useState(settings.aiGatewayEnabled);
  const [secret, setSecret] = useState("");
  const [clear, setClear] = useState(false);
  const [retention, setRetention] = useState(settings.logRetentionDays);
  const [notifications, setNotifications] = useState(settings.notifications);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        account,
        gateway,
        aiGatewayEnabled: enabled,
        notifications,
        logRetentionDays: retention,
        ...(secret ? { aiGatewayToken: secret } : {}),
        ...(clear ? { clearAiGatewayToken: true } : {}),
      });
      setSecret("");
      setClear(false);
      toast.success("网关设置已保存");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <Card className="panel">
        <Heading
          title="Cloudflare AI Gateway"
          subtitle="按渠道选择直连或自定义服务商接入"
        />
        <form className="fn-settings-form" onSubmit={save}>
          <div className="fn-connection-title">
            <Cloud size={24} />
            <div>
              <strong>Cloudflare</strong>
              <small>Custom provider routing</small>
            </div>
          </div>
          <div className="fn-checkbox">
            <Switch
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            >
              启用 AI Gateway 接入
            </Switch>
          </div>
          <div className="form-field">
            <span>Cloudflare Account ID</span>
            <Input
              aria-label={"Cloudflare Account ID"}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="账户 ID"
            />
          </div>
          <div className="form-field">
            <span>Gateway ID</span>
            <Input
              aria-label={"Gateway ID"}
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              placeholder="网关名称"
            />
          </div>
          <div className="form-field">
            <span>AI Gateway 认证令牌</span>
            <Input
              aria-label={"AI Gateway 认证令牌"}
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setClear(false);
              }}
              placeholder={
                settings.hasAiGatewayToken
                  ? "已配置；留空保留当前令牌"
                  : "仅当 AI Gateway 开启认证时需要"
              }
            />
            <small>
              加密保存，使用 cf-aig-authorization；上游密钥独立管理。
            </small>
          </div>
          {settings.hasAiGatewayToken && (
            <div className="fn-checkbox">
              <Switch
                checked={clear}
                onChange={(e) => {
                  setClear(e.target.checked);
                  if (e.target.checked) setSecret("");
                }}
              >
                清除已保存的 AI Gateway 令牌
              </Switch>
            </div>
          )}
          <div className="fn-divider" />
          <div className="form-field">
            <span>日志保留天数</span>
            <Input
              aria-label={"日志保留天数"}
              type="number"
              required
              min={1}
              max={3650}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
            <small>定时任务清理过期请求、尝试与调度事件。</small>
          </div>
          <div className="fn-checkbox">
            <Switch
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            >
              页面打开时通知新的调度事件
            </Switch>
          </div>
          <Button
            type="submit"
            className="button button-primary"
            disabled={busy}
          >
            {busy ? "保存中…" : "保存设置"}
          </Button>
        </form>
      </Card>
      <Card className="panel">
        <Heading title="运行环境" subtitle="实际服务与存储连接" />
        <div className="fn-runtime">
          <div>
            <Database size={20} />
            <strong>Cloudflare D1</strong>
            <span>{devMode ? "本地持久化 SQLite" : "托管数据库"}</span>
          </div>
          <div>
            <ShieldCheck size={20} />
            <strong>凭证保护</strong>
            <span>上游 AES-GCM · 网关 Key SHA-256</span>
          </div>
          <div>
            <Activity size={20} />
            <strong>状态协调</strong>
            <span>Durable Object 串行更新健康、配额和限流</span>
          </div>
          <div className="fn-code">
            <code>{location.origin}/v1</code>
            <Button
              className="icon-button"
              aria-label="复制 API 基础地址"
              onClick={() => void copy(location.origin + "/v1")}
            >
              <Copy size={16} />
            </Button>
          </div>
          <p className="fn-muted">
            管理员通过 HttpOnly 会话访问控制台。部署所需密钥和 D1 迁移步骤见项目
            README。
          </p>
          <Button
            className="button button-secondary"
            onClick={() =>
              void onLogout().catch((e) => toast.error(errorText(e)))
            }
          >
            <LogOut size={15} />
            退出管理会话
          </Button>
        </div>
      </Card>
    </div>
  );
}
