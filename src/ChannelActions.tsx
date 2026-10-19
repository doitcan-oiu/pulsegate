import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Chip, Dropdown } from "@heroui/react";
import {
  Archive,
  CircleGauge,
  Copy,
  Ellipsis,
  History,
  KeyRound,
  Network,
  Pencil,
  Play,
  Settings2,
  Shield,
  Tags,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button, Dialog, toast } from "./ui";
import type {
  ChannelConfig,
  CredentialMeta,
  GatewayChannel,
} from "../shared/types";
import { api } from "./api";
import { channelConfigPatchForPanel } from "./channel-config-patch";
import type { ChannelConfigPanel } from "./channel-config-patch";
import { PanelSection } from "./ChannelPanelUI";
import {
  ModelAliasesPanel,
  ModelPricesPanel,
  OverridesPanel,
  overridesToRows,
  serializeOverrides,
} from "./ChannelModelPanels";
import type { OverrideRow } from "./ChannelModelPanels";
import { ChannelPolicyPanel } from "./ChannelPolicyPanels";
import {
  ChannelTestPanel,
  ChannelCredentialsPanel,
  ChannelDeletePanel,
  TestHistory,
  TestResult,
} from "./ChannelOperationPanels";
import "./channel-actions.css";

export function ChannelDialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  footer,
  className,
  size,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  className?: string;
  size?: "compact" | "default" | "wide";
}) {
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      close={onClose}
      wide={wide}
      footer={footer}
      className={className}
      size={size}
    >
      {children}
    </Dialog>
  );
}

type Panel =
  | "test"
  | "history"
  | "aliases"
  | "prices"
  | "overrides"
  | "relay"
  | "rateLimit"
  | "endpoints"
  | "credentials"
  | "autoDisable"
  | "delete"
  | null;
const titles = {
  test: "渠道测试",
  history: "测试历史",
  aliases: "模型别名",
  prices: "模型价格",
  overrides: "覆盖设置",
  relay: "代理配置",
  rateLimit: "速率限制",
  endpoints: "端点配置",
  credentials: "上游密钥管理",
  autoDisable: "自动禁用与恢复",
  delete: "删除渠道",
};
const configPanels = [
  "aliases",
  "prices",
  "overrides",
  "relay",
  "rateLimit",
  "endpoints",
  "autoDisable",
];

function validateConfig(config: ChannelConfig, panel: Panel): ChannelConfig {
  const next = structuredClone(config);
  if (panel === "aliases") {
    next.aliases = next.aliases.map((alias) => ({
      from: alias.from.trim(),
      to: alias.to.trim(),
    }));
    if (next.aliases.some((alias) => !alias.from || !alias.to))
      throw new Error("请填写每条别名的请求模型和上游模型");
    if (
      new Set(next.aliases.map((alias) => alias.from)).size !==
      next.aliases.length
    )
      throw new Error("请求模型名称不能重复");
  }
  if (panel === "prices") {
    next.prices = next.prices.map((price) => ({
      ...price,
      model: price.model.trim(),
    }));
    if (
      next.prices.some(
        (price) =>
          !price.model ||
          !Number.isFinite(price.input) ||
          price.input < 0 ||
          price.input > 1e6 ||
          !Number.isFinite(price.output) ||
          price.output < 0 ||
          price.output > 1e6,
      )
    ) {
      throw new Error("请填写模型名称，输入和输出价格须在 0–1,000,000 之间");
    }
    if (
      new Set(next.prices.map((price) => price.model)).size !==
      next.prices.length
    )
      throw new Error("同一模型只能设置一条价格");
  }
  if (panel === "rateLimit") {
    if (
      !Number.isInteger(next.rateLimit.requestsPerMinute) ||
      next.rateLimit.requestsPerMinute < 0 ||
      next.rateLimit.requestsPerMinute > 1e6 ||
      !Number.isInteger(next.rateLimit.tokensPerMinute) ||
      next.rateLimit.tokensPerMinute < 0 ||
      next.rateLimit.tokensPerMinute > 1e9
    ) {
      throw new Error("请求和 token 限额须为有效的非负整数");
    }
  }
  if (panel === "endpoints") {
    for (const path of Object.values(next.endpoints)) {
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        /[?#\r\n]/.test(path)
      )
        throw new Error("端点须为以 / 开头的相对路径，不能包含查询参数或片段");
    }
  }
  if (panel === "relay" && next.relayUrl.trim()) {
    let relay: URL;
    try {
      relay = new URL(next.relayUrl.trim());
    } catch {
      throw new Error("请填写有效的 HTTPS 中继地址");
    }
    if (
      relay.protocol !== "https:" ||
      relay.username ||
      relay.password ||
      relay.search ||
      relay.hash
    ) {
      throw new Error("中继地址须为 HTTPS，不能包含登录信息、查询参数或片段");
    }
    next.relayUrl = next.relayUrl.trim();
  }
  if (panel === "autoDisable") {
    const rule = next.autoDisable;
    if (
      rule.statuses.some(
        (status) => !Number.isInteger(status) || status < 400 || status > 599,
      )
    )
      throw new Error("触发状态码须为 400–599");
    if (
      !Number.isInteger(rule.threshold) ||
      rule.threshold < 1 ||
      rule.threshold > 100
    )
      throw new Error("连续错误次数须为 1–100 的整数");
    if (
      !Number.isFinite(rule.cooldown) ||
      rule.cooldown < 1 ||
      rule.cooldown > 86400
    )
      throw new Error("恢复冷却须为 1–86400 秒");
  }
  return next;
}

