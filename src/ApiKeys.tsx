import { useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Ellipsis,
  KeyRound,
  Layers,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Accordion, Alert, Card, Chip, Dropdown, Table, Tabs } from "@heroui/react";
import { Button, Checkbox, Dialog, Input, Select, toast } from "./ui";
import type { GatewayChannel as Channel, GatewayApiKey as ApiKey, KeyProfile as Profile } from "../shared/types";
import { api } from "./api";
import { editableRequestLimit, modelsForProfile, requestLimitLabel } from "./access-policy";
import "./api-keys.css";

type Scope = "all" | "tags" | "channels";
type TagMatch = "any" | "all" | "none";
type EditorDraft = {
  name: string;
  expires: string;
  note: string;
  profiles: Profile[];
  activeProfile: string;
};
const scopeNames: Record<Scope, string> = {
  all: "所有渠道",
  tags: "按标签限定",
  channels: "指定渠道",
};
const matchNames: Record<TagMatch, string> = {
  any: "任一匹配 · OR",
  all: "全部匹配 · AND",
  none: "排除匹配 · NONE",
};

function newId() {
  return crypto.randomUUID();
}
function blankProfile(name = "默认策略"): Profile {
  return {
    id: newId(),
    name,
    scope: "all",
    tags: [],
    match: "any",
    channelIds: [],
    modelMode: "all",
    models: [],
    requestLimit: "",
    mappings: [],
  };
}
function channelTags(channel: Channel) {
  return channel.tags ?? [];
}
function channelModels(channel: Channel) {
  return [...new Set([...(channel.models?.length ? channel.models : [channel.model]), ...channel.config.aliases.map(alias => alias.from)])];
}
function scopedChannels(profile: Profile, channels: Channel[]) {
  channels = channels.filter(channel => !channel.archived);
  if (profile.scope === "all") return channels;
  if (profile.scope === "channels")
    return channels.filter((channel) =>
      profile.channelIds.includes(channel.id),
    );
  if (!profile.tags.length) return [];
  return channels.filter((channel) => {
    const tags = channelTags(channel);
    if (profile.match === "all")
      return profile.tags.every((tag) => tags.includes(tag));
    if (profile.match === "none")
      return profile.tags.every((tag) => !tags.includes(tag));
    return profile.tags.some((tag) => tags.includes(tag));
  });
}
function permittedModels(profile: Profile, channels: Channel[]) {
  const models = [
    ...new Set(scopedChannels(profile, channels).flatMap(channelModels)),
  ];
  return profile.modelMode === "all"
    ? models
    : models.filter((model) => profile.models.includes(model));
}
function eligibleChannels(profile: Profile, channels: Channel[]) {
  const models = permittedModels(profile, channels);
  return scopedChannels(profile, channels).filter((channel) =>
    channelModels(channel).some((model) => models.includes(model)),
  );
}
function currentProfile(key: ApiKey) {
  return (
    key.profiles.find((profile) => profile.id === key.activeProfile) ??
    key.profiles[0]
  );
}
function Modal({ title, subtitle, children, onClose, wide = false, footer }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; footer?: ReactNode }) {
  return <Dialog title={title} subtitle={subtitle} close={onClose} wide={wide} footer={footer} className="ak-dialog">{children}</Dialog>;
}
function ScopePreview({
  profile,
  channels,
}: {
  profile: Profile;
  channels: Channel[];
}) {
  const scope = scopedChannels(profile, channels);
  const eligible = eligibleChannels(profile, channels);
  const healthy = eligible.filter(
    (channel) => channel.enabled && !channel.health.autoDisabled && channel.status === "healthy",
  );
  const models = modelsForProfile(channels, profile, true);
  const label =
    profile.scope === "tags"
      ? `${matchNames[profile.match]}：${profile.tags.join("、") || "未选择标签"}`
      : profile.scope === "channels"
        ? "仅允许选定的渠道"
        : "允许所有现有渠道，以及后续新增渠道";
  return (
    <Card className="ak-preview">
      <div className="ak-preview-title">
        <ShieldCheck size={19} />
        <h3>权限预览</h3>
        <span>实时</span>
      </div>
      <p className="ak-preview-rule">{label}</p>
      <div className="ak-preview-counts">
        <div>
          <strong>{scope.length}</strong>
          <span>授权范围内渠道</span>
        </div>
        <div>
          <strong>{healthy.length}</strong>
          <span>健康且可用</span>
        </div>
      </div>
      <div className="ak-preview-list">
        {scope.map((channel) => {
          const modelMatches = eligible.some((item) => item.id === channel.id);
          const available =
            channel.enabled && !channel.health.autoDisabled && channel.status === "healthy" && modelMatches;
          return (
            <div className="ak-preview-channel" key={channel.id}>
              <div>
                <strong>{channel.name}</strong>
                <span>{channelModels(channel).join(" · ")}</span>
              </div>
              <Chip size="sm" color={available ? "success" : channel.status === "degraded" ? "warning" : "default"}>
                {!channel.enabled
                  ? "已停用"
                  : channel.health.autoDisabled
                    ? "自动停用"
                  : !modelMatches
                    ? "模型未授权"
                    : channel.status === "healthy"
                      ? "可用"
                      : channel.status === "degraded"
                        ? "已降级"
                        : "离线"}
              </Chip>
            </div>
          );
        })}
      </div>
      {!scope.length ? (
        <Alert status="warning" className="ak-preview-warning"><Alert.Content><Alert.Description>当前条件没有匹配的渠道，请求将拒绝放行。</Alert.Description></Alert.Content></Alert>
      ) : !healthy.length ? (
        <Alert status="warning" className="ak-preview-warning"><Alert.Content><Alert.Description>当前没有健康且可用的授权渠道；不会切换到范围外的渠道。</Alert.Description></Alert.Content></Alert>
      ) : null}
      <div className="ak-preview-models">
        <span>可访问模型 · {models.length}</span>
        <div>
          {models.length ? (
            models.map((model) => (
              <Chip size="sm" key={model}>
                {model}
              </Chip>
            ))
          ) : (
            <small>暂无匹配模型</small>
          )}
        </div>
      </div>
      <p className="ak-preview-foot">
        <LockKeyhole size={15} />{" "}
        自动故障切换只发生在相同授权范围内。停用和降级状态不会改变授权范围。
      </p>
    </Card>
  );
}

