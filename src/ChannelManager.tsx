import { useEffect, useMemo, useState } from "react";
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
  LayoutGrid,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Tag,
  Tags,
  X,
} from "lucide-react";
import { Button, Input, TextArea, Select, Checkbox, Switch, toast } from "./ui";
import { Card, Chip, Dropdown, Label, Pagination, Popover, Table } from "@heroui/react";
import type { GatewayChannel, GatewaySettings } from "../shared/types";
import { api } from "./api";
import ChannelActions, { ChannelDialog } from "./ChannelActions";
import RetrySettings from "./RetrySettings";
import ProviderIcon from "./ProviderIcon";
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
  | "tags"
  | "models"
  | "health"
  | "weight"
  | "createdAt";
const columns: { key: Column; label: string }[] = [
  { key: "provider", label: "服务商" },
  { key: "enabled", label: "状态" },
  { key: "tags", label: "标签" },
  { key: "models", label: "支持的模型" },
  { key: "health", label: "健康状态" },
  { key: "weight", label: "权重" },
  { key: "createdAt", label: "创建时间" },
];
type Modal =
  "settings" | "import" | "weights" | "tags" | "assign" | "strategy" | null;
const statusName = { healthy: "健康", degraded: "延迟异常", offline: "不可用" };
function ChannelBalance({ channel, refresh }: { channel: GatewayChannel; refresh: () => void | Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const balance = channel.accountBalance;
  const amount = balance?.amount;
  const unit = balance?.unit ?? '';
  const label = amount != null ? `${unit === 'USD' ? '$' : ''}${amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}${unit && unit !== 'USD' ? ` ${unit}` : ''}` : balance?.status === 'error' ? '刷新失败' : channel.hasAccountCredentials ? '待更新' : '未配置账户';
  const detail = [`余额 ${label}`, balance?.updatedAt ? `余额更新于 ${new Date(balance.updatedAt).toLocaleString('zh-CN')}` : '每 5 分钟自动刷新', balance?.error ?? '', '点击立即刷新'].filter(Boolean).join(' · ');
  return <Button type="button" variant="ghost" size="sm" className={`gx-balance ${balance?.status === 'error' ? 'gx-balance-error' : ''}`} disabled={loading || !channel.hasAccountCredentials} aria-label={`刷新 ${channel.name} 余额`} aria-busy={loading} title={detail} onClick={async () => {
    setLoading(true);
    try {
      const result = await api<{ channel: GatewayChannel }>(`/api/channels/${channel.id}/balance`, { method: 'POST' });
      if (result.channel.accountBalance?.status === 'error') toast.error(result.channel.accountBalance.error ?? '余额刷新失败');
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : '余额刷新失败'); }
    finally { setLoading(false); }
  }}>
    <span className="gx-balance-caption" title={detail}>余额</span>
    <strong className="gx-balance-amount" title={detail}>{label}</strong>
    {balance?.status === 'error' && amount != null && <span className="gx-balance-status" title={detail}>更新失败</span>}
    <RefreshCw size={13} aria-hidden="true" className={loading ? 'gx-spin' : ''} />
  </Button>;
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
      <Button variant="secondary" size="sm">
        {label}
        {selected.length ? (
          <Chip size="sm">{selected.length}</Chip>
        ) : (
          <ChevronDown size={13} />
        )}
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
function ModelChips({ models }: { models: string[] }) {
  const [all, setAll] = useState(false);
  return (
    <div className="gx-models">
      {(all ? models : models.slice(0, 3)).map((model) => (
        <Chip key={model} size="sm" title={model}>
          <Chip.Label>{model}</Chip.Label>
        </Chip>
      ))}
      {models.length > 3 && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? "收起" : `+${models.length - 3}`}
        </Button>
      )}
    </div>
  );
}
function savedView() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("pulsegate.channel-view.v2") || "{}",
    );
    return {
      size: [10, 20, 50, 100].includes(parsed.size)
        ? (parsed.size as number)
        : 20,
      columns: Array.isArray(parsed.columns)
        ? (parsed.columns.filter((value: Column) =>
            columns.some((c) => c.key === value),
          ) as Column[])
        : columns.map((c) => c.key),
    };
  } catch {
    return { size: 20, columns: columns.map((c) => c.key) };
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
    key: "name" | "provider" | "weight" | "createdAt";
    asc: boolean;
  }>({ key: "createdAt", asc: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
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
        "pulsegate.channel-view.v2",
        JSON.stringify({ size: pageSize, columns: visibleColumns }),
      );
    } catch {
      /* View preferences are optional. */
    }
  }, [pageSize, visibleColumns]);
  useEffect(() => {
    void api<{ tags: string[] }>("/api/tags")
      .then((data) => setTagList(data.tags))
      .catch(() => undefined);
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
      for (const tag of new Set(channel.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
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
            (!statuses.length ||
              statuses.includes(
                !channel.enabled ? "已停用" : statusName[channel.status],
              )) &&
            (!filterTags.length ||
              filterTags.some((tag) => channel.tags.includes(tag))) &&
            (!untaggedOnly || !channel.tags.length) &&
            (!filterModels.length ||
              filterModels.some((model) => channel.models.includes(model)))
          );
        })
        .sort((a, b) => {
          const difference =
            sort.key === "weight"
              ? a.weight - b.weight
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
  const toggleSelect = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
  async function refresh() {
    const data = await api<GatewayChannel[] | { channels: GatewayChannel[] }>(
      "/api/channels",
    );
    setChannels(Array.isArray(data) ? data : data.channels);
    await onRefresh?.();
  }
  async function perform(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await task();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function bulk(action: string, extra: Record<string, unknown> = {}) {
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
    }
    return success;
  }
  async function editTag() {
    const name = tagName.trim();
    if (!name || name.length > 30) {
      toast.error("标签名称须为 1–30 个字符");
      return;
    }
    if (
      await perform(
        async () => {
          await api(
            renameFrom
              ? `/api/tags/${encodeURIComponent(renameFrom)}`
              : "/api/tags",
            {
              method: renameFrom ? "PATCH" : "POST",
              body: JSON.stringify({ name }),
            },
          );
          const data = await api<{ tags: string[] }>("/api/tags");
          setTagList(data.tags);
        },
        renameFrom ? "标签已更新，API Key 引用已同步" : "标签已创建",
      )
    ) {
      if (renameFrom) {
        setFilterTags((old) => [
          ...new Set(old.map((tag) => (tag === renameFrom ? name : tag))),
        ]);
      }
      setRenameFrom(null);
      setTagName("");
    }
  }
  async function openStrategy() {
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
      <div className="gx-topbar">
        <div className="gx-top-note">
          <span>
            {channels.filter((channel) => !channel.archived).length} 个渠道
          </span>
        </div>
        <div className="gx-top-actions">
          <Button variant="ghost" onClick={() => void openStrategy()}>
            <SlidersHorizontal size={15} />
            负载均衡策略
          </Button>
          <Dropdown>
            <Button variant="ghost" aria-label="渠道管理工具">管理工具<ChevronDown size={14} /></Button>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="渠道管理工具" onAction={(id) => {
                if (id === "settings") setModal("settings");
                if (id === "import") { setImportText(""); setModal("import"); }
                if (id === "weights") { if (!selected.length) { toast.error("请先勾选需要调整的渠道"); return; } setModal("weights"); }
              }}>
                <Dropdown.Item id="import" textValue="批量导入"><FileUp size={16} /><Label>批量导入</Label></Dropdown.Item>
                <Dropdown.Item id="weights" textValue="批量调整权重"><ArrowUpDown size={16} /><Label>批量调整权重</Label></Dropdown.Item>
                <Dropdown.Item id="settings" textValue="列表设置"><Settings2 size={16} /><Label>列表设置</Label></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
      <div className="gx-workspace">
        <Card<"aside">
          render={(props) => <aside {...props} />}
          className="gx-tag-sidebar"
          aria-label="渠道标签筛选"
        >
          <Card.Header className="gx-tag-sidebar-header">
            <div>
              <Tags size={17} />
              <Card.Title>渠道标签</Card.Title>
            </div>
            <Chip size="sm">
              <Chip.Label>{tags.length}</Chip.Label>
            </Chip>
          </Card.Header>
          <Card.Content className="gx-tag-sidebar-body">
            <div className="gx-tag-search">
              <Input
                aria-label="搜索标签"
                placeholder="搜索标签…"
                value={tagSearch}
                onChange={(event) => setTagSearch(event.target.value)}
              />
              {tagSearch && (
                <Button
                  variant="ghost"
                  isIconOnly
                  aria-label="清除标签搜索"
                  onClick={() => setTagSearch("")}
                >
                  <X size={14} />
                </Button>
              )}
            </div>
            <div className="gx-tag-shortcuts">
              <Button
                className="gx-tag-option"
                variant={
                  !filterTags.length && !untaggedOnly ? "primary" : "ghost"
                }
                aria-pressed={!filterTags.length && !untaggedOnly}
                onClick={() => {
                  setFilterTags([]);
                  setUntaggedOnly(false);
                }}
              >
                <LayoutGrid size={15} />
                <span className="gx-tag-option-label">全部渠道</span>
                <Chip size="sm">
                  <Chip.Label>{tagCounts.all}</Chip.Label>
                </Chip>
              </Button>
              <Button
                className="gx-tag-option"
                variant={untaggedOnly ? "primary" : "ghost"}
                aria-pressed={untaggedOnly}
                onClick={() => {
                  setFilterTags([]);
                  setUntaggedOnly(true);
                }}
              >
                <Tag size={15} />
                <span className="gx-tag-option-label">未打标签</span>
                <Chip size="sm">
                  <Chip.Label>{tagCounts.untagged}</Chip.Label>
                </Chip>
              </Button>
            </div>
            <div className="gx-tag-caption">
              <span>标签 · 可多选</span>
              {filterTags.length > 0 && <span>已选 {filterTags.length}</span>}
            </div>
            <div
              className="gx-tag-options"
              role="group"
              aria-label="按标签筛选渠道"
            >
              {visibleTags.map((tag) => (
                <Button
                  key={tag}
                  className="gx-tag-option"
                  variant={filterTags.includes(tag) ? "primary" : "ghost"}
                  aria-label={`筛选标签 ${tag}`}
                  aria-pressed={filterTags.includes(tag)}
                  title={tag}
                  onClick={() => {
                    setUntaggedOnly(false);
                    setFilterTags((old) =>
                      old.includes(tag)
                        ? old.filter((value) => value !== tag)
                        : [...old, tag],
                    );
                  }}
                >
                  <Tag size={15} />
                  <span className="gx-tag-option-label">{tag}</span>
                  <Chip size="sm">
                    <Chip.Label>{tagCounts.counts.get(tag) ?? 0}</Chip.Label>
                  </Chip>
                </Button>
              ))}
              {!visibleTags.length && (
                <p className="gx-tag-empty">
                  {tagSearch.trim()
                    ? "没有匹配的标签"
                    : "暂无标签，可在下方创建"}
                </p>
              )}
            </div>
            <p className="gx-tag-hint">多选时匹配任一标签</p>
          </Card.Content>
          <Card.Footer>
            <Button
              className="gx-tag-manage"
              variant="secondary"
              onClick={() => {
                setTagName("");
                setRenameFrom(null);
                setModal("tags");
              }}
            >
              <Settings2 size={14} />
              管理标签
            </Button>
          </Card.Footer>
        </Card>
        <div className="gx-results">
          <div className="gx-filters">
            <label className="gx-search">
              <Search size={16} />
              <Input
                aria-label="搜索渠道"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按名称、端点或模型筛选"
              />
              {search && (
                <Button
                  variant="ghost"
                  isIconOnly
                  onClick={() => setSearch("")}
                  aria-label="清除搜索"
                >
                  <X size={14} />
                </Button>
              )}
            </label>
            <Filter
              label="服务商"
              values={availableProviders}
              selected={providers}
              onChange={setProviders}
            />
            <Filter
              label="状态"
              values={["健康", "延迟异常", "不可用", "已停用"]}
              selected={statuses}
              onChange={setStatuses}
            />
            <Filter
              label="模型"
              values={models}
              selected={filterModels}
              onChange={setFilterModels}
            />
            <Popover>
              <Button variant="secondary" size="sm">
                <Columns3 size={14} />
                列设置
              </Button>
              <Popover.Content placement="bottom end">
                <Popover.Dialog
                  className="gx-filter-panel"
                  aria-label="显示列设置"
                >
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
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </div>
          <div className="gx-meta">
            <div>
              <Button
                variant={archiveMode ? "ghost" : "primary"}
                onClick={() => { setArchiveMode(false); if (archiveMode) setSelected([]); }}
              >
                使用中
              </Button>
              <Button
                variant={archiveMode ? "primary" : "ghost"}
                onClick={() => { setArchiveMode(true); if (!archiveMode) setSelected([]); }}
              >
                已归档
              </Button>
              {activeFilters && (
                <Button
                  className="gx-link"
                  onClick={() => {
                    setSearch("");
                    setProviders([]);
                    setStatuses([]);
                    setFilterTags([]);
                    setUntaggedOnly(false);
                    setFilterModels([]);
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
            <div>
              <Button className="gx-link" onClick={onNavigateKeys}>
                <KeyRound size={14} />
                API Key 权限
              </Button>
            </div>
          </div>
          {selected.length > 0 && (
            <div className="gx-bulk">
              <strong>已选择 {selected.length} 个渠道</strong>
              <Button disabled={busy} onClick={() => void bulk("enable")}>
                启用
              </Button>
              <Button disabled={busy} onClick={() => void bulk("disable")}>
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
              <Button onClick={() => setSelected([])}>取消选择</Button>
            </div>
          )}
          <Table className="gx-channel-table">
            <Table.ScrollContainer>
              <Table.Content
                className="gx-table"
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
                              : undefined
                      }
                    >
                      {column.id === "select" ? (
                        <Checkbox
                          aria-label="选择本页全部渠道"
                          checked={pageSelected}
                          onChange={() =>
                            setSelected((old) =>
                              pageSelected
                                ? old.filter(
                                    (id) =>
                                      !shown.some(
                                        (channel) => channel.id === id,
                                      ),
                                  )
                                : [
                                    ...new Set([
                                      ...old,
                                      ...shown.map((channel) => channel.id),
                                    ]),
                                  ],
                            )
                          }
                        />
                      ) : column.id === "expand" ? (
                        <span className="gx-sr-only">展开</span>
                      ) : ["name", "provider", "weight", "createdAt"].includes(
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
                      <Search size={24} />
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
                          : "添加真实上游，或在开发测试场安装故障实验渠道。"}
                      </span>
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
        </div>
      </div>
      {confirmation && (
        <ChannelDialog
          title={confirmation.title}
          onClose={() => setConfirmation(null)}
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
          onClose={() => {
            setModal(null);
            setImportText("");
          }}
          wide={modal === "strategy"}
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
              <footer className="cx-footer">
                <Button className="cx-primary" onClick={() => setModal(null)}>
                  完成
                </Button>
              </footer>
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
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1048576) {
                      toast.error("文件不能超过 1 MB");
                      return;
                    }
                    void file.text().then(setImportText);
                  }}
                />
              </label>
              <label className="cx-field">
                <span>渠道 JSON</span>
                <TextArea
                  rows={14}
                  className="cx-code"
                  value={importText}
                  spellCheck={false}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={
                    '[{"name":"OpenAI 主渠道","provider":"OpenAI","endpoint":"https://api.openai.com/v1","models":["gpt-4.1"],"tags":["production"],"weight":1,"apiKeys":[{"label":"主密钥","secret":"sk-…"}]}]'
                  }
                />
              </label>
              <footer className="cx-footer">
                <Button
                  className="cx-primary"
                  disabled={busy || !importText.trim()}
                  onClick={() => {
                    let imported: unknown;
                    try {
                      const parsed = JSON.parse(importText);
                      imported = Array.isArray(parsed)
                        ? parsed
                        : parsed.channels;
                      if (!Array.isArray(imported) || !imported.length)
                        throw new Error("需要至少一个渠道");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "JSON 格式有误",
                      );
                      return;
                    }
                    void perform(
                      () =>
                        api("/api/channels/import", {
                          method: "POST",
                          body: JSON.stringify({ channels: imported }),
                        }),
                      "渠道已导入",
                    ).then((success) => {
                      if (success) {
                        setImportText("");
                        setModal(null);
                      }
                    });
                  }}
                >
                  {busy ? "导入中…" : "导入渠道"}
                </Button>
              </footer>
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
              <footer className="cx-footer">
                <Button
                  className="cx-primary"
                  disabled={
                    busy ||
                    !Number.isFinite(weight) ||
                    weight < 0 ||
                    weight > 10000
                  }
                  onClick={() => void bulk("weights", { weight })}
                >
                  保存权重
                </Button>
              </footer>
            </>
          )}
          {modal === "assign" && (
            <>
              <p className="cx-hint">
                标签用于 API Key
                的渠道权限。此操作将影响匹配这些标签的请求范围。
              </p>
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
              <footer className="cx-footer">
                <Button
                  className="cx-primary"
                  disabled={
                    busy || (!assignTags.length && assignMode !== "replace")
                  }
                  onClick={() =>
                    void bulk("tags", { tags: assignTags, mode: assignMode })
                  }
                >
                  应用到 {selected.length} 个渠道
                </Button>
              </footer>
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
                    maxLength={30}
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
                              await api(
                                `/api/tags/${encodeURIComponent(tag)}`,
                                { method: "DELETE" },
                              );
                              const data = await api<{ tags: string[] }>(
                                "/api/tags",
                              );
                              setTagList(data.tags);
                            }, "标签已删除");
                            if (!success) throw new Error("操作失败");
                            setFilterTags((old) =>
                              old.filter((value) => value !== tag),
                            );
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
                onSave={async (settings) => {
                  const data = await api<
                    GatewaySettings | { settings: GatewaySettings }
                  >("/api/settings", {
                    method: "PATCH",
                    body: JSON.stringify(settings),
                  });
                  setStrategySettings(
                    "settings" in data ? data.settings : data,
                  );
                  await onRefresh?.();
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
        <strong>{channel.name}</strong>
        <div className="gx-name-meta">
          {channel.config.protocol === "mock" && <small>本地故障实验</small>}
          {['newapi','sub2api'].includes(channel.config.integration ?? '') && <div className="gx-account-summary">
            <span className="gx-balance-provider" title={`${channel.config.integration === 'newapi' ? 'NewAPI' : 'Sub2API'} 余额监控`}>{channel.config.integration === 'newapi' ? 'NewAPI' : 'Sub2API'}</span>
            <ChannelBalance channel={channel} refresh={refresh} />
          </div>}
        </div>
      </Table.Cell>
      {show("provider") && (
        <Table.Cell>
          <Chip size="sm" className="gx-provider">
            <ProviderIcon
              provider={
                channel.config.protocol === "mock"
                  ? channel.provider
                  : channel.config.protocol
              }
              size={16}
            />
            <Chip.Label>{channel.provider}</Chip.Label>
          </Chip>
        </Table.Cell>
      )}
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
      {show("tags") && (
        <Table.Cell>
          <div className="gx-tags">
            {channel.tags.length ? (
              channel.tags.map((tag) => (
                <Chip key={tag} size="sm">
                  <Chip.Label>{tag}</Chip.Label>
                </Chip>
              ))
            ) : (
              <em>—</em>
            )}
          </div>
        </Table.Cell>
      )}
      {show("models") && (
        <Table.Cell className="gx-model-cell">
          <ModelChips models={channel.models} />
        </Table.Cell>
      )}
      {show("health") && (
        <Table.Cell className="gx-health-cell">
          <div
            className="gx-health-bars"
            title={`${statusName[channel.status]} · ${channel.health.reason || `平均首字 ${channel.health.averageTtft ?? "—"} s`}`}
          >
            {Array.from({ length: 14 }, (_, i) => {
              const recent = channel.history.slice(-14);
              const value = recent[i - (14 - recent.length)];
              return (
                <i
                  key={i}
                  className={
                    value == null
                      ? "gx-unknown"
                      : value === 2
                        ? "gx-bad"
                        : value === 1
                          ? "gx-slow"
                          : "gx-good"
                  }
                />
              );
            })}
          </div>
          <Chip
            size="sm"
            color={
              !channel.enabled
                ? "default"
                : channel.status === "healthy"
                  ? "success"
                  : channel.status === "degraded"
                    ? "warning"
                    : "danger"
            }
            className="gx-health-label"
          >
            <Chip.Label>
              {channel.enabled ? statusName[channel.status] : "已停用"}
              {channel.health.averageTtft != null
                ? ` · ${channel.health.averageTtft.toFixed(2)}s`
                : " · 无样本"}
            </Chip.Label>
          </Chip>
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
              <strong>{channel.health.reason || "暂无异常记录"}</strong>
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
