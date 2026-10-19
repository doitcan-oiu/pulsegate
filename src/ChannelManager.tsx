import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Archive,
  ArrowUpDown,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileUp,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Tags,
  X,
} from "lucide-react";
import { Button, Input, TextArea, Select, Checkbox, Switch, toast } from "./ui";
import { Dropdown, Label, Pagination, Popover, Table } from "@heroui/react";
import type { GatewayChannel, GatewaySettings } from "../shared/types";
import { api } from "./api";
import ChannelActions, { ChannelDialog } from "./ChannelActions";
import RetrySettings from "./RetrySettings";
import ProviderIcon from "./ProviderIcon";
import ChannelTagTree from "./ChannelTagTree";
import { channelHealthView, matchesChannelHealthStatus } from "./channel-health";
import "./channel-manager.css";

type Props = {
  channels: GatewayChannel[];
  setChannels: Dispatch<SetStateAction<GatewayChannel[]>>;
  onEdit: (channel: GatewayChannel) => void;
  activeChannelId?: string;
  onNavigateKeys: () => void;
  initialSearch?: string;
  onNavigatePlayground?: (channelId?: string) => void;
  onRefresh?: () => void | Promise<void>;
};
type Column =
  | "provider"
  | "enabled"
  | "priority"
  | "tags"
  | "models"
  | "health"
  | "weight"
  | "createdAt";
const columns: { key: Column; label: string }[] = [
  { key: "priority", label: "优先级" },
  { key: "enabled", label: "启用" },
  { key: "health", label: "健康 / 首字" },
  { key: "models", label: "支持的模型" },
  { key: "tags", label: "标签" },
  { key: "provider", label: "服务商" },
  { key: "weight", label: "权重" },
  { key: "createdAt", label: "创建时间" },
];
const defaultColumns: Column[] = ["enabled", "priority", "models", "health", "tags"];
const columnWidths: Record<Column, number> = { provider: 120, enabled: 64, priority: 84, tags: 112, models: 180, health: 240, weight: 64, createdAt: 100 };
const viewStorageKey = "pulsegate.channel-view.v3";
type Modal =
  "settings" | "import" | "weights" | "tags" | "assign" | "strategy" | null;