export default function ApiKeys({ channels, keys, tags, onChange }: { channels: Channel[]; keys: ApiKey[]; tags: string[]; onChange: () => Promise<void> }) {
  const editorFormId = useId();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editor, setEditor] = useState<{
    id: string | null;
    draft: EditorDraft;
    editingProfile: string;
  } | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(
    null,
  );
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const [rotate, setRotate] = useState<ApiKey | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const allTags = useMemo(
    () =>
      [...new Set([...channels.flatMap(channelTags), ...tags])].sort(),
    [channels, tags],
  );
  const visible = keys.filter(
    (key) =>
      `${key.name} ${key.note}`.toLowerCase().includes(search.toLowerCase()) &&
      (statusFilter === "all" || key.status === statusFilter),
  );
  const profile = editor?.draft.profiles.find(
    (item) => item.id === editor.editingProfile,
  );
  const profileModels = profile
    ? [
        ...new Set(scopedChannels(profile, channels).flatMap(channelModels)),
      ].sort()
    : [];
  const missingModels =
    profile?.models.filter((model) => !profileModels.includes(model)) ?? [];
  const preview = keys.find((key) => key.id === previewKey);

  function startCreate() {
    const initial = blankProfile();
    setEditor({
      id: null,
      draft: {
        name: "",
        expires: "",
        note: "",
        profiles: [initial],
        activeProfile: initial.id,
      },
      editingProfile: initial.id,
    });
  }
  function startEdit(key: ApiKey) {
    setEditor({
      id: key.id,
      draft: structuredClone({
        name: key.name,
        expires: ['永不过期', 'never'].includes(key.expires) ? '' : key.expires,
        note: key.note,
        profiles: key.profiles.map(item => ({ ...item, requestLimit: editableRequestLimit(item.requestLimit) })),
        activeProfile: key.activeProfile,
      }),
      editingProfile: key.activeProfile,
    });
  }
  function updateDraft(update: Partial<EditorDraft>) {
    setEditor((value) =>
      value ? { ...value, draft: { ...value.draft, ...update } } : value,
    );
  }
  function updateProfile(update: Partial<Profile>) {
    setEditor((value) =>
      value
        ? {
            ...value,
            draft: {
              ...value.draft,
              profiles: value.draft.profiles.map((item) =>
                item.id === value.editingProfile
                  ? { ...item, ...update }
                  : item,
              ),
            },
          }
        : value,
    );
  }
  function toggleSelection(list: string[], value: string) {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }
  async function runMutation(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await action(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "操作失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refreshKeys() {
    try { await onChange(); }
    catch { toast.error("变更已保存，但列表刷新失败，请刷新页面"); }
  }
  async function setActiveProfile(key: ApiKey, id: string) {
    await runMutation(async () => {
      await api<{ key: ApiKey }>(`/api/keys/${encodeURIComponent(key.id)}`, { method: "PATCH", body: JSON.stringify({ activeProfile: id }) });
      toast.success("已切换当前生效策略"); await refreshKeys();
    });
  }
  async function setKeyStatus(key: ApiKey) {
    await runMutation(async () => {
      const status = key.status === "active" ? "disabled" : "active";
      await api<{ key: ApiKey }>(`/api/keys/${encodeURIComponent(key.id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(status === "active" ? "凭证已启用" : "凭证已停用"); await refreshKeys();
    });
  }
  async function confirmRevoke() {
    if (!revoke) return;
    await runMutation(async () => {
      await api<{ key: ApiKey }>(`/api/keys/${encodeURIComponent(revoke.id)}`, { method: "DELETE" });
      setRevoke(null); toast.success("API Key 已撤销"); await refreshKeys();
    });
  }
  async function confirmRotate() {
    if (!rotate) return;
    await runMutation(async () => {
      const result = await api<{ key: ApiKey; token: string }>(`/api/keys/${encodeURIComponent(rotate.id)}/rotate`, { method: "POST" });
      setRotate(null); setSecret({ name: result.key.name, value: result.token }); toast.success("密钥已轮换，旧密钥立即失效"); await refreshKeys();
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const draft = editor.draft;
    if (!draft.name.trim()) {
      toast.error("请填写 API Key 名称");
      return;
    }
    if (
      draft.expires &&
      draft.expires <=
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    ) {
      toast.error("到期时间必须晚于今天");
      return;
    }
    for (const item of draft.profiles) {
      if (!item.name.trim()) {
        toast.error("请为每个策略填写名称");
        return;
      }
      if (item.scope === "tags" && !item.tags.length) {
        toast.error(`「${item.name}」至少需要选择一个标签`);
        return;
      }
      if (item.scope === "channels" && !item.channelIds.length) {
        toast.error(`「${item.name}」至少需要选择一个渠道`);
        return;
      }
      if (item.modelMode === "selected" && !item.models.length) {
        toast.error(`「${item.name}」至少需要选择一个模型`);
        return;
      }
      if (
        item.requestLimit &&
        (!/^\d+$/.test(item.requestLimit) || !Number.isSafeInteger(Number(item.requestLimit)) || Number(item.requestLimit) <= 0)
      ) {
        toast.error("请求额度需要填写大于 0 的整数");
        return;
      }
      if (
        item.mappings.some(
          (mapping) => !mapping.from.trim() || !mapping.to.length,
        )
      ) {
        toast.error("模型映射需要填写入口名称和至少一个目标模型");
        return;
      }
      const aliases = item.mappings.map((mapping) => mapping.from.trim());
      if (new Set(aliases).size !== aliases.length) {
        toast.error("同一策略内的模型映射入口名称不能重复");
        return;
      }
      const allowed = permittedModels(item, channels);
      if (
        item.mappings.some((mapping) =>
          mapping.to.some((model) => !allowed.includes(model)),
        )
      ) {
        toast.error(`「${item.name}」的映射目标必须属于可访问模型`);
        return;
      }
    }
    const normalized = {
      ...draft,
      name: draft.name.trim(),
      profiles: draft.profiles.map((item) => ({
        ...item,
        name: item.name.trim(),
        mappings: item.mappings.map((mapping) => ({
          from: mapping.from.trim(),
          to: mapping.to,
        })),
      })),
    };
    await runMutation(async () => {
      if (editor.id) {
        await api<{ key: ApiKey }>(`/api/keys/${encodeURIComponent(editor.id)}`, { method: "PATCH", body: JSON.stringify(normalized) });
        setEditor(null); toast.success("API Key 配置已保存");
      } else {
        const result = await api<{ key: ApiKey; token: string }>("/api/keys", { method: "POST", body: JSON.stringify(normalized) });
        setEditor(null); setSecret({ name: result.key.name, value: result.token }); toast.success("API Key 已创建");
      }
      await refreshKeys();
    });
  }
  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      toast.success("API Key 已复制");
    } catch {
      toast.error("无法自动复制，请手动选择并复制凭证");
    }
  }

  return (
    <div className="ak-page">
      <div className="ak-page-tools">
        <span>{keys.length} 个访问凭证</span>
        <Button
          type="button"
          variant="primary" className="ak-button ak-primary"
          onClick={startCreate}
          disabled={busy}
        >
          <Plus size={17} /> 创建 API Key
        </Button>
      </div>
      <Card className="ak-panel">
        <div className="ak-filterbar">
          <div className="ak-search">
            <Search size={17} />
            <Input
              aria-label="搜索 API Key"
              placeholder="搜索名称或备注…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            className="ak-filter-select"
            aria-label="筛选凭证状态"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="active">已启用</option>
            <option value="disabled">已停用</option>
            <option value="revoked">已撤销</option>
          </Select>
          <span className="ak-result-count">{visible.length} 个凭证</span>
        </div>
        <Table className="ak-key-table">
          <Table.ScrollContainer>
          <Table.Content aria-label="API Key 访问凭证" className="ak-table">
            <Table.Header>
                <Table.Column id="name" isRowHeader>名称 / 凭证</Table.Column>
                <Table.Column id="status">状态</Table.Column>
                <Table.Column id="scope">授权范围</Table.Column>
                <Table.Column id="usage">用量 / 有效期</Table.Column>
                <Table.Column id="actions" className="ak-actions-head">操作</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <div className="ak-empty"><KeyRound size={30} /><strong>没有匹配的 API Key</strong><p>调整搜索条件，或创建新的应用访问凭证。</p></div>}>
              {visible.map((key) => {
                const active = currentProfile(key);
                const scope = scopedChannels(active, channels);
                return (
                  <Table.Row id={key.id} key={key.id}>
                    <Table.Cell>
                      <div className="ak-key-cell">
                        <span className="ak-key-icon">
                          <KeyRound size={19} />
                        </span>
                        <div>
                          <strong title={key.note || undefined}>{key.name}</strong>
                          <code>{key.preview}</code>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={key.status === "active" ? "success" : key.status === "revoked" ? "danger" : "default"}>
                        {key.status === "active"
                          ? "已启用"
                          : key.status === "disabled"
                            ? "已停用"
                            : "已撤销"}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="ak-scope-cell">
                        {key.profiles.length > 1 ? (
                          <Select
                            aria-label={`${key.name} 当前策略`}
                            value={key.activeProfile}
                            disabled={busy || key.status === "revoked"}
                            onChange={(event) =>
                              setActiveProfile(key, event.target.value)
                            }
                          >
                            {key.profiles.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </Select>
                        ) : null}
                        <div className="ak-scope-summary">
                          <strong>{scopeNames[active.scope]}</strong>
                          <span>· {scope.length} 个渠道</span>
                        </div>
                        {active.scope === "tags" && (
                          <div className="ak-inline-tags">
                            {active.match === "none" && <small>排除</small>}
                            {active.tags.slice(0, 2).map((tag) => (
                              <Chip size="sm" key={tag}>
                                {tag}
                              </Chip>
                            ))}
                            {active.tags.length > 2 && (
                              <small>+{active.tags.length - 2}</small>
                            )}
                          </div>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="ak-usage-cell">
                        <strong>{key.used.toLocaleString()} 次请求</strong>
                        <span>{!key.expires || ['永不过期','never'].includes(key.expires) ? "永不过期" : `${key.expires} 到期`}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="ak-row-actions">
                        <Button
                          type="button"
                          isIconOnly variant="tertiary" size="sm" className="ak-icon-button"
                          title="编辑权限"
                          aria-label={`编辑 ${key.name}`}
                          disabled={busy || key.status === "revoked"}
                          onClick={() => startEdit(key)}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Dropdown>
                          <Button type="button" isIconOnly variant="ghost" size="sm" aria-label={`${key.name} 更多操作`} title="更多操作" disabled={busy}><Ellipsis size={18} /></Button>
                          <Dropdown.Popover placement="bottom end">
                            <Dropdown.Menu aria-label={`${key.name} 凭证操作`} onAction={action => {
                              if (action === "permissions") setPreviewKey(key.id);
                              if (action === "status") void setKeyStatus(key);
                              if (action === "rotate") setRotate(key);
                              if (action === "revoke") setRevoke(key);
                            }}>
                              <Dropdown.Item id="permissions" textValue="查看详情与权限"><ShieldCheck size={16} />查看详情与权限</Dropdown.Item>
                              <Dropdown.Item id="status" textValue={key.status === "active" ? "停用凭证" : "启用凭证"} isDisabled={key.status === "revoked"}><LockKeyhole size={16} />{key.status === "active" ? "停用凭证" : "启用凭证"}</Dropdown.Item>
                              <Dropdown.Item id="rotate" textValue="轮换密钥" isDisabled={key.status === "revoked"}><RotateCcw size={16} />轮换密钥</Dropdown.Item>
                              <Dropdown.Item id="revoke" textValue="撤销凭证" variant="danger" isDisabled={key.status === "revoked"}><Trash2 size={16} />撤销凭证</Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card>

      {editor && profile && (
        <Modal
          wide
          title={editor.id ? "编辑 API Key" : "创建 API Key"}
          subtitle="设置名称与渠道权限，即可开始使用。"
          onClose={() => setEditor(null)}
          footer={<div className="ak-editor-footer"><Button variant="secondary" type="button" disabled={busy} onClick={() => setEditor(null)}>取消</Button><Button variant="primary" type="submit" form={editorFormId} disabled={busy}>{busy ? "正在保存…" : editor.id ? "保存配置" : "创建 API Key"}</Button></div>}
        >
          <form id={editorFormId} className="ak-editor-form" onSubmit={save}>
            <div className="ak-editor-layout">
              <div className="ak-editor-fields">
                <section className="ak-form-section">
                  <h3>基本信息</h3>
                  <div className="ak-two-columns">
                    <label className="ak-field">
                      <span>名称 <em>*</em></span>
                      <Input
                        autoFocus
                        autoComplete="off"
                        placeholder="例如：生产环境应用"
                        maxLength={80}
                        value={editor.draft.name}
                        onChange={(event) =>
                          updateDraft({ name: event.target.value })
                        }
                        required
                      />
                    </label>
                    <label className="ak-field">
                      <span>到期时间 <small>可选</small></span>
                      <Input
                        type="date"
                        aria-label="到期时间"
                        value={editor.draft.expires}
                        onChange={(event) =>
                          updateDraft({ expires: event.target.value })
                        }
                      />
                      <small>留空表示永不到期</small>
                    </label>
                  </div>
                  <label className="ak-field">
                    <span>备注 <small>可选</small></span>
                    <Input
                      placeholder="说明用途，便于后续管理（可选）"
                      maxLength={300}
                      value={editor.draft.note}
                      onChange={(event) =>
                        updateDraft({ note: event.target.value })
                      }
                    />
                  </label>
                </section>
                <section className="ak-form-section">
                  <h3>渠道权限</h3>
                  <Tabs selectedKey={editor.editingProfile} onSelectionChange={id => setEditor({ ...editor, editingProfile: String(id) })}>
                  <Tabs.ListContainer className={`ak-profile-tabs ${editor.draft.profiles.length === 1 ? "ak-profile-tabs-single" : ""}`}>
                  <Tabs.List aria-label="API Key 访问策略">
                    {editor.draft.profiles.map((item) => (
                      <Tabs.Tab
                        id={item.id}
                        key={item.id}
                      >
                        {item.name || "未命名策略"}
                        {item.id === editor.draft.activeProfile && (
                          <Check size={13} />
                        )}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel id={profile.id}>
                  <div className="ak-scope-options">
                    {(["all", "tags", "channels"] as Scope[]).map((scope) => (
                      <Button
                        type="button"
                        key={scope}
                        variant={profile.scope === scope ? "primary" : "secondary"}
                        className={`ak-scope-option ${profile.scope === scope ? "ak-option-selected" : ""}`}
                        aria-pressed={profile.scope === scope}
                        onClick={() => updateProfile({ scope })}
                      >
                        {scope === "all" ? (
                          <Layers size={17} />
                        ) : scope === "tags" ? (
                          <Tag size={17} />
                        ) : (
                          <ShieldCheck size={17} />
                        )}
                        <strong>
                          {scope === "all"
                            ? "不限制渠道"
                            : scope === "tags"
                              ? "限定标签"
                              : "指定渠道"}
                        </strong>
                      </Button>
                    ))}
                  </div>
                  {profile.scope === "tags" && (
                    <div className="ak-condition-box">
                      <label className="ak-field">
                        标签匹配规则
                        <Select
                          aria-label="标签匹配规则"
                          value={profile.match}
                          onChange={(event) =>
                            updateProfile({
                              match: event.target.value as TagMatch,
                            })
                          }
                        >
                          <option value="any">任一匹配（OR，默认）</option>
                          <option value="all">全部匹配（AND）</option>
                          <option value="none">排除匹配（NONE）</option>
                        </Select>
                      </label>
                      <p className="ak-field-help">
                        {profile.match === "any"
                          ? "渠道包含任一选中标签即可进入授权范围。"
                          : profile.match === "all"
                            ? "渠道必须包含全部选中标签才能进入授权范围。"
                            : "包含任一选中标签的渠道会被排除；无标签渠道可匹配。"}
                      </p>
                      <div className="ak-tag-options">
                        {[...new Set([...allTags, ...profile.tags])].map(
                          (tag) => (
                            <Button
                              type="button"
                              size="sm"
                              variant={profile.tags.includes(tag) ? "primary" : "secondary"}
                              className={`ak-tag-option ${profile.tags.includes(tag) ? "ak-tag-selected" : ""}`}
                              key={tag}
                              aria-pressed={profile.tags.includes(tag)}
                              onClick={() =>
                                updateProfile({
                                  tags: toggleSelection(profile.tags, tag),
                                })
                              }
                            >
                              {profile.tags.includes(tag) ? (
                                <Check size={13} />
                              ) : (
                                <Tag size={13} />
                              )}
                              {tag}
                              <span>
                                {
                                  channels.filter((channel) =>
                                    channelTags(channel).includes(tag),
                                  ).length
                                }
                              </span>
                            </Button>
                          ),
                        )}
                      </div>
                      {!allTags.length && (
                        <p className="ak-field-help">
                          渠道尚未配置标签，请先在渠道管理中添加。
                        </p>
                      )}
                    </div>
                  )}
                  {profile.scope === "channels" && (
                    <div className="ak-channel-options">
                      {channels.map((channel) => (
                          <Checkbox className="ak-channel-option" key={channel.id}
                            aria-label={`允许渠道 ${channel.name}`}
                            checked={profile.channelIds.includes(channel.id)}
                            onChange={() =>
                              updateProfile({
                                channelIds: toggleSelection(
                                  profile.channelIds,
                                  channel.id,
                                ),
                              })
                            }
                          >
                          <span>
                            <strong>{channel.name}</strong>
                            <small>
                              {channel.provider} ·{" "}
                              {channelModels(channel).length} 个模型
                            </small>
                          </span>
                          <small>{channel.enabled ? "" : "已停用"}</small>
                          </Checkbox>
                      ))}
                      {profile.channelIds.some(
                        (id) => !channels.some((channel) => channel.id === id),
                      ) && (
                        <p className="ak-field-help">
                          有已删除的渠道留在策略中，它们不会匹配请求。
                        </p>
                      )}
                    </div>
                  )}
                  <div className="ak-access-summary"><ShieldCheck size={16} /><span><strong>{scopedChannels(profile, channels).length}</strong> 个渠道 · <strong>{eligibleChannels(profile, channels).filter(channel => channel.enabled && !channel.health.autoDisabled && channel.status === "healthy").length}</strong> 个健康可用 · <strong>{permittedModels(profile, channels).length}</strong> 个模型</span></div>
                  {!scopedChannels(profile, channels).length && <p className="ak-access-warning">当前条件没有匹配渠道，请选择标签或渠道。</p>}
                  {scopedChannels(profile, channels).length > 0 && !eligibleChannels(profile, channels).some(channel => channel.enabled && !channel.health.autoDisabled && channel.status === "healthy") && <p className="ak-access-warning">授权范围内暂无健康可用渠道，故障切换也会遵守此范围。</p>}
                  </Tabs.Panel>
                  </Tabs>
                </section>
                <div className="ak-advanced-heading">高级设置</div>
                <Accordion key={profile.id} className="ak-advanced" allowsMultipleExpanded>
                  <Accordion.Item id="model-access">
                    <Accordion.Heading><Accordion.Trigger><span>模型与请求额度</span><small>{profile.modelMode === "all" ? "全部模型" : `已选 ${profile.models.length} 个模型`} · {requestLimitLabel(profile.requestLimit)}额度</small><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
                    <Accordion.Panel><Accordion.Body>
                  <div className="ak-segmented">
                    <Button
                      type="button"
                      variant={profile.modelMode === "all" ? "primary" : "secondary"}
                      className={
                        profile.modelMode === "all" ? "ak-selected" : ""
                      }
                      onClick={() => updateProfile({ modelMode: "all" })}
                    >
                      范围内全部模型
                    </Button>
                    <Button
                      type="button"
                      variant={profile.modelMode === "selected" ? "primary" : "secondary"}
                      className={
                        profile.modelMode === "selected" ? "ak-selected" : ""
                      }
                      onClick={() => updateProfile({ modelMode: "selected" })}
                    >
                      选定模型白名单
                    </Button>
                  </div>
                  {profile.modelMode === "selected" && (
                    <div className="ak-model-options">
                      {profileModels.map((model) => (
                          <Checkbox key={model}
                            checked={profile.models.includes(model)}
                            onChange={() =>
                              updateProfile({
                                models: toggleSelection(profile.models, model),
                              })
                            }
                          >
                          {model}
                          </Checkbox>
                      ))}
                      {missingModels.map((model) => (
                          <Checkbox key={model} className="ak-unavailable-model"
                            checked
                            onChange={() =>
                              updateProfile({
                                models: profile.models.filter(
                                  (item) => item !== model,
                                ),
                              })
                            }
                          >
                          {model}
                          <small>当前渠道不支持</small>
                          </Checkbox>
                      ))}
                      {!profileModels.length && (
                        <p className="ak-field-help">
                          当前渠道范围下没有可选择模型。
                        </p>
                      )}
                    </div>
                  )}
                  <label className="ak-field ak-limit-field">
                    累计请求额度
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="不限制（可选）"
                      value={profile.requestLimit}
                      onChange={(event) =>
                        updateProfile({ requestLimit: event.target.value })
                      }
                    />
                    <small>累计额度由网关原子检查，达到上限后返回 429。</small>
                  </label>
                    </Accordion.Body></Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item id="model-mappings">
                    <Accordion.Heading><Accordion.Trigger><span>模型映射</span><small>{profile.mappings.length ? `${profile.mappings.length} 条映射` : "未配置"}</small><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
                    <Accordion.Panel><Accordion.Body>
                  <div className="ak-section-title ak-mapping-title">
                    <div>
                      <p className="ak-field-help">
                        一个入口名称可映射到多个已授权模型。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="tertiary" size="sm" className="ak-link-button"
                      onClick={() =>
                        updateProfile({
                          mappings: [...profile.mappings, { from: "", to: [] }],
                        })
                      }
                    >
                      <Plus size={14} />
                      添加
                    </Button>
                  </div>
                  {profile.mappings.map((mapping, index) => (
                    <div className="ak-mapping-row" key={index}>
                      <Input
                        aria-label={`模型映射 ${index + 1} 入口名称`}
                        placeholder="入口名称，如 smart-chat"
                        value={mapping.from}
                        onChange={(event) =>
                          updateProfile({
                            mappings: profile.mappings.map((item, position) =>
                              position === index
                                ? { ...item, from: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <ChevronRight size={16} />
                      <div className="ak-mapping-targets">
                        {permittedModels(profile, channels).map((model) => (
                            <Checkbox key={model}
                              checked={mapping.to.includes(model)}
                              onChange={() =>
                                updateProfile({
                                  mappings: profile.mappings.map(
                                    (item, position) =>
                                      position === index
                                        ? {
                                            ...item,
                                            to: toggleSelection(item.to, model),
                                          }
                                        : item,
                                  ),
                                })
                              }
                            >
                            {model}
                            </Checkbox>
                        ))}
                        {mapping.to
                          .filter(
                            (model) =>
                              !permittedModels(profile, channels).includes(
                                model,
                              ),
                          )
                          .map((model) => (
                              <Checkbox className="ak-unavailable-model" key={model}
                                checked
                                onChange={() =>
                                  updateProfile({
                                    mappings: profile.mappings.map(
                                      (item, position) =>
                                        position === index
                                          ? {
                                              ...item,
                                              to: item.to.filter(
                                                (value) => value !== model,
                                              ),
                                            }
                                          : item,
                                    ),
                                  })
                                }
                              >
                              {model}
                              <small>当前不可访问</small>
                              </Checkbox>
                          ))}
                        {!permittedModels(profile, channels).length &&
                          !mapping.to.length && (
                            <small>请先选择允许的模型</small>
                          )}
                      </div>
                      <Button
                        type="button"
                        isIconOnly variant="danger-soft" size="sm" className="ak-icon-button ak-danger-icon"
                        aria-label={`删除模型映射 ${index + 1}`}
                        onClick={() =>
                          updateProfile({
                            mappings: profile.mappings.filter(
                              (_, position) => position !== index,
                            ),
                          })
                        }
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  ))}
                    </Accordion.Body></Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item id="profiles">
                    <Accordion.Heading><Accordion.Trigger><span>策略管理</span><small>{editor.draft.profiles.length} 个策略 · {editor.draft.profiles.find(item => item.id === editor.draft.activeProfile)?.name} 生效</small><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
                    <Accordion.Panel><Accordion.Body>
                  <div className="ak-profile-settings">
                    <label className="ak-field">
                      策略名称
                      <Input
                        value={profile.name}
                        maxLength={40}
                        onChange={(event) =>
                          updateProfile({ name: event.target.value })
                        }
                      />
                    </label>
                    <div className="ak-profile-actions">
                      {editor.draft.activeProfile !== profile.id ? (
                        <Button
                          type="button"
                          variant="secondary" size="sm" className="ak-button ak-small"
                          onClick={() =>
                            updateDraft({ activeProfile: profile.id })
                          }
                        >
                          设为生效策略
                        </Button>
                      ) : (
                        <Chip size="sm" color="success" className="ak-current">
                          <CheckCircle2 size={14} />
                          当前生效
                        </Chip>
                      )}
                      {editor.draft.profiles.length > 1 && (
                        <Button
                          type="button"
                          isIconOnly variant="danger-soft" size="sm" className="ak-icon-button ak-danger-icon"
                          aria-label="删除当前策略"
                          onClick={() => {
                            const remaining = editor.draft.profiles.filter(
                              (item) => item.id !== profile.id,
                            );
                            setEditor({
                              ...editor,
                              draft: {
                                ...editor.draft,
                                profiles: remaining,
                                activeProfile:
                                  editor.draft.activeProfile === profile.id
                                    ? remaining[0].id
                                    : editor.draft.activeProfile,
                              },
                              editingProfile: remaining[0].id,
                            });
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                  </div>
                      <div className="ak-manage-profiles">
                    <Button
                      type="button"
                      variant="tertiary" size="sm" className="ak-link-button"
                      onClick={() => {
                        if (editor.draft.profiles.length >= 10) {
                          toast.error("最多添加 10 个策略");
                          return;
                        }
                        const added = blankProfile(
                          `策略 ${editor.draft.profiles.length + 1}`,
                        );
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            profiles: [...editor.draft.profiles, added],
                          },
                          editingProfile: added.id,
                        });
                      }}
                    >
                      <Plus size={14} />
                      新增策略
                    </Button>                      </div>
                    </Accordion.Body></Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item id="permission-details">
                    <Accordion.Heading><Accordion.Trigger><span>匹配详情</span><small>查看渠道与模型</small><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
                    <Accordion.Panel><Accordion.Body><ScopePreview profile={profile} channels={channels} /></Accordion.Body></Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </div>
            </div>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal
          title="请保存 API Key"
          subtitle={secret.name}
          onClose={() => setSecret(null)}
        >
          <div className="ak-secret-body">
            <span className="ak-secret-icon">
              <KeyRound size={27} />
            </span>
            <p>
              此密钥可以调用网关，只显示这一次。请保存到应用配置中，关闭后无法再次查看完整值。
            </p>
            <div className="ak-secret-value">
              <code>{secret.value}</code>
              <Button
                isIconOnly variant="tertiary" size="sm" className="ak-icon-button"
                type="button"
                onClick={copySecret}
                aria-label="复制 API Key"
              >
                <Copy size={19} />
              </Button>
            </div>
          </div>
          <div className="ak-modal-foot">
            <Button
              variant="primary" className="ak-button ak-primary"
              type="button"
              onClick={() => setSecret(null)}
            >
              已保存，关闭
            </Button>
          </div>
        </Modal>
      )}
      {revoke && (
        <Modal title="撤销 API Key" onClose={() => setRevoke(null)}>
          <div className="ak-confirm-body">
            <p>
              撤销「{revoke.name}
              」后，该凭证将无法重新启用。你可以创建新的凭证来替代它。
            </p>
            <div className="ak-confirm-key">
              <KeyRound size={18} />
              <code>{revoke.preview}</code>
            </div>
          </div>
          <div className="ak-modal-foot">
            <Button
              variant="secondary" className="ak-button"
              type="button"
              onClick={() => setRevoke(null)}
            >
              取消
            </Button>
            <Button
              variant="danger" className="ak-button ak-danger"
              type="button"
              disabled={busy}
              onClick={confirmRevoke}
            >
              确认撤销
            </Button>
          </div>
        </Modal>
      )}
      {rotate && <Modal title="轮换 API Key" onClose={() => !busy && setRotate(null)}>
        <div className="ak-confirm-body"><p>轮换「{rotate.name}」后，旧密钥立即失效。权限和累计用量保持不变；请将新密钥更新到应用中。</p><div className="ak-confirm-key"><KeyRound size={18} /><code>{rotate.preview}</code></div></div>
        <div className="ak-modal-foot"><Button variant="secondary" className="ak-button" type="button" disabled={busy} onClick={() => setRotate(null)}>取消</Button><Button variant="primary" className="ak-button ak-primary" type="button" disabled={busy} onClick={confirmRotate}>{busy ? "正在轮换…" : "确认轮换"}</Button></div>
      </Modal>}
      {preview && (
        <Modal
          title={`${preview.name} · 权限预览`}
          subtitle={`当前策略：${currentProfile(preview).name}${preview.status !== "active" ? " · 凭证未启用" : ""}`}
          onClose={() => setPreviewKey(null)}
        >
          <div className="ak-standalone-preview">
            <dl className="ak-key-details">
              <div><dt>累计请求</dt><dd>{preview.used.toLocaleString()} 次</dd></div>
              <div><dt>到期时间</dt><dd>{!preview.expires || ['永不过期', 'never'].includes(preview.expires) ? "永不到期" : preview.expires}</dd></div>
              <div><dt>创建时间</dt><dd>{new Date(preview.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
              <div><dt>策略额度</dt><dd>{requestLimitLabel(currentProfile(preview).requestLimit)}</dd></div>
              {preview.note && <div className="ak-key-detail-note"><dt>备注</dt><dd>{preview.note}</dd></div>}
            </dl>
            {preview.status !== "active" && (
              <Alert status="warning" className="ak-preview-warning"><Alert.Content><Alert.Description>此凭证{preview.status === "revoked" ? "已撤销" : "已停用"}，不能发起请求。以下显示保存的策略范围。</Alert.Description></Alert.Content></Alert>
            )}
            <ScopePreview
              profile={currentProfile(preview)}
              channels={channels}
            />
          </div>
          <div className="ak-modal-foot">
            <Button
              variant="secondary" className="ak-button"
              type="button"
              onClick={() => setPreviewKey(null)}
            >
              关闭
            </Button>
            {preview.status !== "revoked" && (
              <Button
                variant="primary" className="ak-button ak-primary"
                type="button"
                onClick={() => {
                  setPreviewKey(null);
                  startEdit(preview);
                }}
              >
                编辑权限
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