export default function ChannelActions({
  channel,
  onEdit,
  onRefresh,
  onPlayground,
}: {
  channel: GatewayChannel;
  onEdit: (channel: GatewayChannel) => void;
  onRefresh: () => Promise<void>;
  onPlayground?: (channelId?: string) => void;
}) {
  const configFormId = useId();
  const credentialsFormId = useId();
  const deleteFormId = useId();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardContinuation = useRef<(() => void) | null>(null);
  const configBaseline = useRef("");
  const originalConfig = useRef(structuredClone(channel.config));
  const [config, setConfig] = useState(channel.config);
  const [headerRows, setHeaderRows] = useState<OverrideRow[]>([]);
  const [bodyRows, setBodyRows] = useState<OverrideRow[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [testModel, setTestModel] = useState(channel.model);
  const [testStream, setTestStream] = useState(true);
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [rotating, setRotating] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [pendingCredential, setPendingCredential] =
    useState<CredentialMeta | null>(null);
  const configSignature = JSON.stringify({ config, headerRows, bodyRows });
  const panelDirty = panel && configPanels.includes(panel)
    ? configSignature !== configBaseline.current
    : panel === "credentials" && Boolean(secret || label !== (credentials.find((key) => key.id === rotating)?.label ?? ""));
  useEffect(() => {
    if (!panelDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [panelDirty]);
  const close = (force = false) => {
    if (busy || operationPending.current) return;
    if (panelDirty && !force) { discardContinuation.current = null; setDiscardOpen(true); return; }
    discardContinuation.current = null;
    setDiscardOpen(false);
    setPanel(null);
    setSecret("");
    setLabel("");
    setRotating(null);
    setResult(null);
  };
  function dismissDiscard() { discardContinuation.current = null; setDiscardOpen(false); }
  function confirmDiscard() {
    const continuation = discardContinuation.current;
    if (!continuation) { close(true); return; }
    discardContinuation.current = null; setDiscardOpen(false); continuation();
  }
  function beginRotation(key: CredentialMeta) {
    const apply = () => { setRotating(key.id); setLabel(key.label); setSecret(""); };
    if (panelDirty) { discardContinuation.current = apply; setDiscardOpen(true); }
    else apply();
  }
  const path = `/api/channels/${encodeURIComponent(channel.id)}`;
  async function operation(task: () => Promise<unknown>, success?: string) {
    if (operationPending.current) throw new Error("操作正在处理中");
    operationPending.current = true;
    setBusy(true);
    try {
      const data = await task();
      try { await onRefresh(); }
      catch { toast.error("操作已完成，但列表刷新失败。请刷新页面查看最新状态。"); }
      if (success) toast.success(success);
      return data;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
      throw error;
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }
  async function loadCredentials() {
    const data = await api<
      { credentials: CredentialMeta[] } | CredentialMeta[]
    >(`${path}/credentials`);
    setCredentials(Array.isArray(data) ? data : data.credentials);
  }
  async function open(next: Panel) {
    if (busy || operationPending.current) return;
    const nextConfig = structuredClone(channel.config);
    originalConfig.current = structuredClone(nextConfig);
    const nextHeaders = overridesToRows(channel.config.headers, true);
    const nextBody = overridesToRows(channel.config.bodyOverrides);
    configBaseline.current = JSON.stringify({ config: nextConfig, headerRows: nextHeaders, bodyRows: nextBody });
    setDiscardOpen(false);
    setPanel(next);
    setResult(null);
    setConfig(nextConfig);
    setHeaderRows(nextHeaders);
    setBodyRows(nextBody);
    setDeleteConfirm("");
    setSecret("");
    setLabel("");
    setRotating(null);
    setTestModel(channel.model || channel.models[0] || "");
    setTestStream(true);
    if (next !== "credentials" && next !== "history") return;
    setBusy(true);
    try {
      if (next === "credentials") await loadCredentials();
      else setResult(await api(`${path}/tests`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }
  async function patchConfig() {
    let next: ChannelConfig;
    try {
      next = validateConfig(config, panel);
      if (panel === "overrides") {
        next.headers = serializeOverrides(headerRows, true) as Record<
          string,
          string
        >;
        next.bodyOverrides = serializeOverrides(bodyRows);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "请检查配置");
      return;
    }
    if (!panel || !configPanels.includes(panel)) return;
    const patch = channelConfigPatchForPanel(next, originalConfig.current, panel as ChannelConfigPanel);
    if (Object.keys(patch).length === 0) { close(true); return; }
    await operation(
      () =>
        api(path, { method: "PATCH", body: JSON.stringify({ config: patch }) }),
      "渠道配置已保存",
    )
      .then(() => close(true))
      .catch(() => undefined);
  }
  function runTest(recover = false) {
    void operation(() =>
      api(`${path}/${recover ? "recover" : "test"}`, {
        method: "POST",
        ...(recover
          ? {}
          : { body: JSON.stringify({ model: testModel, stream: testStream }) }),
      }),
    )
      .then((data) => {
        setResult(data);
        if (
          data &&
          typeof data === "object" &&
          "success" in data &&
          data.success === false
        ) {
          toast.error(
            recover ? "恢复探测失败，请查看结果" : "渠道测试失败，请查看结果",
          );
        } else
          toast.success(
            recover ? "恢复探测完成，健康状态已更新" : "渠道测试成功",
          );
      })
      .catch(() => undefined);
  }
  const menuItems: {
    panel?: Panel;
    label: string;
    icon: typeof Play;
    action?: () => void;
    danger?: boolean;
  }[] = [
    { panel: "test", label: "测试", icon: Play },
    { panel: "history", label: "测试历史", icon: History },
    {
      label: "复制",
      icon: Copy,
      action: () => {
        void operation(
          () => api(`${path}/clone`, { method: "POST" }),
          "已复制为停用渠道，请添加上游密钥",
        ).catch(() => undefined);
      },
    },
    { panel: "aliases", label: "模型别名", icon: Tags },
    { panel: "prices", label: "模型价格", icon: Wallet },
    { panel: "overrides", label: "覆盖设置", icon: Settings2 },
    { panel: "relay", label: "代理配置", icon: Network },
    { panel: "rateLimit", label: "速率限制", icon: CircleGauge },
    { panel: "endpoints", label: "端点配置", icon: Network },
    { panel: "credentials", label: "密钥管理", icon: KeyRound },
    { panel: "autoDisable", label: "自动禁用与恢复", icon: Shield },
    {
      label: channel.archived ? "恢复渠道" : "归档",
      icon: Archive,
      action: () => {
        void operation(
          () =>
            api(path, {
              method: "PATCH",
              body: JSON.stringify({
                archived: !channel.archived,
                ...(!channel.archived ? { enabled: false } : {}),
              }),
            }),
          channel.archived ? "渠道已恢复，需手动启用" : "渠道已归档",
        ).catch(() => undefined);
      },
    },
    { panel: "delete", label: "删除", icon: Trash2, danger: true },
  ];
  const hasConfig = !!panel && configPanels.includes(panel);
  return (
    <div className="cx-actions">
      <Button
        variant="ghost"
        isIconOnly
        aria-label={`编辑 ${channel.name}`}
        title="编辑"
        disabled={busy}
        onClick={() => onEdit(channel)}
      >
        <Pencil size={15} />
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        title="进入测试场"
        disabled={busy}
        aria-label={`测试 ${channel.name}`}
        onClick={() =>
          onPlayground ? onPlayground(channel.id) : void open("test")
        }
      >
        <Play size={15} />
      </Button>
      <Dropdown>
        <Button
          variant="ghost"
          isIconOnly
          aria-label={`${channel.name} 更多操作`}
          title="更多操作"
          disabled={busy}
        >
          <Ellipsis size={18} />
        </Button>
        <Dropdown.Popover placement="bottom end" className="cx-menu">
          <Dropdown.Menu
            aria-label={`${channel.name} 渠道操作`}
            onAction={(key) => {
              const item = menuItems.find((item) => item.label === key);
              if (item?.panel) void open(item.panel);
              else item?.action?.();
            }}
          >
            {menuItems.map((item) => (
              <Dropdown.Item
                key={item.label}
                id={item.label}
                textValue={item.label}
                variant={item.danger ? "danger" : "default"}
              >
                <item.icon size={15} />
                {item.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {pendingCredential && (
        <Dialog
          title="删除上游密钥"
          subtitle={channel.name}
          size="compact"
          close={() => !busy && setPendingCredential(null)}
          className="cp-dialog"
          footer={
            <div className="cp-discard-actions">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setPendingCredential(null)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    void operation(async () => {
                      await api(
                        `${path}/credentials/${encodeURIComponent(pendingCredential.id)}`,
                        { method: "DELETE" },
                      );
                      setCredentials((old) => old.filter((key) => key.id !== pendingCredential.id));
                      if (rotating === pendingCredential.id) { setRotating(null); setLabel(""); setSecret(""); }
                    }, "上游密钥已删除")
                      .then(() => setPendingCredential(null))
                      .catch(() => undefined);
                  }}
                >
                  {busy ? "删除中…" : "删除密钥"}
                </Button>
            </div>
          }
        >
            <div className="cx-credential-confirm">
              <div>
                <strong>{pendingCredential.label}</strong>
                <code>{pendingCredential.preview}</code>
              </div>
              <p>此密钥将被永久删除，后续请求使用其他可用密钥。</p>
            </div>
        </Dialog>
      )}
      {panel && (
        <ChannelDialog
          title={titles[panel]}
          subtitle={`${channel.name} · ${channel.provider}`}
          onClose={close}
          wide={!["delete", "test", "relay", "rateLimit", "autoDisable"].includes(panel)}
          className="cp-dialog"
          footer={
            hasConfig ? (
              <div className="cp-dialog-footer">
                <span>{panelDirty ? "有未保存的更改" : "仅应用于当前渠道"}</span>
                <div>
                  <Button variant="secondary" disabled={busy} onClick={() => close()}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    type="submit"
                    form={configFormId}
                  >
                    {busy ? "保存中…" : "保存配置"}
                  </Button>
                </div>
              </div>
            ) : panel === "delete" ? (
              <div className="cp-discard-actions">
                <Button variant="secondary" disabled={busy} onClick={() => close()}>取消</Button>
                <Button variant="danger" type="submit" form={deleteFormId} disabled={busy || deleteConfirm !== channel.name}>
                  {busy ? "删除中…" : "删除渠道"}
                </Button>
              </div>
            ) : panel === "test" ? (
              <div className="cp-discard-actions">
                {onPlayground && <Button variant="secondary" disabled={busy} onClick={() => { close(); onPlayground(channel.id); }}>打开测试场</Button>}
                <Button variant="primary" disabled={busy || !testModel} onClick={() => runTest()}><Play size={15} />{busy ? "测试中…" : "发送测试请求"}</Button>
              </div>
            ) : panel === "credentials" ? (
              <div className="cp-discard-actions">
                <Button variant="secondary" disabled={busy} onClick={() => {
                  if (rotating) { setRotating(null); setSecret(""); setLabel(""); }
                  else close();
                }}>{rotating ? "取消轮换" : "关闭"}</Button>
                <Button variant="primary" type="submit" form={credentialsFormId} disabled={busy || !label.trim() || !secret.trim()}>
                  {busy ? "保存中…" : rotating ? "确认轮换" : "添加密钥"}
                </Button>
              </div>
            ) : undefined
          }
        >
          {hasConfig && (
            <form
              id={configFormId}
              className="cp-config-form"
              onSubmit={(event) => {
                event.preventDefault();
                void patchConfig();
              }}
            >
              {panel === "aliases" && (
                <ModelAliasesPanel
                  config={config}
                  setConfig={setConfig}
                  models={channel.models}
                />
              )}
              {panel === "prices" && (
                <ModelPricesPanel
                  config={config}
                  setConfig={setConfig}
                  models={channel.models}
                />
              )}
              {panel === "overrides" && (
                <OverridesPanel
                  headerRows={headerRows}
                  setHeaderRows={setHeaderRows}
                  bodyRows={bodyRows}
                  setBodyRows={setBodyRows}
                />
              )}
              {(panel === "relay" ||
                panel === "rateLimit" ||
                panel === "endpoints" ||
                panel === "autoDisable") && (
                <ChannelPolicyPanel
                  panel={panel}
                  config={config}
                  setConfig={setConfig}
                  channel={channel}
                />
              )}
              {panel === "autoDisable" && (
                <PanelSection
                  title="健康状态与恢复探测"
                  icon={Shield}
                  description="探测通过并达到全局健康策略要求后，渠道才恢复参与路由。"
                >
                  <div className="cp-recovery-status">
                    <Chip
                      size="sm"
                      color={
                        channel.health.autoDisabled
                          ? "danger"
                          : channel.status === "healthy"
                            ? "success"
                            : "warning"
                      }
                    >
                      {channel.health.autoDisabled
                        ? "已自动禁用"
                        : channel.status === "healthy"
                          ? "健康"
                          : channel.status === "degraded"
                            ? "延迟异常"
                            : "不可用"}
                    </Chip>
                    <span>{channel.health.reason || "暂无异常记录"}</span>
                  </div>
                  <div>
                    <Button disabled={busy} onClick={() => runTest(true)}>
                      <Play size={14} />
                      {busy ? "探测中…" : "执行恢复探测"}
                    </Button>
                  </div>
                  {result != null && <TestResult result={result} />}
                </PanelSection>
              )}
            </form>
          )}
          {panel === "credentials" && (
            <ChannelCredentialsPanel
              formId={credentialsFormId}
              credentials={credentials}
              busy={busy}
              label={label}
              onLabelChange={setLabel}
              secret={secret}
              onSecretChange={setSecret}
              rotating={rotating}
              onRotate={beginRotation}
              onToggle={(key) => {
                void operation(async () => {
                  const result = await api<{ credential: CredentialMeta }>(
                    `${path}/credentials/${encodeURIComponent(key.id)}`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({ enabled: !key.enabled }),
                    },
                  );
                  setCredentials((old) => old.map((item) => item.id === result.credential.id ? result.credential : item));
                }, "密钥状态已更新").catch(() => undefined);
              }}
              onDelete={setPendingCredential}
              onSubmit={() => {
                if (!label.trim() || !secret.trim()) {
                  toast.error("请填写密钥名称和上游 API Key");
                  return;
                }
                void operation(
                  async () => {
                    const result = await api<{ credential: CredentialMeta }>(
                      rotating
                        ? `${path}/credentials/${encodeURIComponent(rotating)}`
                        : `${path}/credentials`,
                      {
                        method: rotating ? "PATCH" : "POST",
                        body: JSON.stringify({
                          label: label.trim(),
                          secret: secret.trim(),
                        }),
                      },
                    );
                    setSecret("");
                    setLabel("");
                    setRotating(null);
                    setCredentials((old) => rotating ? old.map((item) => item.id === result.credential.id ? result.credential : item) : [...old, result.credential]);
                  },
                  rotating ? "上游密钥已轮换" : "上游密钥已添加",
                ).catch(() => undefined);
              }}
            />
          )}
          {panel === "test" && (
            <ChannelTestPanel
              channel={channel}
              model={testModel}
              onModelChange={setTestModel}
              stream={testStream}
              onStreamChange={setTestStream}
              busy={busy}
              result={result}
            />
          )}
          {panel === "history" && <TestHistory result={result} busy={busy} />}
          {panel === "delete" && (
            <ChannelDeletePanel
              formId={deleteFormId}
              channel={channel}
              confirmation={deleteConfirm}
              onConfirmationChange={setDeleteConfirm}
              busy={busy}
              onDelete={() => {
                if (deleteConfirm !== channel.name) return;
                void operation(
                  () => api(path, { method: "DELETE" }),
                  "渠道已删除",
                )
                  .then(() => close(true))
                  .catch(() => undefined);
              }}
            />
          )}
        </ChannelDialog>
      )}
      {discardOpen && <Dialog title="放弃未保存的更改？" size="compact" close={dismissDiscard} className="cp-dialog" footer={<div className="cp-discard-actions"><Button variant="secondary" onClick={dismissDiscard}>继续编辑</Button><Button variant="danger" onClick={confirmDiscard}>{discardContinuation.current ? "放弃并切换" : "放弃并关闭"}</Button></div>}><p className="cx-hint">本次更改将丢失。</p></Dialog>}
    </div>
  );
}