function channelStatusLabel(channel: GatewayChannel) {
  return channelHealthView(channel).label;
}
function HealthHistory({ channel }: { channel: GatewayChannel }) {
  const recent = channel.history.slice(-14).filter(value => value === 0 || value === 1 || value === 2);
  const count = (value: number) => recent.filter(item => item === value).length;
  const description = recent.length
    ? `最近 ${recent.length} 次尝试：成功 ${count(0)} 次、慢响应 ${count(1)} 次、失败 ${count(2)} 次；从左到右由旧到新，灰格表示暂无样本。`
    : "暂无健康历史；完成请求或探测后显示真实结果，灰格表示暂无样本。";
  return <div className="gx-health-history">
    <div className="gx-health-bars" role="img" aria-label={description} title={description}>
      {Array.from({ length: 14 }, (_, index) => {
        const sampleIndex = index - (14 - recent.length);
        const value = recent[sampleIndex];
        const label = value === 0 ? "成功" : value === 1 ? "慢响应" : value === 2 ? "失败" : "暂无样本";
        return <i key={index} aria-hidden="true" className={value === 0 ? "gx-good" : value === 1 ? "gx-slow" : value === 2 ? "gx-bad" : "gx-unknown"} title={sampleIndex < 0 ? label : `第 ${sampleIndex + 1} 次：${label}（由旧到新）`} />;
      })}
    </div>
    {!recent.length && <span className="gx-health-empty">暂无历史</span>}
  </div>;
}
function ChannelHealthSummary({ channel, busy, resetHealth, compact = false }: {
  channel: GatewayChannel;
  busy: boolean;
  resetHealth: () => void;
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState(Date.now);
  const cooldownUntil = channel.health.cooldownUntil;
  useEffect(() => {
    setNowMs(Date.now());
    const deadline = Date.parse(cooldownUntil ?? "");
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  const health = channelHealthView(channel, nowMs);
  const reason = channel.health.reason || (channel.status !== "healthy" || channel.health.autoDisabled ? health.reason : null);
  return <div className={compact ? "gx-channel-health gx-channel-health-compact" : "gx-channel-health"}>
    <div className="gx-health-summary">
      <span className={`gx-health-status gx-health-${health.color}`}><i aria-hidden="true" />{health.label}</span>
      {!compact && <span className="gx-health-latency" title="平均首字耗时（TTFT）">首字 {channel.health.averageTtft != null ? `${channel.health.averageTtft.toFixed(2)} s` : "—"}</span>}
    </div>
    {!compact && <HealthHistory channel={channel} />}
    {reason && <span className="gx-health-reason">{reason}</span>}
    {(health.cooldownLabel || health.canReset) && <div className="gx-health-recovery">
      {health.cooldownLabel && <span className="gx-health-cooldown" title={health.cooldownTitle}>{health.cooldownLabel}</span>}
      {health.canReset && <Button variant="ghost" size="sm" className="gx-health-reset" disabled={busy} aria-label={`${health.resetLabel} ${channel.name}`} title="清除冷却和健康异常，立即恢复渠道参与路由" onClick={resetHealth}>{busy ? "处理中…" : health.resetLabel}</Button>}
    </div>}
  </div>;
}
function ChannelBalance({ channel, refresh }: { channel: GatewayChannel; refresh: () => void | Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const balance = channel.accountBalance;
  const amount = balance?.amount;
  const unit = balance?.unit ?? '';
  const label = amount != null ? `${unit === 'USD' ? '$' : ''}${amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}${unit && unit !== 'USD' ? ` ${unit}` : ''}` : balance?.status === 'error' ? '刷新失败' : channel.hasAccountCredentials ? '待更新' : '未配置账户';
  const detail = [`余额 ${label}`, balance?.updatedAt ? `余额更新于 ${new Date(balance.updatedAt).toLocaleString('zh-CN')}` : '每 5 分钟自动刷新', balance?.error ?? '', '点击立即刷新'].filter(Boolean).join(' · ');
  return <div className={`gx-balance ${balance?.status === 'error' ? 'gx-balance-error' : ''} ${amount == null ? 'gx-balance-pending' : ''}`} aria-busy={loading} title={detail}>
    <span className="gx-balance-caption">余额</span>
    <strong className="gx-balance-amount">{label}</strong>
    {balance?.status === 'error' && amount != null && <span className="gx-balance-status">更新失败</span>}
    <Button type="button" variant="ghost" size="sm" isIconOnly className="gx-balance-refresh" disabled={loading || !channel.hasAccountCredentials} aria-label={`刷新 ${channel.name} 余额`} aria-busy={loading} title={loading ? '正在刷新余额' : detail} onClick={async () => {
    setLoading(true);
    try {
      const result = await api<{ channel: GatewayChannel }>(`/api/channels/${channel.id}/balance`, { method: 'POST' });
      if (result.channel.accountBalance?.status === 'error') toast.error(result.channel.accountBalance.error ?? '余额刷新失败');
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : '余额刷新失败'); }
    finally { setLoading(false); }
    }}>
    <RefreshCw size={13} aria-hidden="true" className={loading ? 'gx-spin' : ''} />
    </Button>
  </div>;
}
function Filter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Popover>
      <Button variant="secondary" size="sm" className={selected.length ? "gx-filter-trigger is-active" : "gx-filter-trigger"}>
        {label}
        {selected.length > 0 && <span className="gx-filter-count">{selected.length}</span>}
        <ChevronDown size={13} />
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog className="gx-filter-panel" aria-label={`${label}筛选`}>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            清除选择
          </Button>
          {values.length ? (
            values.map((value) => (
              <Checkbox
                key={value}
                checked={selected.includes(value)}
                onChange={() =>
                  onChange(
                    selected.includes(value)
                      ? selected.filter((v) => v !== value)
                      : [...selected, value],
                  )
                }
              >
                {value}
              </Checkbox>
            ))
          ) : (
            <small>暂无选项</small>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
function ModelList({ models }: { models: string[] }) {
  const [all, setAll] = useState(false);
  return (
    <div className="gx-models">
      {(all ? models : models.slice(0, 2)).map((model) => (
        <code key={model} title={model}>{model}</code>
      ))}
      {models.length > 2 && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? "收起" : `+${models.length - 2}`}
        </Button>
      )}
    </div>
  );
}
function savedView() {
  try {
    const saved = localStorage.getItem(viewStorageKey);
    const legacy = saved === null ? localStorage.getItem("pulsegate.channel-view.v2") : null;
    const parsed = JSON.parse(saved ?? legacy ?? "{}");
    const savedColumns: Column[] = Array.isArray(parsed.columns)
      ? [...new Set<Column>(parsed.columns.filter((value: unknown): value is Column => columns.some(column => column.key === value)))]
      : [...defaultColumns];
    if (legacy !== null) {
      for (const column of ["priority", "health"] as const) if (!savedColumns.includes(column)) savedColumns.push(column);
    }
    return {
      size: [10, 20, 50, 100].includes(parsed.size)
        ? (parsed.size as number)
        : 20,
      columns: savedColumns,
    };
  } catch {
    return { size: 20, columns: [...defaultColumns] };
  }
}

export default function ChannelManager({
  channels,
  setChannels,
  onEdit,
  activeChannelId,
  onNavigateKeys,
  initialSearch = "",
  onNavigatePlayground,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState(initialSearch);
  const [providers, setProviders] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [filterNowMs, setFilterNowMs] = useState(Date.now);
  const filterByCooldown = statuses.includes("冷却中") || statuses.includes("等待恢复");
  useEffect(() => {
    if (!filterByCooldown) return;
    setFilterNowMs(Date.now());
    const timer = window.setInterval(() => setFilterNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [filterByCooldown]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [filterModels, setFilterModels] = useState<string[]>([]);
  const [archiveMode, setArchiveMode] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Column[]>(
    () => savedView().columns,
  );
  const [pageSize, setPageSize] = useState(() => savedView().size);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{
    key: "name" | "provider" | "priority" | "weight" | "createdAt";
    asc: boolean;
  }>({ key: "createdAt", asc: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const tagListRevision = useRef(0);
  const importReadRevision = useRef(0);
  const [readingImport, setReadingImport] = useState(false);
  const [strategyDirty, setStrategyDirty] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const strategyPending = useRef(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [discardModal, setDiscardModal] = useState(false);
  const [tagList, setTagList] = useState<string[]>([]);
  const [tagName, setTagName] = useState("");
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [assignMode, setAssignMode] = useState<"add" | "replace" | "remove">(
    "add",
  );
  const [assignTags, setAssignTags] = useState<string[]>([]);
  const [weight, setWeight] = useState(1);
  const [importText, setImportText] = useState("");
  const [strategySettings, setStrategySettings] =
    useState<GatewaySettings | null>(null);
  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    setPage(1);
  }, [
    search,
    providers,
    statuses,
    filterTags,
    untaggedOnly,
    filterModels,
    archiveMode,
    pageSize,
  ]);
  useEffect(() => {
    try {
      localStorage.setItem(
        viewStorageKey,
        JSON.stringify({ size: pageSize, columns: visibleColumns }),
      );
    } catch {
      /* View preferences are optional. */
    }
  }, [pageSize, visibleColumns]);
  useEffect(() => {
    const revision = tagListRevision.current;
    void api<{ tags: string[] }>("/api/tags")
      .then((data) => { if (revision === tagListRevision.current) setTagList(data.tags); })
      .catch(() => undefined);
    return () => { ++importReadRevision.current; };
  }, []);
  useEffect(() => {
    setSelected((old) =>
      old.filter((id) => channels.some((channel) => channel.id === id && channel.archived === archiveMode)),
    );
  }, [channels, archiveMode]);
  const tags = [
    ...new Set([...tagList, ...channels.flatMap((channel) => channel.tags)]),
  ].sort();
  const tagCounts = useMemo(() => {
    const scopedChannels = channels.filter(
      (channel) => channel.archived === archiveMode,
    );
    const counts = new Map<string, number>();
    for (const channel of scopedChannels) {
      const paths = new Set<string>();
      for (const tag of channel.tags) {
        const parts = tag.split("/");
        for (let depth = 1; depth <= parts.length; depth++) paths.add(parts.slice(0, depth).join("/"));
      }
      for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return {
      counts,
      all: scopedChannels.length,
      untagged: scopedChannels.filter((channel) => !channel.tags.length).length,
    };
  }, [channels, archiveMode]);
  const visibleTags = tags.filter((tag) =>
    tag.toLowerCase().includes(tagSearch.trim().toLowerCase()),
  );
  const models = [
    ...new Set(channels.flatMap((channel) => channel.models)),
  ].sort();
  const availableProviders = [
    ...new Set(channels.map((channel) => channel.provider)),
  ].sort();
  const filtered = useMemo(
    () =>
      channels
        .filter((channel) => {
          const query = search.trim().toLowerCase();
          return (
            channel.archived === archiveMode &&
            (!query ||
              [
                channel.name,
                channel.endpoint,
                channel.provider,
                ...channel.models,
                ...channel.tags,
              ].some((value) => value.toLowerCase().includes(query))) &&
            (!providers.length || providers.includes(channel.provider)) &&
            matchesChannelHealthStatus(channel, statuses, filterNowMs) &&
            (!filterTags.length ||
              filterTags.some((tag) => channel.tags.some(value => value === tag || value.startsWith(`${tag}/`)))) &&
            (!untaggedOnly || !channel.tags.length) &&
            (!filterModels.length ||
              filterModels.some((model) => channel.models.includes(model)))
          );
        })
        .sort((a, b) => {
          const difference =
            sort.key === "weight" || sort.key === "priority"
              ? a[sort.key] - b[sort.key]
              : String(a[sort.key]).localeCompare(String(b[sort.key]), "zh-CN");
          return (
            (sort.asc ? difference : -difference) ||
            a.name.localeCompare(b.name)
          );
        }),
    [
      channels,
      search,
      providers,
      statuses,
      filterNowMs,
      filterTags,
      untaggedOnly,
      filterModels,
      sort,
      archiveMode,
    ],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageWindowStart = Math.max(1, Math.min(currentPage - 1, pages - 2));
  const pageNumbers = Array.from(
    { length: Math.min(3, pages) },
    (_, index) => pageWindowStart + index,
  );
  const shown = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const pageSelected =
    shown.length > 0 && shown.every((channel) => selected.includes(channel.id));
  const activeFilters =
    !!search ||
    !!providers.length ||
    !!statuses.length ||
    !!filterTags.length ||
    untaggedOnly ||
    !!filterModels.length;
  const show = (column: Column) => visibleColumns.includes(column);
  const workingChannels = channels.filter((channel) => !channel.archived);
  const modalDirty = modal === "strategy" ? strategyDirty : modal === "import" ? Boolean(importText.trim()) || readingImport : modal === "tags" ? Boolean(tagName.trim() && tagName.trim() !== renameFrom) : modal === "assign" ? assignTags.length > 0 || assignMode !== "add" : modal === "weights" ? weight !== 1 : false;
  useEffect(() => {
    if (!modalDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [modalDirty]);
  function clearFilters() {
    setSearch(""); setProviders([]); setStatuses([]); setFilterTags([]); setUntaggedOnly(false); setFilterModels([]);
  }
  function closeModal(force = false) {
    if (busy || strategySaving || strategyPending.current || mutationPending.current) return;
    if (modalDirty && !force) { setDiscardModal(true); return; }
    ++importReadRevision.current;
    setReadingImport(false); setStrategyDirty(false);
    setDiscardModal(false); setModal(null); setImportText(""); setTagName(""); setRenameFrom(null); setAssignTags([]); setAssignMode("add"); setWeight(1);
  }
  const toggleSelect = (id: string) => {
    if (!selected.includes(id) && selected.length >= 200) { toast.error("每次最多批量操作 200 个渠道，请先减少选择"); return; }
    setSelected((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  };
  function togglePageSelection() {
    if (pageSelected) { setSelected((old) => old.filter((id) => !shown.some((channel) => channel.id === id))); return; }
    const next = [...new Set([...selected, ...shown.map((channel) => channel.id)])];
    if (next.length > 200) { toast.error("每次最多批量操作 200 个渠道，请先减少选择"); return; }
    setSelected(next);
  }
  async function refresh() {
    const data = await api<GatewayChannel[] | { channels: GatewayChannel[] }>(
      "/api/channels",
    );
    setChannels(Array.isArray(data) ? data : data.channels);
    await onRefresh?.();
  }
  async function perform(task: () => Promise<unknown>, success: string, committed?: () => void) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    setBusy(true);
    try {
      await task();
      committed?.();
      toast.success(success);
      try { await refresh(); }
      catch { toast.error("变更已保存，但列表刷新失败。请刷新页面查看最新状态。"); }
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
      return false;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    if (archiveMode && (action === "enable" || action === "disable")) { toast.error("请先恢复归档渠道，再调整启用状态"); return false; }
    if (!selected.length) {
      toast.error("请先选择渠道");
      return false;
    }
    const success = await perform(
      () =>
        api("/api/channels/bulk", {
          method: "POST",
          body: JSON.stringify({ ids: selected, action, ...extra }),
        }),
      `已更新 ${selected.length} 个渠道`,
    );
    if (success) {
      setSelected([]);
      setModal(null);
      setAssignTags([]); setAssignMode("add"); setWeight(1);
    }
    return success;
  }
  function importChannels() {
    if (readingImport) return;
    let imported: unknown;
    try {
      const parsed = JSON.parse(importText);
      imported = Array.isArray(parsed) ? parsed : parsed?.channels;
      if (!Array.isArray(imported) || !imported.length) throw new Error("需要至少一个渠道");
      if (imported.length > 200) throw new Error("每次最多导入 200 个渠道，请分批操作");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "JSON 格式有误");
      return;
    }
    const payload = JSON.stringify({ channels: imported });
    if (new TextEncoder().encode(payload).byteLength > 1048576) { toast.error("导入请求不能超过 1 MB，请将渠道分批导入"); return; }
    void perform(
      () => api("/api/channels/import", { method: "POST", body: payload }),
      "渠道已导入",
      () => { setImportText(""); setModal(null); },
    );
  }
  async function editTag() {
    const name = tagName.trim();
    if (!name || name.length > 256) {
      toast.error("标签名称须为 1–256 个字符");
      return;
    }
    await perform(
        async () => {
          const data = await api<{ tags: string[] }>(
            renameFrom
              ? `/api/tags/${encodeURIComponent(renameFrom)}`
              : "/api/tags",
            {
              method: renameFrom ? "PATCH" : "POST",
              body: JSON.stringify({ name }),
            },
          );
          ++tagListRevision.current;
          setTagList(data.tags);
          if (renameFrom) {
            setChannels((old) => old.map((channel) => ({ ...channel, tags: [...new Set(channel.tags.map((tag) => tag === renameFrom ? name : tag))] })));
            setFilterTags((old) => [...new Set(old.map((tag) => tag === renameFrom ? name : tag))].filter((prefix) => data.tags.some((tag) => tag === prefix || tag.startsWith(`${prefix}/`))));
          }
        },
        renameFrom ? "标签已更新，API Key 引用已同步" : "标签已创建",
        () => {
          setRenameFrom(null); setTagName("");
        },
    );
  }
  async function openStrategy() {
    setStrategySettings(null);
    setStrategyDirty(false);
    setModal("strategy");
    setBusy(true);
    try {
      const data = await api<GatewaySettings | { settings: GatewaySettings }>(
        "/api/settings",
      );
      setStrategySettings("settings" in data ? data.settings : data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "策略加载失败");
    } finally {
      setBusy(false);
    }
  }
  const displayedColumns = [
    { id: "expand", label: "展开" },
    { id: "select", label: "选择" },
    { id: "name", label: "名称" },
    ...columns
      .filter((column) => show(column.key))
      .map((column) => ({ id: column.key, label: column.label })),
    { id: "actions", label: "操作" },
  ];
  return (
    <div className="gx-root">
      <div className="gx-workspace">
      <ChannelTagTree
        tags={tags}
        counts={tagCounts.counts}
        total={tagCounts.all}
        untaggedCount={tagCounts.untagged}
        selected={filterTags}
        untaggedOnly={untaggedOnly}
        onSelect={(tag) => { setFilterTags(tag ? [tag] : []); setUntaggedOnly(false); }}
        onUntagged={() => { setFilterTags([]); setUntaggedOnly(true); }}
        onManage={() => { setTagName(""); setRenameFrom(null); setModal("tags"); }}
      />
      <section className="gx-sheet" aria-label="渠道工作表">
        <div className="gx-sheet-toolbar">
          <label className="gx-search">
            <Search size={16} aria-hidden="true" />
            <Input aria-label="搜索渠道" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索渠道、模型或端点" />
            {search && <Button variant="ghost" size="sm" isIconOnly onClick={() => setSearch("")} aria-label="清除搜索"><X size={14} /></Button>}
          </label>
          <div className="gx-filter-controls" aria-label="筛选渠道">
            <Filter label="服务商" values={availableProviders} selected={providers} onChange={setProviders} />
            <Filter label="状态" values={["健康", "待检测", "待配置密钥", "延迟异常", "不可用", "自动停用", "冷却中", "等待恢复", "已停用", "已归档"]} selected={statuses} onChange={setStatuses} />
            <Filter label="模型" values={models} selected={filterModels} onChange={setFilterModels} />
            <Popover isOpen={tagFilterOpen} onOpenChange={setTagFilterOpen}>
              <Button variant="secondary" size="sm" className={filterTags.length || untaggedOnly ? "gx-filter-trigger is-active" : "gx-filter-trigger"}>
                标签{filterTags.length > 0 && <span className="gx-filter-count">{filterTags.length}</span>}{untaggedOnly && <span className="gx-filter-count">未标记</span>}<ChevronDown size={13} />
              </Button>
              <Popover.Content placement="bottom end">
                <Popover.Dialog className="gx-tag-popover" aria-label="渠道标签筛选">
                  <div className="gx-tag-popover-heading"><strong>标签筛选</strong><Button variant="ghost" size="sm" disabled={!filterTags.length && !untaggedOnly} onClick={() => { setFilterTags([]); setUntaggedOnly(false); }}>清除</Button></div>
                  <Input aria-label="搜索标签" placeholder="搜索标签" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} />
                  <div className="gx-tag-shortcuts">
                    <Button variant="ghost" size="sm" aria-pressed={!filterTags.length && !untaggedOnly} onClick={() => { setFilterTags([]); setUntaggedOnly(false); }}><span>全部标签</span><small>{tagCounts.all}</small></Button>
                    <Button variant="ghost" size="sm" aria-pressed={untaggedOnly} onClick={() => { setFilterTags([]); setUntaggedOnly(true); }}><span>未打标签</span><small>{tagCounts.untagged}</small></Button>
                  </div>
                  <div className="gx-tag-options" role="group" aria-label="选择标签，匹配任一项">
                    {visibleTags.map((tag) => <Checkbox className="gx-tag-choice" key={tag} checked={filterTags.includes(tag)} onChange={() => { setUntaggedOnly(false); setFilterTags((old) => old.includes(tag) ? old.filter((value) => value !== tag) : [...old, tag]); }}><span className="gx-tag-choice-copy"><span>{tag}</span><small>{tagCounts.counts.get(tag) ?? 0}</small></span></Checkbox>)}
                    {!visibleTags.length && <p className="gx-tag-empty">{tagSearch.trim() ? "没有匹配的标签" : "暂无标签"}</p>}
                  </div>
                  <Button variant="ghost" size="sm" className="gx-tag-manage" onClick={() => { setTagFilterOpen(false); setTagName(""); setRenameFrom(null); setModal("tags"); }}><Settings2 size={14} />管理标签</Button>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </div>
          <div className="gx-sheet-tools">
            <Popover>
              <Button variant="ghost" size="sm" isIconOnly aria-label="显示列设置" title="显示列"><Columns3 size={16} /></Button>
              <Popover.Content placement="bottom end">
                <Popover.Dialog className="gx-filter-panel" aria-label="显示列设置">
                  <strong className="gx-popover-title">显示列</strong>
                  {columns.map((column) => <Checkbox key={column.key} checked={show(column.key)} onChange={() => setVisibleColumns((old) => old.includes(column.key) ? old.filter((value) => value !== column.key) : [...old, column.key])}>{column.label}</Checkbox>)}
                  <Button variant="ghost" size="sm" onClick={() => setVisibleColumns([...defaultColumns])}>恢复默认列</Button>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Dropdown>
              <Button variant="ghost" size="sm" disabled={busy} aria-label="渠道管理工具">管理<ChevronDown size={13} /></Button>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="渠道管理工具" onAction={(id) => {
                  if (id === "settings") setModal("settings");
                  if (id === "import") { setImportText(""); setModal("import"); }
                  if (id === "weights") { if (!selected.length) { toast.error("请先选择需要调整的渠道"); return; } setModal("weights"); }
                  if (id === "strategy") void openStrategy();
                  if (id === "tags") { setTagName(""); setRenameFrom(null); setModal("tags"); }
                  if (id === "keys") onNavigateKeys();
                }}>
                  <Dropdown.Item id="import" textValue="批量导入"><FileUp size={15} /><Label>批量导入</Label></Dropdown.Item>
                  <Dropdown.Item id="weights" textValue="批量调整权重"><ArrowUpDown size={15} /><Label>批量调整权重</Label></Dropdown.Item>
                  <Dropdown.Item id="tags" textValue="标签管理"><Tags size={15} /><Label>标签管理</Label></Dropdown.Item>
                  <Dropdown.Item id="strategy" textValue="负载均衡策略"><SlidersHorizontal size={15} /><Label>负载均衡策略</Label></Dropdown.Item>
                  <Dropdown.Item id="keys" textValue="API Key 权限"><KeyRound size={15} /><Label>API Key 权限</Label></Dropdown.Item>
                  <Dropdown.Item id="settings" textValue="列表设置"><Settings2 size={15} /><Label>列表设置</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
        <div className="gx-sheet-nav">
          <div className="gx-view-tabs" role="group" aria-label="渠道视图">
            <Button variant="ghost" className="gx-view-tab" aria-pressed={!archiveMode} onClick={() => { setArchiveMode(false); if (archiveMode) setSelected([]); }}>使用中<span>{workingChannels.length}</span></Button>
            <Button variant="ghost" className="gx-view-tab" aria-pressed={archiveMode} onClick={() => { setArchiveMode(true); if (!archiveMode) setSelected([]); }}>已归档<span>{channels.length - workingChannels.length}</span></Button>
          </div>
          <div className="gx-view-meta"><span aria-live="polite">{filtered.length} 个结果</span>{activeFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>清除筛选<X size={12} /></Button>}</div>
        </div>
          {selected.length > 0 && (
            <div className="gx-bulk" role="region" aria-label="所选渠道批量操作" aria-busy={busy}>
              <strong>已选择 {selected.length} 个渠道</strong>
              <Button disabled={busy || archiveMode} onClick={() => void bulk("enable")}>
                启用
              </Button>
              <Button disabled={busy || archiveMode} onClick={() => void bulk("disable")}>
                停用
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setAssignTags([]);
                  setModal("assign");
                }}
              >
                调整标签
              </Button>
              <Button disabled={busy} onClick={() => setModal("weights")}>
                调整权重
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    title: `${archiveMode ? "恢复" : "归档"}所选渠道`,
                    description: `确定${archiveMode ? "恢复" : "归档"}所选 ${selected.length} 个渠道？归档后不会继续参与路由。`,
                    action: async () => {
                      const success = await bulk(
                        archiveMode ? "restore" : "archive",
                      );
                      if (!success) throw new Error("操作失败");
                    },
                  })
                }
              >
                <Archive size={13} />
                {archiveMode ? "恢复" : "归档"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setSelected([])}>取消选择</Button>
            </div>
          )}
          <p className="gx-scroll-hint">左右滑动查看全部列</p>
          <Table variant="secondary" className="gx-channel-table">
            <Table.ScrollContainer>
              <Table.Content
                className="gx-table"
                style={{ minWidth: 340 + visibleColumns.reduce((width, column) => width + columnWidths[column], 0) }}
                aria-label="上游渠道列表"
                sortDescriptor={{
                  column: sort.key,
                  direction: sort.asc ? "ascending" : "descending",
                }}
                onSortChange={(descriptor) =>
                  setSort({
                    key: descriptor.column as typeof sort.key,
                    asc: descriptor.direction === "ascending",
                  })
                }
              >
                <Table.Header>
                  {displayedColumns.map((column) => (
                    <Table.Column
                      key={column.id}
                      id={column.id}
                      isRowHeader={column.id === "name"}
                      allowsSorting={[
                        "name",
                        "provider",
                        "priority",
                        "weight",
                        "createdAt",
                      ].includes(column.id)}
                      className={
                        column.id === "actions"
                          ? "gx-actions-cell"
                          : column.id === "expand"
                            ? "gx-expand-cell"
                            : column.id === "select"
                              ? "gx-check-cell"
                              : column.id === "priority" || column.id === "weight"
                                ? "gx-number"
                                : undefined
                      }
                    >
                      {column.id === "select" ? (
                        <Checkbox
                          aria-label="选择本页全部渠道"
                          checked={pageSelected}
                          onChange={togglePageSelection}
                        />
                      ) : column.id === "expand" ? (
                        <span className="gx-sr-only">展开</span>
                      ) : ["name", "provider", "priority", "weight", "createdAt"].includes(
                          column.id,
                        ) ? (
                        <Table.SortableColumnHeader
                          sortDirection={
                            sort.key === column.id
                              ? sort.asc
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          {column.label}
                        </Table.SortableColumnHeader>
                      ) : (
                        column.label
                      )}
                    </Table.Column>
                  ))}
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="gx-empty">
                      {archiveMode && !activeFilters ? <Archive size={28} /> : <Search size={28} />}
                      <strong>
                        {activeFilters
                          ? "没有符合条件的渠道"
                          : archiveMode
                            ? "暂无归档渠道"
                            : "还没有渠道"}
                      </strong>
                      <span>
                        {activeFilters
                          ? "调整筛选条件或清除筛选。"
                          : archiveMode ? "归档渠道保留配置，但不会参与请求路由。" : "点击页面右上角添加渠道，连接你的第一个模型服务商。"}
                      </span>
                      {activeFilters && <Button variant="secondary" size="sm" onClick={clearFilters}>清除筛选</Button>}
                    </div>
                  )}
                >
                  {shown.flatMap((channel) =>
                    ChannelRows({
                      channel,
                      expanded: expanded.includes(channel.id),
                      toggleExpand: () =>
                        setExpanded((old) =>
                          old.includes(channel.id)
                            ? old.filter((id) => id !== channel.id)
                            : [...old, channel.id],
                        ),
                      selected: selected.includes(channel.id),
                      toggleSelect: () => toggleSelect(channel.id),
                      active: activeChannelId === channel.id,
                      show,
                      colSpan: 4 + visibleColumns.length,
                      busy,
                      resetHealth: () => {
                        void perform(async () => {
                          const result = await api<{ channel: GatewayChannel }>(`/api/channels/${encodeURIComponent(channel.id)}/reset-health`, { method: "POST" });
                          setChannels((old) => old.map((item) => item.id === channel.id ? result.channel : item));
                        }, "冷却和健康异常已清除，渠道已恢复参与路由，等待重新检测");
                      },
                      toggleEnabled: () => {
                        void perform(
                          () =>
                            api(
                              `/api/channels/${encodeURIComponent(channel.id)}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  enabled: !channel.enabled,
                                }),
                              },
                            ),
                          channel.enabled ? "渠道已停用" : "渠道已启用",
                        );
                      },
                      onEdit,
                      refresh,
                      onPlayground: onNavigatePlayground,
                    }),
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          <footer className="gx-pagination">
            <span className="gx-pagination-total">
              共 <strong>{filtered.length}</strong> 个渠道
              {activeFilters && `（全部 ${channels.length} 个）`}
              {selected.length > 0 && ` · 已选 ${selected.length} 个`}
            </span>
            <div className="gx-page-controls">
              <div className="gx-page-size">
                <span>每页</span>
                <Select
                  aria-label="每页行数"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </Select>
                <span>条</span>
              </div>
              <Pagination size="sm" className="gx-page-nav" aria-label="渠道分页">
                <Pagination.Summary>
                  第 {currentPage} / {pages} 页
                </Pagination.Summary>
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Link
                      isDisabled={currentPage === 1}
                      onPress={() => setPage(1)}
                      aria-label="首页"
                    >
                      <ChevronFirst size={16} />
                    </Pagination.Link>
                  </Pagination.Item>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={currentPage === 1}
                      onPress={() => setPage(currentPage - 1)}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={16} />
                    </Pagination.Previous>
                  </Pagination.Item>
                  {pageNumbers.map((pageNumber) => (
                    <Pagination.Item key={pageNumber}>
                      <Pagination.Link
                        isActive={pageNumber === currentPage}
                        aria-label={`第 ${pageNumber} 页`}
                        onPress={() => setPage(pageNumber)}
                      >
                        {pageNumber}
                      </Pagination.Link>
                    </Pagination.Item>
                  ))}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={currentPage === pages}
                      onPress={() => setPage(currentPage + 1)}
                      aria-label="下一页"
                    >
                      <ChevronRight size={16} />
                    </Pagination.Next>
                  </Pagination.Item>
                  <Pagination.Item>
                    <Pagination.Link
                      isDisabled={currentPage === pages}
                      onPress={() => setPage(pages)}
                      aria-label="末页"
                    >
                      <ChevronLast size={16} />
                    </Pagination.Link>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </div>
          </footer>
      </section>
      </div>
      {confirmation && (
        <ChannelDialog
          title={confirmation.title}
          onClose={() => !busy && setConfirmation(null)}
        >
          <p className="cx-hint">{confirmation.description}</p>
          <footer className="cx-footer">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </Button>
            <Button
              variant={confirmation.title === "删除标签" ? "danger" : "primary"}
              disabled={busy}
              onClick={() => {
                void confirmation
                  .action()
                  .then(() => setConfirmation(null))
                  .catch(() => undefined);
              }}
            >
              确认
            </Button>
          </footer>
        </ChannelDialog>
      )}
      {modal && (
        <ChannelDialog
          title={
            modal === "settings"
              ? "渠道列表设置"
              : modal === "import"
                ? "批量导入渠道"
                : modal === "weights"
                  ? "批量调整权重"
                  : modal === "assign"
                    ? "批量调整标签"
                    : modal === "strategy"
                      ? "负载均衡与重试策略"
                      : "标签管理"
          }
          onClose={() => closeModal()}
          className="gx-management-dialog"
          wide={modal === "strategy"}
          footer={modal !== "strategy" ? <div className="gx-dialog-actions">
            <Button variant="secondary" disabled={busy} onClick={() => closeModal()}>{modal === "settings" || modal === "tags" ? "完成" : "取消"}</Button>
            {modal === "import" && <Button variant="primary" disabled={busy || readingImport || !importText.trim()} onClick={importChannels}>{busy ? "导入中…" : readingImport ? "正在读取…" : "导入渠道"}</Button>}
            {modal === "weights" && <Button variant="primary" disabled={busy || !Number.isFinite(weight) || weight < 0 || weight > 10000} onClick={() => void bulk("weights", { weight })}>{busy ? "保存中…" : "保存权重"}</Button>}
            {modal === "assign" && <Button variant="primary" disabled={busy || (!assignTags.length && assignMode !== "replace")} onClick={() => void bulk("tags", { tags: assignTags, mode: assignMode })}>{busy ? "应用中…" : `应用到 ${selected.length} 个渠道`}</Button>}
          </div> : undefined}
        >
          {modal === "settings" && (
            <>
              <p className="cx-hint">
                显示偏好仅保存在当前浏览器，不影响网关调度。
              </p>
              <label className="cx-field">
                <span>默认每页行数</span>
                <Select
                  aria-label="默认每页行数"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </Select>
              </label>
              <div className="cx-options">
                {columns.map((column) => (
                  <Checkbox
                    key={column.key}
                    checked={show(column.key)}
                    onChange={() =>
                      setVisibleColumns((old) =>
                        old.includes(column.key)
                          ? old.filter((value) => value !== column.key)
                          : [...old, column.key],
                      )
                    }
                  >
                    {column.label}
                  </Checkbox>
                ))}
              </div>
            </>
          )}
          {modal === "import" && (
            <>
              <p className="cx-hint">
                导入 JSON 数组，或包含 channels 数组的对象。支持
                config、tags、models 与
                apiKeys。上游原始密钥只提交到后端，导入后清空输入。
              </p>
              <label className="cx-field">
                <span>读取 JSON 文件</span>
                <Input
                  type="file"
                  disabled={busy}
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1048576) {
                      toast.error("文件不能超过 1 MB");
                      return;
                    }
                    const revision = ++importReadRevision.current;
                    setReadingImport(true);
                    void file.text().then((value) => { if (revision === importReadRevision.current) setImportText(value); })
                      .catch(() => { if (revision === importReadRevision.current) toast.error("文件读取失败，请重新选择 JSON 文件"); })
                      .finally(() => { if (revision === importReadRevision.current) setReadingImport(false); });
                  }}
                />
              </label>
              <label className="cx-field">
                <span>渠道 JSON</span>
                <TextArea
                  rows={14}
                  disabled={busy}
                  className="cx-code"
                  value={importText}
                  spellCheck={false}
                  onChange={(e) => { ++importReadRevision.current; setReadingImport(false); setImportText(e.target.value); }}
                  placeholder={
                    '[{"name":"OpenAI 主渠道","provider":"OpenAI","endpoint":"https://api.openai.com/v1","models":["gpt-4.1"],"tags":["production"],"weight":1,"apiKeys":[{"label":"主密钥","secret":"sk-…"}]}]'
                  }
                />
              </label>
            </>
          )}
          {modal === "weights" && (
            <>
              <p className="cx-hint">
                将所选 {selected.length}{" "}
                个渠道设为同一权重。加权策略使用此值分配流量，0
                作为最低权重处理。
              </p>
              <label className="cx-field">
                <span>权重</span>
                <Input
                  type="number"
                  min="0"
                  max="10000"
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                />
              </label>
            </>
          )}
          {modal === "assign" && (
            <>
              <p className="cx-hint">
                标签用于 API Key
                的渠道权限。此操作将影响匹配这些标签的请求范围。
              </p>
              {assignMode === "replace" && <p className="gx-assignment-warning" role="status">将覆盖所选渠道的全部标签。未选择标签时，会清空这些渠道的标签。</p>}
              <label className="cx-field">
                <span>操作</span>
                <Select
                  aria-label="批量标签操作"
                  value={assignMode}
                  onChange={(e) =>
                    setAssignMode(e.target.value as typeof assignMode)
                  }
                >
                  <option value="add">追加标签</option>
                  <option value="replace">替换全部标签</option>
                  <option value="remove">移除标签</option>
                </Select>
              </label>
              <div className="cx-options">
                {tags.map((tag) => (
                  <Checkbox
                    key={tag}
                    checked={assignTags.includes(tag)}
                    onChange={() =>
                      setAssignTags((old) =>
                        old.includes(tag)
                          ? old.filter((value) => value !== tag)
                          : [...old, tag],
                      )
                    }
                  >
                    {tag}
                  </Checkbox>
                ))}
              </div>
            </>
          )}
          {modal === "tags" && (
            <>
              <p className="cx-hint">
                重命名会同步更新渠道和 API Key 策略。被 API Key
                引用的标签不能删除。
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void editTag();
                }}
              >
                <label className="cx-field">
                  <span>
                    {renameFrom ? `重命名 ${renameFrom}` : "新标签名称"}
                  </span>
                  <Input
                    value={tagName}
                    maxLength={256}
                    required
                    onChange={(e) => setTagName(e.target.value)}
                  />
                </label>
                <div className="gx-tag-tools">
                  <Button className="cx-primary" disabled={busy} type="submit">
                    {renameFrom ? "保存名称" : "创建标签"}
                  </Button>
                  {renameFrom && (
                    <Button
                      className="cx-subtle"
                      type="button"
                      onClick={() => {
                        setRenameFrom(null);
                        setTagName("");
                      }}
                    >
                      取消
                    </Button>
                  )}
                </div>
              </form>
              <div className="gx-tag-list">
                {tags.map((tag) => (
                  <article key={tag}>
                    <div>
                      <strong>{tag}</strong>
                      <small>
                        {
                          channels.filter((channel) =>
                            channel.tags.includes(tag),
                          ).length
                        }{" "}
                        个渠道
                      </small>
                    </div>
                    <Button
                      className="cx-subtle"
                      disabled={busy}
                      onClick={() => {
                        setRenameFrom(tag);
                        setTagName(tag);
                      }}
                    >
                      重命名
                    </Button>
                    <Button
                      className="cx-subtle cx-danger"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          title: "删除标签",
                          description: `确定删除标签「${tag}」？被 API Key 引用的标签不能删除。`,
                          action: async () => {
                            const success = await perform(async () => {
                              const data = await api<{ tags: string[] }>(
                                `/api/tags/${encodeURIComponent(tag)}`,
                                { method: "DELETE" },
                              );
                              ++tagListRevision.current;
                              setTagList(data.tags);
                              setChannels((old) => old.map((channel) => ({ ...channel, tags: channel.tags.filter((value) => value !== tag) })));
                              setFilterTags((old) => old.filter((prefix) => data.tags.some((value) => value === prefix || value.startsWith(`${prefix}/`))));
                            }, "标签已删除");
                            if (!success) throw new Error("操作失败");
                          },
                        })
                      }
                    >
                      删除
                    </Button>
                  </article>
                ))}
              </div>
            </>
          )}
          {modal === "strategy" &&
            (strategySettings ? (
              <RetrySettings
                settings={strategySettings}
                onDirtyChange={setStrategyDirty}
                onSavingChange={setStrategySaving}
                onSave={async (_settings, patch) => {
                  strategyPending.current = true;
                  setStrategySaving(true);
                  try {
                  const data = await api<
                    GatewaySettings | { settings: GatewaySettings }
                  >("/api/settings", {
                    method: "PATCH",
                    body: JSON.stringify(patch),
                  });
                  setStrategySettings(
                    "settings" in data ? data.settings : data,
                  );
                  try { await onRefresh?.(); }
                  catch { toast.error("策略已保存，但页面刷新失败。请刷新页面查看最新状态。"); }
                  } finally { strategyPending.current = false; setStrategySaving(false); }
                }}
              />
            ) : (
              <p className="cx-hint">
                {busy ? <LoaderCircle className="gx-spin" size={16} /> : null}{" "}
                {busy ? "正在加载策略…" : "策略加载失败，请关闭后重试。"}
              </p>
            ))}
        </ChannelDialog>
      )}
      {discardModal && <ChannelDialog title="放弃未保存的内容？" subtitle="当前修改尚未保存，关闭后需要重新填写。" onClose={() => setDiscardModal(false)} className="gx-discard-dialog" footer={<div className="gx-dialog-actions"><Button variant="secondary" onClick={() => setDiscardModal(false)}>继续编辑</Button><Button variant="danger" onClick={() => closeModal(true)}>放弃并关闭</Button></div>}><p className="cx-hint">确认后仅关闭当前编辑窗口。</p></ChannelDialog>}
    </div>
  );
}
function ChannelRows({
  channel,
  expanded,
  toggleExpand,
  selected,
  toggleSelect,
  active,
  show,
  colSpan,
  busy,
  resetHealth,
  toggleEnabled,
  onEdit,
  refresh,
  onPlayground,
}: {
  channel: GatewayChannel;
  expanded: boolean;
  toggleExpand: () => void;
  selected: boolean;
  toggleSelect: () => void;
  active: boolean;
  show: (column: Column) => boolean;
  colSpan: number;
  busy: boolean;
  resetHealth: () => void;
  toggleEnabled: () => void;
  onEdit: (channel: GatewayChannel) => void;
  refresh: () => Promise<void>;
  onPlayground?: (channelId?: string) => void;
}) {
  const rows = [
    <Table.Row
      key={channel.id}
      id={channel.id}
      textValue={channel.name}
      className={`${selected ? "gx-selected" : ""} ${active ? "gx-active" : ""}`}
    >
      <Table.Cell className="gx-expand-cell">
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          aria-expanded={expanded}
          aria-label={`展开 ${channel.name}`}
          onClick={toggleExpand}
        >
          <ChevronRight
            size={15}
            style={{ transform: expanded ? "rotate(90deg)" : undefined }}
          />
        </Button>
      </Table.Cell>
      <Table.Cell className="gx-check-cell">
        <Checkbox
          aria-label={`选择 ${channel.name}`}
          checked={selected}
          onChange={toggleSelect}
        />
      </Table.Cell>
      <Table.Cell className="gx-name" textValue={channel.name}>
        <div className="gx-channel-identity">
          <span className="gx-channel-mark">
            <ProviderIcon provider={channel.config.protocol === 'mock' ? channel.provider : channel.config.protocol} size={19} />
          </span>
          <div className="gx-channel-info">
            <strong className="gx-channel-title" title={channel.name}>{channel.name}</strong>
            {!show("provider") && <small className="gx-provider-subtitle" title={channel.provider}>{channel.provider}</small>}
            {!show("health") && <ChannelHealthSummary channel={channel} busy={busy} resetHealth={resetHealth} compact />}
            {['newapi', 'sub2api'].includes(channel.config.integration ?? '') && <div className="gx-name-meta">
              <div className="gx-account-summary">
                <span className="gx-balance-provider" title={`${channel.config.integration === 'newapi' ? 'NewAPI' : 'Sub2API'} 余额监控`}>{channel.config.integration === 'newapi' ? 'NewAPI' : 'Sub2API'}</span>
                <ChannelBalance channel={channel} refresh={refresh} />
              </div>
            </div>}
          </div>
        </div>
      </Table.Cell>
      {show("priority") && <Table.Cell className="gx-number gx-priority" textValue={String(channel.priority)}><span title="数值越小，调度优先级越高">{channel.priority}</span></Table.Cell>}
      {show("enabled") && (
        <Table.Cell>
          <Switch
            checked={channel.enabled}
            aria-label={`${channel.enabled ? "停用" : "启用"} ${channel.name}`}
            disabled={busy || channel.archived}
            onChange={toggleEnabled}
          />
        </Table.Cell>
      )}
      {show("health") && (
        <Table.Cell className="gx-health-cell">
          <ChannelHealthSummary channel={channel} busy={busy} resetHealth={resetHealth} />
        </Table.Cell>
      )}
      {show("models") && (
        <Table.Cell className="gx-model-cell">
          <ModelList models={channel.models} />
        </Table.Cell>
      )}
      {show("tags") && (
        <Table.Cell>
          <div className="gx-tags">
            {channel.tags.length ? (
              channel.tags.map((tag) => (
                <span className="gx-tag-text" key={tag} title={tag}>{tag}</span>
              ))
            ) : (
              <em>—</em>
            )}
          </div>
        </Table.Cell>
      )}
      {show("provider") && (
        <Table.Cell>
          <span className="gx-provider" title={channel.provider}>{channel.provider}</span>
        </Table.Cell>
      )}
      {show("weight") && (
        <Table.Cell className="gx-number">{channel.weight}</Table.Cell>
      )}
      {show("createdAt") && (
        <Table.Cell className="gx-date">
          {channel.createdAt
            ? new Date(channel.createdAt).toLocaleDateString("zh-CN", {
                timeZone: "Asia/Shanghai",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })
            : "—"}
        </Table.Cell>
      )}
      <Table.Cell className="gx-actions-cell">
        <ChannelActions
          channel={channel}
          onEdit={onEdit}
          onRefresh={refresh}
          onPlayground={onPlayground}
        />
      </Table.Cell>
    </Table.Row>,
  ];
  if (expanded)
    rows.push(
      <Table.Row
        key={`${channel.id}-details`}
        id={`${channel.id}-details`}
        textValue={`${channel.name}详情`}
        className="gx-details"
      >
        <Table.Cell colSpan={colSpan}>
          <div className="gx-detail-grid">
            <div>
              <small>上游端点</small>
              <code>{channel.endpoint}</code>
              <small>协议 / 接入方式</small>
              <strong>
                {channel.config.protocol} ·{" "}
                {channel.config.gatewayMode === "ai-gateway"
                  ? "Cloudflare AI Gateway"
                  : "直连"}
              </strong>
            </div>
            <div>
              <small>模型别名</small>
              <code>
                {channel.config.aliases.length
                  ? channel.config.aliases
                      .map((alias) => `${alias.from} → ${alias.to}`)
                      .join("\n")
                  : "未配置"}
              </code>
              <small>上游密钥</small>
              <strong>
                {channel.credentialCount} 个 · 优先级 {channel.priority}
              </strong>
            </div>
            <div>
              <small>健康判定</small>
              <strong>{channelStatusLabel(channel)} · {channelHealthView(channel).reason}</strong>
              <HealthHistory channel={channel} />
              <small>
                {channel.health.samples} 个样本 · 失败{" "}
                {channel.health.failureCount} · 恢复{" "}
                {channel.health.recoveryCount}
              </small>
              {channel.health.cooldownUntil && (
                <small>
                  冷却至{" "}
                  {new Date(channel.health.cooldownUntil).toLocaleString(
                    "zh-CN",
                    { timeZone: "Asia/Shanghai", hour12: false },
                  )}
                </small>
              )}
            </div>
            <div>
              <small>请求统计</small>
              <strong>
                {channel.requests} 次请求 · 成功率{" "}
                {channel.successRate.toFixed(1)}%
              </strong>
              <small>
                平均完成{" "}
                {channel.health.averageDuration != null
                  ? `${channel.health.averageDuration.toFixed(2)}s`
                  : "—"}
              </small>
            </div>
          </div>
        </Table.Cell>
      </Table.Row>,
    );
  return rows;
}
