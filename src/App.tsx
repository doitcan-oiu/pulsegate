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
  X,
} from "lucide-react";
import Overview from "./Overview";
import {
  Card,
  Chip,
  Toast,
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
import { csvCell } from "./csv";
import ChannelEditor from "./ChannelEditor";
import { providerModelSuggestions } from "./provider-models";
import ChannelManager from "./ChannelManager";
import ApiKeys from "./ApiKeys";
import RetrySettings from "./RetrySettings";
import Playground from "./Playground";
import UsageAnalytics from "./UsageAnalytics";
import RequestLogs from "./RequestLogs";
import ConsoleErrorBoundary from "./ConsoleErrorBoundary";
import { consoleRouteHash, readConsoleRoute } from "./navigation";
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
    description: "查看请求流量、渠道健康与近期调度事件。",
    eyebrow: "GATEWAY OVERVIEW",
  },
  channels: {
    title: "渠道管理",
    description: "统一管理上游连接、模型与渠道访问范围。",
    eyebrow: "UPSTREAM CHANNELS",
  },
  keys: {
    title: "API Keys",
    description: "管理应用访问凭证，以及渠道、模型和请求额度权限。",
    eyebrow: "ACCESS & PROFILES",
  },
  routing: {
    title: "调度策略",
    description: "从 HTTP 状态到首字延迟，为大模型定义真正的健康标准。",
    eyebrow: "INTELLIGENT ROUTING",
  },
  playground: {
    title: "测试场",
    description: "验证模型响应，定位渠道连接与请求问题。",
    eyebrow: "MODEL PLAYGROUND",
  },
  requests: {
    title: "请求日志",
    description: "检索请求记录，追踪延迟、错误与重试过程。",
    eyebrow: "REQUEST EXPLORER",
  },
  analytics: {
    title: "用量分析",
    description: "分析请求表现、模型用量与渠道运行效率。",
    eyebrow: "USAGE & INSIGHTS",
  },
  settings: {
    title: "网关设置",
    description: "配置网关接入、请求调度、健康检查与恢复策略。",
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
const hasDashboardMetrics = (value: { events: DashboardData["events"] }): value is DashboardData =>
  "totals" in value && "latency" in value && "channels" in value;
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
  const [page, setPage] = useState<Page>(() => readConsoleRoute().page);
  const [settingsTab, setSettingsTab] = useState(() => readConsoleRoute().settingsTab);
  const [playgroundVisited, setPlaygroundVisited] = useState(() => readConsoleRoute().page === "playground");
  const [settingsVisited, setSettingsVisited] = useState(() => readConsoleRoute().page === "settings");
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [metricsError, setMetricsError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshRequestId = useRef(0);
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
  const [logsError, setLogsError] = useState("");
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
      const requestId = ++refreshRequestId.current;
      if (!quiet) setRefreshing(true);
      try {
        const needsMetrics = page === "overview" || page === "analytics";
        const [configuration, activity] = await Promise.allSettled([
          api<BootstrapData>("/api/bootstrap"),
          needsMetrics
            ? api<DashboardData>("/api/dashboard?range=" + range)
            : api<{ events: DashboardData["events"] }>("/api/events"),
        ]);
        if (requestId !== refreshRequestId.current) return;
        if (configuration.status === "rejected") throw configuration.reason;
        const bootstrap = configuration.value;
        setChannels(bootstrap.channels);
        setKeys(bootstrap.keys);
        setTags(bootstrap.tags);
        setSettings(bootstrap.settings);
        setReady(true);
        setConnectionError("");
        setLastUpdated(new Date());
        if (activity.status === "rejected") {
          if (needsMetrics) setMetricsError(errorText(activity.reason));
          return;
        }
        if (hasDashboardMetrics(activity.value)) {
          setDashboard(activity.value);
          setMetricsError("");
        }
        const latest = activity.value.events[0];
        if (
          seenEvent.current &&
          latest &&
          latest.id !== seenEvent.current &&
          bootstrap.settings.notifications
        )
          toast(latest.title, { description: latest.description });
        if (latest) seenEvent.current = latest.id;
      } catch (e) {
        if (requestId !== refreshRequestId.current) return;
        if (e instanceof ApiError && e.status === 401) {
          setSession((old) => (old ? { ...old, authenticated: false } : old));
          setReady(false);
        } else {
          setConnectionError(errorText(e));
          if (!quiet) toast.error(errorText(e));
        }
      } finally {
        if (requestId === refreshRequestId.current) setRefreshing(false);
      }
    },
    [range, page],
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
    setLogsError("");
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
      if (requestId === logsRequestId.current) {
        setLogs([]);
        setTotalLogs(0);
        setLogsError(errorText(e));
      }
    } finally {
      if (requestId === logsRequestId.current) setLogsLoading(false);
    }
  }, [logPage, query, result]);
  useEffect(() => {
    if (session?.authenticated && page === "requests") {
      const timer = setTimeout(() => void refreshLogs(), 250);
      return () => clearTimeout(timer);
    }
  }, [page, session?.authenticated, refreshLogs]);
  useEffect(() => {
    if (!session?.authenticated || page !== "requests") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshLogs();
    }, 15000);
    return () => clearInterval(timer);
  }, [page, session?.authenticated, refreshLogs]);
  useEffect(() => {
    const restore = () => {
      const route = readConsoleRoute();
      setPage(route.page);
      setSettingsTab(route.settingsTab);
      if (route.page === "playground") setPlaygroundVisited(true);
      if (route.page === "settings") setSettingsVisited(true);
      setMobileNav(false);
    };
    if (!window.location.hash) window.history.replaceState(null, "", consoleRouteHash(page, settingsTab));
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  useEffect(() => { document.title = `${details[page].title} · PulseGate`; }, [page]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => { setMobileViewport(media.matches); if (!media.matches) setMobileNav(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !mobileViewport) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>(".console-nav-close")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
    };
  }, [mobileNav, mobileViewport]);
  const navigate = (next: Page) => {
    const destination = next === "routing" ? "settings" : next;
    const tab = next === "routing" ? "routing" : "connection";
    const hash = consoleRouteHash(destination, tab);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setPage(destination);
    if (destination === "settings") { setSettingsVisited(true); setSettingsTab(tab); }
    if (destination === "playground") setPlaygroundVisited(true);
    setMobileNav(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    requestAnimationFrame(() => document.getElementById("page-title")?.focus({ preventScroll: true }));
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
  async function saveSettings(_next: GatewaySettings, patch: Partial<GatewaySettings>) {
    const response = await api<{ settings: GatewaySettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
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
                .map(csvCell)
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
      <a className="console-skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main-content")?.focus();
      }}>跳转到主要内容</a>
      {mobileNav && (
        <div className="nav-overlay" onClick={() => setMobileNav(false)} />
      )}
      <aside ref={sidebarRef} id="console-navigation" className={"sidebar " + (mobileNav ? "open" : "")}
        inert={mobileViewport && !mobileNav ? true : undefined}
        role={mobileViewport && mobileNav ? "dialog" : undefined}
        aria-modal={mobileViewport && mobileNav ? true : undefined}
        aria-label="控制台导航"
        onKeyDown={(event) => {
          if (!mobileViewport || !mobileNav) return;
          if (event.key === "Escape") { event.preventDefault(); setMobileNav(false); }
          if (event.key !== "Tab") return;
          const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
          if (!focusable?.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <Button className="icon-button console-nav-close" variant="ghost" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={18} /></Button>
        <a
          href="#overview"
          className="brand"
          title="PulseGate"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <div className="brand-icon">
            <Activity size={25} strokeWidth={2.3} />
          </div>
          <div>
            PulseGate
          </div>
        </a>
        <Button
          className="workspace-picker"
          title="默认工作空间"
          aria-label="默认工作空间设置"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-icon">
            <Layers size={18} />
          </span>
          <span>
            <strong>默认工作空间</strong>
            <small>
              {session.devMode ? "Local workspace" : "Production"}
            </small>
          </span>
          <ChevronDown size={14} />
        </Button>
        <div className="nav-section-label">
          工作区
        </div>
        <nav aria-label="主导航">
          {navItems.map((item, index) => (
            <div className="console-nav-entry" key={item.id}>
              {index === 3 && <div className="console-nav-group">监控与调试</div>}
            <Button
              variant="ghost"
              aria-current={page === item.id ? "page" : undefined}
              title={item.label}
              aria-label={item.label}
              className={"nav-item " + (page === item.id ? "selected" : "")}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "channels" ? (
                <Chip size="sm" variant="soft">
                  {visibleChannels.length}
                </Chip>
              ) : null}
            </Button>
            </div>
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
              <strong>管理员</strong>
              <small>{session.devMode ? "本地环境" : "生产环境"}</small>
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
      <div className="main-shell" inert={mobileViewport && mobileNav ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              aria-expanded={mobileNav}
              aria-controls="console-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </Button>
            <Globe2 size={15} />
            <span>默认工作空间</span>
            <ChevronRight size={13} />
            <strong>{details[page].title}</strong>
          </div>
          <div className="topbar-actions">
            <span className={"fn-environment" + (connectionError ? " console-connection-error" : "")} role="status">
              <i className="console-status-dot" />
              {connectionError ? "连接异常" : "已连接"}
            </span>
            <span className="console-env-label">{session.devMode ? "本地环境" : "生产环境"}</span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1 id="page-title" tabIndex={-1}>
                {details[page].title}
              </h1>
            </div>
            <div className="heading-actions">
              {lastUpdated && <span className="console-last-updated" title="页面打开时每 15 秒自动更新">更新于 {lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })}</span>}
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
                  className="button button-secondary"
                  variant="secondary"
                  onClick={() => void exportLogs()}
                  disabled={logsClearing}
                >
                  <Download size={15} />
                  导出日志
                </Button>
              )}
            </div>
          </div>
          <ConsoleErrorBoundary resetKey={page}>
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
          {metricsError && (page === "overview" || page === "analytics") && (
            <Alert status="warning" className="console-data-alert"><Alert.Indicator /><Alert.Content>
              <Alert.Title>统计数据暂时无法更新</Alert.Title>
              <Alert.Description>{metricsError}。已保留上次数据，其他管理功能仍可使用。</Alert.Description>
            </Alert.Content></Alert>
          )}
          {page === "overview" && (
            <Overview dashboard={dashboard} channels={channels} settings={settings} range={dashboard.analytics?.range ?? range}
              onNavigate={navigate} onEdit={setEditor} onCreate={() => setEditor("new")}
              onCopyAddress={() => void copy(window.location.origin + "/v1")} />
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
          {playgroundVisited && (
            <section hidden={page !== "playground"} aria-label="模型测试工作区">
            <Playground
              key={playVersion}
              channels={channels}
              keys={keys}
              initialChannelId={playChannel}
              onRefresh={() => refresh(true)}
              devMode={session.devMode}
            />
            </section>
          )}
          {page === "requests" && (
            <>
            {logsError && <Alert status="danger" className="console-data-alert"><Alert.Indicator /><Alert.Content>
              <Alert.Title>请求日志加载失败</Alert.Title><Alert.Description>{logsError}。请调整筛选条件或点击刷新重试。</Alert.Description>
            </Alert.Content></Alert>}
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
            </>
          )}
          {page === "analytics" && <UsageAnalytics dashboard={dashboard} />}
          {settingsVisited && (
            <section hidden={page !== "settings"} aria-label="网关配置工作区">
            <Tabs selectedKey={settingsTab} onSelectionChange={(id) => {
              const tab = id === "routing" ? "routing" : "connection";
              setSettingsTab(tab);
              const hash = consoleRouteHash("settings", tab);
              if (window.location.hash !== hash) window.history.pushState(null, "", hash);
            }} variant="secondary" className="fn-settings-tabs">
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
            </section>
          )}
          </ConsoleErrorBoundary>
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
        <Modal title="请求追踪" close={() => setLogDetail(null)} wide footer={<Button onClick={() => setLogDetail(null)}>关闭</Button>}>
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
        <Modal title="开始使用 PulseGate" close={() => setGuide(false)} footer={<Button variant="primary" onClick={() => setGuide(false)}>知道了</Button>}>
          <div className="fn-guide">
            <ol>
              <li>
                添加渠道，填写上游地址、模型和密钥。
              </li>
              <li>创建 API Key，设置允许访问的渠道与模型。</li>
              <li>在测试场验证请求，按需调整重试和健康策略。</li>
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
            <details className="fn-guide-details">
              <summary>接口与测试说明</summary>
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
            </details>
          </div>
        </Modal>
      )}
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
  const [saveError, setSaveError] = useState("");
  const settingsSignature = JSON.stringify([settings.account, settings.gateway, settings.aiGatewayEnabled, settings.logRetentionDays, settings.notifications]);
  const [savedSignature, setSavedSignature] = useState(settingsSignature);
  const draftSignature = JSON.stringify([account.trim(), gateway.trim(), enabled, retention, notifications]);
  const dirty = draftSignature !== savedSignature || Boolean(secret || clear);
  function reset() {
    setAccount(settings.account); setGateway(settings.gateway); setEnabled(settings.aiGatewayEnabled);
    setRetention(settings.logRetentionDays); setNotifications(settings.notifications);
    setSecret(""); setClear(false); setSaveError(""); setSavedSignature(settingsSignature);
  }
  useEffect(() => {
    if (!dirty) {
      setAccount(settings.account); setGateway(settings.gateway); setEnabled(settings.aiGatewayEnabled);
      setRetention(settings.logRetentionDays); setNotifications(settings.notifications); setSavedSignature(settingsSignature);
    }
  }, [settingsSignature, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    setSaveError("");
    if (enabled && (!account.trim() || !gateway.trim())) { setSaveError("启用 AI Gateway 前，请填写 Account ID 和 Gateway ID。"); return; }
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650) { setSaveError("日志保留天数须为 1–3650 的整数。"); return; }
    setBusy(true);
    try {
      await onSave({
        account: account.trim(),
        gateway: gateway.trim(),
        aiGatewayEnabled: enabled,
        notifications,
        logRetentionDays: retention,
        ...(secret ? { aiGatewayToken: secret } : {}),
        ...(clear ? { clearAiGatewayToken: true } : {}),
      });
      setSecret("");
      setClear(false);
      setSavedSignature(draftSignature);
      toast.success("网关设置已保存");
    } catch (e) {
      setSaveError(errorText(e));
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
          <fieldset className="console-form-fields" disabled={busy}>
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
          </fieldset>
          {saveError && <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Description>{saveError}</Alert.Description></Alert.Content></Alert>}
          <div className="console-save-bar">
            <span className={"console-save-status" + (dirty ? " is-dirty" : "")} role="status">{dirty ? "有未保存的更改" : "当前配置已保存"}</span>
            <div>
              <Button variant="secondary" disabled={busy || !dirty} onClick={reset}>放弃更改</Button>
          <Button
            type="submit"
            className="button button-primary"
            disabled={busy || !dirty}
          >
            {busy ? "保存中…" : "保存设置"}
          </Button>
            </div>
          </div>
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
