import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Accordion, Card, Chip, Link } from "@heroui/react";
import {
  Check,
  Download,
  Globe,
  Info,
  KeyRound,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Tags,
  X,
} from "lucide-react";
import { api } from "./api";
import ProviderIcon from "./ProviderIcon";
import {
  Button,
  Checkbox,
  Dialog,
  Input,
  Select,
  Switch,
  TextArea,
  toast,
} from "./ui";
import { defaultChannelConfig } from "../shared/types";
import type { GatewayChannel, ProviderProtocol } from "../shared/types";
import "./channel-editor.css";

type NativeService = Exclude<ProviderProtocol, "mock">;
type Service = NativeService | "newapi" | "sub2api";
type Connection = "direct" | "relay" | "ai-gateway";
type ProviderDraft = {
  connection: Connection;
  relayUrl: string;
  slug: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  secrets: string;
  modelInput: string;
  batchInput: string;
  batchOpen: boolean;
  username: string;
  password: string;
};
type Props = {
  channel?: GatewayChannel;
  tags: string[];
  devMode: boolean;
  close: () => void;
  onSaved: () => Promise<void>;
  modelSuggestions?: Partial<Record<NativeService, string[]>>;
};

const services: {
  id: Service;
  protocol: NativeService;
  name: string;
  format: string;
  endpoint: string;
  description: string;
}[] = [
  {
    id: "openai",
    protocol: "openai",
    name: "OpenAI",
    format: "OpenAI (Chat Completions)",
    endpoint: "https://api.openai.com/v1",
    description: "兼容 OpenAI 协议",
  },
  {
    id: "anthropic",
    protocol: "anthropic",
    name: "Anthropic",
    format: "Anthropic (Messages)",
    endpoint: "https://api.anthropic.com/v1",
    description: "Claude 原生接口",
  },
  {
    id: "gemini",
    protocol: "gemini",
    name: "Gemini",
    format: "Gemini (Contents)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    description: "Gemini 原生接口",
  },
  {
    id: "newapi",
    protocol: "openai",
    name: "NewAPI",
    format: "OpenAI (Chat Completions)",
    endpoint: "",
    description: "NewAPI 聚合服务",
  },
  {
    id: "sub2api",
    protocol: "openai",
    name: "Sub2API",
    format: "OpenAI (Chat Completions)",
    endpoint: "",
    description: "Sub2API 聚合服务",
  },
];

const splitValues = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

const modelDocs: Record<NativeService, string> = {
  openai: "https://developers.openai.com/api/docs/models",
  anthropic: "https://platform.claude.com/docs/en/about-claude/models/overview",
  gemini: "https://ai.google.dev/gemini-api/docs/models",
};

function Section({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ce-section">
      <div className="ce-section-heading">
        <div className="ce-section-title">
          {icon}
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="ce-notice">
      <Info size={15} />
      <p>{children}</p>
    </div>
  );
}

function FoldedSection({
  id,
  title,
  summary,
  icon,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Accordion.Item id={id}>
      <Accordion.Heading>
        <Accordion.Trigger className="ce-advanced-trigger">
          {icon}
          <span className="ce-advanced-title">{title}</span>
          <span className="ce-advanced-summary">{summary}</span>
          <Accordion.Indicator />
        </Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel>
        <Accordion.Body className="ce-advanced-body">{children}</Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export default function ChannelEditor({
  channel,
  tags,
  devMode,
  close,
  onSaved,
  modelSuggestions = {},
}: Props) {
  const formId = useId();
  const [name, setName] = useState(channel?.name ?? "");
  const [provider, setProvider] = useState(channel?.provider ?? "OpenAI");
  const [protocol, setProtocol] = useState<ProviderProtocol>(
    channel?.config.protocol ?? "openai",
  );
  const [serviceId, setServiceId] = useState<Service>(
    channel?.config.integration === "newapi" ||
      channel?.config.integration === "sub2api"
      ? channel.config.integration
      : channel?.config.protocol === "anthropic" ||
          channel?.config.protocol === "gemini"
        ? channel.config.protocol
        : "openai",
  );
  const [endpoint, setEndpoint] = useState(
    channel?.endpoint ?? services[0].endpoint,
  );
  const [models, setModels] = useState<string[]>([
    ...new Set([
      ...(channel?.models ?? []),
      ...(channel?.model ? [channel.model] : []),
    ]),
  ]);
  const [defaultModel, setDefaultModel] = useState(channel?.model ?? "");
  const [modelInput, setModelInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState(channel?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [priority, setPriority] = useState(channel?.priority ?? 0);
  const [weight, setWeight] = useState(channel?.weight ?? 1);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [secrets, setSecrets] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const initialConnection: Connection =
    channel?.config.gatewayMode === "ai-gateway"
      ? "ai-gateway"
      : channel?.config.relayUrl
        ? "relay"
        : "direct";
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [relayUrl, setRelayUrl] = useState(channel?.config.relayUrl ?? "");
  const [slug, setSlug] = useState(channel?.config.customProviderSlug ?? "");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[] | null>(
    null,
  );
  const [discoveredEndpoint, setDiscoveredEndpoint] = useState("");
  const [discoveredTruncated, setDiscoveredTruncated] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [selectedDiscovered, setSelectedDiscovered] = useState<string[]>([]);
  const discoveryRequest = useRef<{
    sequence: number;
    controller: AbortController | null;
  }>({ sequence: 0, controller: null });
  const drafts = useRef<Partial<Record<Service, ProviderDraft>>>({});
  const simulated = protocol === "mock";
  const service = services.find((item) => item.id === serviceId);
  const requiresAccount = serviceId === "newapi" || serviceId === "sub2api";
  const availableTags = [...new Set([...tags, ...selectedTags])].sort();
  const enteredKeys = [
    ...new Set(
      secrets
        .split(/\r?\n/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  const credentialCount = channel?.credentialCount ?? 0;
  const format = simulated
    ? "本地故障模拟"
    : (service?.format ?? "OpenAI (Chat Completions)");
  const suggestions = simulated ? [] : (modelSuggestions[protocol] ?? []);
  const filteredDiscovered = (discoveredModels ?? []).filter((model) =>
    model.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  );
  const selectableDiscovered = filteredDiscovered.filter(
    (model) => !models.includes(model),
  );
  const selectedAvailable = selectedDiscovered.filter(
    (model) => !models.includes(model),
  );
  const allFilteredSelected =
    selectableDiscovered.length > 0 &&
    selectableDiscovered.every((model) => selectedDiscovered.includes(model));

  useEffect(() => {
    const request = discoveryRequest.current;
    request.sequence += 1;
    request.controller?.abort();
    request.controller = null;
    setDiscovering(false);
    setDiscoveredModels(null);
    setDiscoveredEndpoint("");
    setDiscoveryError("");
    setSelectedDiscovered([]);
    setModelSearch("");
    return () => {
      request.sequence += 1;
      request.controller?.abort();
    };
  }, [endpoint, protocol, serviceId, connection, relayUrl, slug, secrets]);

  function closeEditor() {
    if (busy) return;
    discoveryRequest.current.sequence += 1;
    discoveryRequest.current.controller?.abort();
    close();
  }

  function connectionConfig() {
    return {
      ...(channel?.config ?? defaultChannelConfig),
      protocol,
      integration: requiresAccount
        ? (serviceId as "newapi" | "sub2api")
        : ("native" as const),
      gatewayMode: simulated
        ? (channel?.config.gatewayMode ?? "direct")
        : connection === "ai-gateway"
          ? ("ai-gateway" as const)
          : ("direct" as const),
      relayUrl: simulated
        ? (channel?.config.relayUrl ?? "")
        : connection === "relay"
          ? relayUrl.trim()
          : connection === initialConnection
            ? (channel?.config.relayUrl ?? "")
            : "",
      customProviderSlug:
        connection === "ai-gateway"
          ? slug.trim()
          : (channel?.config.customProviderSlug ?? ""),
    };
  }

  function chooseService(next: Service) {
    if (channel || simulated || busy || next === serviceId) return;
    const selected = services.find((item) => item.id === next)!;
    discoveryRequest.current.sequence += 1;
    discoveryRequest.current.controller?.abort();
    drafts.current[serviceId] = {
      connection,
      relayUrl,
      slug,
      endpoint,
      models,
      defaultModel,
      secrets,
      modelInput,
      batchInput,
      batchOpen,
      username,
      password,
    };
    const draft = drafts.current[next];
    setServiceId(next);
    setProtocol(selected.protocol);
    // Each provider keeps its own model, endpoint and credential draft.
    setEndpoint(draft?.endpoint ?? selected.endpoint);
    setConnection(draft?.connection ?? "direct");
    setRelayUrl(draft?.relayUrl ?? "");
    setSlug(draft?.slug ?? "");
    setModels(draft?.models ?? []);
    setDefaultModel(draft?.defaultModel ?? "");
    setSecrets(draft?.secrets ?? "");
    setModelInput(draft?.modelInput ?? "");
    setBatchInput(draft?.batchInput ?? "");
    setBatchOpen(draft?.batchOpen ?? false);
    setUsername(draft?.username ?? "");
    setPassword(draft?.password ?? "");
    if (
      services.some((item) => item.name === provider) ||
      provider === "Google Gemini"
    ) {
      setProvider(selected.name);
    }
  }

  function addModels(values: string[], source?: "single" | "batch") {
    const next = [...new Set([...models, ...values])];
    if (!values.length) return;
    if (next.length > 1000 || next.some((item) => item.length > 256)) {
      toast.error("最多支持 1,000 个模型，每个模型 ID 不超过 256 个字符");
      return;
    }
    setModels(next);
    if (!defaultModel) setDefaultModel(next[0] ?? "");
    if (source === "single") setModelInput("");
    if (source === "batch") {
      setBatchInput("");
      setBatchOpen(false);
    }
  }

  function removeModel(model: string) {
    const next = models.filter((item) => item !== model);
    setModels(next);
    if (defaultModel === model) setDefaultModel(next[0] ?? "");
  }

  async function discoverModels() {
    if (discovering || busy || simulated) return;
    if (!validEndpoint(endpoint.trim(), "Base URL")) return;
    if (
      connection === "relay" &&
      !validEndpoint(relayUrl.trim(), "中继 Base URL")
    )
      return;
    if (
      connection === "ai-gateway" &&
      !/^[a-zA-Z0-9_-]{1,128}$/.test(slug.trim())
    ) {
      toast.error("请先填写有效的自定义服务商 slug");
      return;
    }
    const request = discoveryRequest.current;
    request.controller?.abort();
    const controller = new AbortController();
    const sequence = ++request.sequence;
    request.controller = controller;
    setDiscovering(true);
    setDiscoveryError("");
    setDiscoveredModels(null);
    setSelectedDiscovered([]);
    try {
      const result = await api<{ models: string[]; endpoint: string; truncated?: boolean }>(
        "/api/channels/discover-models",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            ...(channel ? { channelId: channel.id } : {}),
            endpoint: endpoint.trim(),
            protocol,
            config: connectionConfig(),
            ...(enteredKeys[0] ? { apiKey: enteredKeys[0] } : {}),
          }),
        },
      );
      if (sequence !== request.sequence || controller.signal.aborted) return;
      if (
        !result ||
        !Array.isArray(result.models) ||
        result.models.some(
          (model) => typeof model !== "string" || model.length > 256,
        )
      ) {
        throw new Error("上游返回了无效的模型列表");
      }
      const fetched = [
        ...new Set(result.models.map((model) => model.trim()).filter(Boolean)),
      ];
      if (fetched.length > 1000)
        throw new Error("上游模型数量超过 1,000 个，请使用手动批量添加");
      setDiscoveredModels(fetched);
      setDiscoveredEndpoint(result.endpoint);
      setDiscoveredTruncated(Boolean(result.truncated));
      setSelectedDiscovered([]);
      setModelSearch("");
    } catch (error) {
      if (sequence !== request.sequence || controller.signal.aborted) return;
      setDiscoveryError(
        error instanceof Error ? error.message : "模型获取失败",
      );
      setDiscoveredModels(null);
    } finally {
      if (sequence === request.sequence) {
        request.controller = null;
        setDiscovering(false);
      }
    }
  }

  function cancelDiscovery() {
    discoveryRequest.current.sequence += 1;
    discoveryRequest.current.controller?.abort();
    discoveryRequest.current.controller = null;
    setDiscovering(false);
  }

  function toggleDiscovered(model: string) {
    setSelectedDiscovered((previous) =>
      previous.includes(model)
        ? previous.filter((item) => item !== model)
        : [...previous, model],
    );
  }

  function toggleFilteredModels() {
    setSelectedDiscovered((previous) =>
      allFilteredSelected
        ? previous.filter((model) => !selectableDiscovered.includes(model))
        : [...new Set([...previous, ...selectableDiscovered])],
    );
  }

  function addTags() {
    const next = [...new Set([...selectedTags, ...splitValues(tagInput)])];
    if (next.length > 100 || next.some((item) => item.length > 256)) {
      toast.error("最多选择 100 个标签，每个标签不超过 256 个字符");
      return;
    }
    setSelectedTags(next);
    setTagInput("");
  }

  function toggleTag(tag: string) {
    if (selectedTags.includes(tag)) {
      setSelectedTags((previous) => previous.filter((item) => item !== tag));
    } else if (selectedTags.length < 100) {
      setSelectedTags((previous) => [...previous, tag]);
    } else {
      toast.error("最多选择 100 个标签");
    }
  }

  function validEndpoint(value: string, label: string) {
    try {
      const parsed = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(
        parsed.hostname,
      );
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        toast.error(`${label}不能包含用户名、密码、查询参数或片段`);
        return false;
      }
      if (
        parsed.protocol !== "https:" &&
        !(devMode && local && parsed.protocol === "http:")
      ) {
        toast.error(`${label}需要使用 HTTPS，本地开发可使用回环 HTTP 地址`);
        return false;
      }
      if (!devMode && local) {
        toast.error(`${label}不能使用本地回环地址`);
        return false;
      }
      return true;
    } catch {
      toast.error(`请填写有效的${label}`);
      return false;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (!name.trim() || !provider.trim()) {
      toast.error("请填写渠道名称和服务商显示名称");
      return;
    }
    if (!models.length) {
      toast.error("请至少添加一个支持的模型");
      return;
    }
    if (!defaultModel || !models.includes(defaultModel)) {
      toast.error("请选择支持的模型作为默认测试模型");
      return;
    }
    if (!validEndpoint(endpoint.trim(), "Base URL")) return;
    if (
      !simulated &&
      connection === "relay" &&
      !validEndpoint(relayUrl.trim(), "中继 Base URL")
    )
      return;
    if (
      !simulated &&
      connection === "ai-gateway" &&
      (!slug.trim() || !/^[a-zA-Z0-9_-]{1,128}$/.test(slug.trim()))
    ) {
      toast.error(
        "请填写有效的自定义服务商 slug，仅支持字母、数字、下划线与连字符",
      );
      return;
    }
    if (
      enteredKeys.length > 100 ||
      enteredKeys.some((key) => key.length > 16000)
    ) {
      toast.error("每次最多提交 100 个密钥，每个密钥不超过 16,000 个字符");
      return;
    }
    if (requiresAccount) {
      const hasEnteredAccount = Boolean(username.trim() || password);
      if (
        (!channel?.hasAccountCredentials || hasEnteredAccount) &&
        (!username.trim() || !password)
      ) {
        toast.error(`请填写完整的 ${service?.name} 账号和密码`);
        return;
      }
      if (username.trim().length > 256 || password.length > 4096) {
        toast.error("账号不超过 256 个字符，密码不超过 4,096 个字符");
        return;
      }
    }
    if (
      !Number.isInteger(priority) ||
      priority < -10000 ||
      priority > 10000 ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 10000
    ) {
      toast.error("优先级需要为 -10,000 至 10,000 的整数，权重为 0 至 10,000");
      return;
    }
    setBusy(true);
    try {
      await api(channel ? `/api/channels/${channel.id}` : "/api/channels", {
        method: channel ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          provider: provider.trim(),
          endpoint: endpoint.trim(),
          models: [
            defaultModel,
            ...models.filter((model) => model !== defaultModel),
          ],
          model: defaultModel,
          tags: selectedTags,
          priority,
          weight,
          enabled,
          config: connectionConfig(),
          ...(enteredKeys.length ? { apiKeys: enteredKeys } : {}),
          ...(requiresAccount && username.trim() && password
            ? { accountCredentials: { username: username.trim(), password } }
            : {}),
        }),
      });
      setSecrets("");
      setPassword("");
      toast.success(channel ? "渠道已保存" : "渠道已创建");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "渠道保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={channel ? "编辑渠道" : "添加渠道"}
      subtitle={
        channel ? "管理上游连接、模型和调度设置" : "连接一个新的 AI 模型服务商"
      }
      close={closeEditor}
      wide
      className="ce-dialog"
      footer={
        <div className="ce-footer">
          <span>
            <ShieldCheck size={15} />
            上游密钥加密保存
          </span>
          <div>
            <Button type="button" onClick={closeEditor} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              disabled={busy}
            >
              {busy && <LoaderCircle size={15} className="ce-spinning" />}
              {busy ? "保存中…" : channel ? "保存更改" : "创建渠道"}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="ce-layout" noValidate>
        <aside className="ce-services" aria-label="选择服务商">
          <div className="ce-services-heading">
            <h3>服务商</h3>
          </div>
          <div className="ce-service-list">
            {services.map((item) => (
              <Button
                type="button"
                key={item.id}
                variant="ghost"
                className="ce-service"
                aria-label={`选择 ${item.name} 服务商`}
                aria-pressed={serviceId === item.id && !simulated}
                disabled={
                  simulated ||
                  busy ||
                  (Boolean(channel) && serviceId !== item.id)
                }
                onClick={() => chooseService(item.id)}
              >
                <ProviderIcon
                  provider={item.id}
                  size={18}
                  className="ce-service-mark"
                />
                <span className="ce-service-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="ce-service-radio" aria-hidden="true" />
              </Button>
            ))}
          </div>
          {simulated ? (
            <Card className="ce-service-note">
              <Server size={18} />
              <strong>本地模拟渠道</strong>
              <p>保留模拟协议与故障场景。添加真实渠道时可选择左侧服务商。</p>
            </Card>
          ) : (
            <Card className="ce-service-note">
              <Info size={18} />
              <strong>{channel ? "保留现有服务商" : "兼容接口也可接入"}</strong>
              <p>
                {channel
                  ? "已有渠道的协议保持固定。接入其他服务商时，请创建新渠道并配置对应密钥。"
                  : "兼容接口可填写自定义 Base URL。切换服务商会保留配置草稿。"}
              </p>
            </Card>
          )}
        </aside>

        <div className="ce-config">
          <Section
            title="连接服务"
            description="填写连接地址和认证信息"
            icon={<Globe size={16} />}
            action={<span className="ce-format">{format}</span>}
          >
            {simulated && (
              <Notice>
                此渠道使用本地故障模拟，不发送真实上游请求；服务商和 API
                格式保持原配置。
              </Notice>
            )}
            <div className="ce-fields">
              <label className="ce-field ce-full">
                <span>
                  渠道名称 <em>*</em>
                </span>
                <Input
                  aria-label="渠道名称"
                  required
                  maxLength={128}
                  placeholder="例如：生产主渠道"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="ce-field ce-full">
                <span>
                  Base URL <em>*</em>
                </span>
                <Input
                  aria-label="Base URL"
                  required
                  type="url"
                  maxLength={2048}
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={
                    service?.endpoint || "https://your-gateway.example.com/v1"
                  }
                />
                <small>包含 /v1 或 /v1beta；路径在「端点配置」中调整。</small>
              </label>
            </div>
            <label className="ce-field">
              <span className="ce-field-caption">
                <span>{channel ? "追加 API Key" : "API Key"}</span>
                <small>{credentialCount + enteredKeys.length} 个密钥</small>
              </span>
              <TextArea
                aria-label={channel ? "追加 API Key" : "上游 API Key"}
                rows={2}
                autoComplete="off"
                spellCheck={false}
                value={secrets}
                onChange={(event) => setSecrets(event.target.value)}
                placeholder={
                  protocol === "gemini"
                    ? "AIza…\n每行一个密钥"
                    : "sk-…\n每行一个密钥"
                }
              />
              <small>
                {channel
                  ? `已有 ${credentialCount} 个密钥；原文不回填，可在「密钥管理」中轮换。`
                  : "每行一个密钥，自动轮换使用；加密保存，不回显。"}
              </small>
            </label>
            {!simulated && credentialCount + enteredKeys.length === 0 && (
              <Notice>暂无密钥。可先关闭「启用渠道」，稍后补充。</Notice>
            )}
            {requiresAccount && (
              <div className="ce-account">
                <div className="ce-account-heading">
                  <KeyRound size={16} />
                  <strong>{service?.name} 账户</strong>
                  {channel?.hasAccountCredentials && (
                    <Chip size="sm">已保存</Chip>
                  )}
                </div>
                <div className="ce-fields">
                  <label className="ce-field">
                    <span>
                      {serviceId === "sub2api" ? "邮箱 / 账号" : "账号"}
                      <em>{channel?.hasAccountCredentials ? "" : " *"}</em>
                    </span>
                    <Input
                      aria-label={`${service?.name} 账号`}
                      maxLength={256}
                      autoComplete="off"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={
                        channel?.hasAccountCredentials
                          ? "留空保留已保存账号"
                          : serviceId === "sub2api"
                            ? "name@example.com"
                            : "用户名"
                      }
                    />
                  </label>
                  <label className="ce-field">
                    <span>
                      密码<em>{channel?.hasAccountCredentials ? "" : " *"}</em>
                    </span>
                    <Input
                      aria-label={`${service?.name} 密码`}
                      type="password"
                      maxLength={4096}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        channel?.hasAccountCredentials
                          ? "留空保留已保存密码"
                          : "输入账户密码"
                      }
                    />
                  </label>
                </div>
                <small>
                  用于自动刷新后台余额；推理与模型获取使用 API Key。
                  {channel?.hasAccountCredentials
                    ? "留空保留原凭据，修改时请完整填写。"
                    : "账号与密码加密保存，不回显。"}
                </small>
              </div>
            )}
          </Section>

          <Section
            title="支持的模型"
            description={
              simulated
                ? "添加用于本地模拟的模型 ID"
                : "从上游获取列表，选中需要开放的模型"
            }
            icon={<Layers3 size={16} />}
            action={
              <div className="ce-model-actions">
                <span>{models.length} 个已添加</span>
                {!simulated && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy || discovering}
                    onClick={discoverModels}
                  >
                    {discovering ? (
                      <LoaderCircle size={15} className="ce-spinning" />
                    ) : (
                      <Download size={15} />
                    )}
                    {discovering ? "获取中…" : "获取模型"}
                  </Button>
                )}
              </div>
            }
          >
            {discovering && (
              <div className="ce-discovery-status">
                <span>正在请求上游模型接口…</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelDiscovery}
                >
                  取消获取
                </Button>
              </div>
            )}
            {discoveryError && (
              <div className="ce-discovery-error" role="alert">
                <Info size={16} />
                <div>
                  <strong>模型获取失败</strong>
                  <p>{discoveryError}</p>
                </div>
              </div>
            )}
            {discoveredModels !== null && (
              <div className="ce-discovery">
                <div className="ce-discovery-heading">
                  <strong>上游模型</strong>
                  <span>{discoveredModels.length} 个</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="收起获取的模型"
                    onClick={() => setDiscoveredModels(null)}
                  >
                    <X size={15} />
                  </Button>
                </div>
                {discoveredTruncated && <small className="ce-limit-warning">模型列表较大，已加载前 1,000 个结果。</small>}
                {discoveredModels.length > 0 ? (
                  <>
                    <div className="ce-model-search">
                      <Search size={15} />
                      <Input
                        aria-label="搜索获取的模型"
                        placeholder="搜索模型 ID"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                      />
                    </div>
                    <div className="ce-discovery-selection">
                      <Checkbox
                        aria-label={
                          modelSearch ? "全选搜索结果" : "全选获取的模型"
                        }
                        checked={allFilteredSelected}
                        disabled={!selectableDiscovered.length}
                        onChange={toggleFilteredModels}
                      >
                        {modelSearch ? "全选搜索结果" : "全选"}
                      </Checkbox>
                      <span>已选 {selectedAvailable.length} 个</span>
                    </div>
                    <div
                      className="ce-discovery-list"
                      aria-label="获取的模型列表"
                    >
                      {filteredDiscovered.length ? (
                        filteredDiscovered.map((model) => (
                          <div className="ce-discovery-model" key={model}>
                            <Checkbox
                              checked={
                                models.includes(model) ||
                                selectedDiscovered.includes(model)
                              }
                              disabled={models.includes(model)}
                              aria-label={`选择模型 ${model}`}
                              onChange={() => toggleDiscovered(model)}
                            >
                              <span title={model}>{model}</span>
                            </Checkbox>
                            {models.includes(model) && (
                              <span className="ce-already-added">已添加</span>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="ce-discovery-empty">没有匹配的模型</p>
                      )}
                    </div>
                    <div className="ce-discovery-footer">
                      <small title={discoveredEndpoint}>
                        {discoveredEndpoint}
                      </small>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={
                          !selectedAvailable.length ||
                          models.length + selectedAvailable.length > 1000
                        }
                        onClick={() => {
                          addModels(selectedAvailable);
                          setSelectedDiscovered([]);
                        }}
                      >
                        加入所选{" "}
                        {selectedAvailable.length > 0
                          ? `(${selectedAvailable.length})`
                          : ""}
                      </Button>
                    </div>
                    {models.length + selectedAvailable.length > 1000 && (
                      <small className="ce-limit-warning">
                        已添加与所选模型合计超过 1,000 个，请减少选择。
                      </small>
                    )}
                  </>
                ) : (
                  <p className="ce-discovery-empty">
                    上游返回的模型列表为空。可手动添加模型，或检查接口配置。
                  </p>
                )}
              </div>
            )}
            <div className="ce-add-row">
              <Input
                aria-label="模型 ID"
                maxLength={256}
                placeholder="输入模型 ID"
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addModels(splitValues(modelInput), "single");
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!modelInput.trim()}
                onClick={() => addModels(splitValues(modelInput), "single")}
              >
                <Plus size={14} />
                添加
              </Button>
              <Button
                type="button"
                onClick={() => setBatchOpen((previous) => !previous)}
                aria-expanded={batchOpen}
              >
                批量添加
              </Button>
            </div>
            {batchOpen && (
              <Card className="ce-batch">
                <label className="ce-field">
                  <span>批量模型 ID</span>
                  <TextArea
                    aria-label="批量模型 ID"
                    rows={4}
                    value={batchInput}
                    onChange={(event) => setBatchInput(event.target.value)}
                    placeholder="每行一个模型，也支持逗号分隔"
                  />
                </label>
                <div>
                  <span>{splitValues(batchInput).length} 个模型待添加</span>
                  <Button type="button" onClick={() => setBatchOpen(false)}>
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!batchInput.trim()}
                    onClick={() => addModels(splitValues(batchInput), "batch")}
                  >
                    确认添加
                  </Button>
                </div>
              </Card>
            )}
            {models.length ? (
              <div className="ce-chips" aria-label="已添加模型">
                {models.map((model) => (
                  <Chip key={model} size="sm" className="ce-model-chip">
                    <span title={model}>{model}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      isIconOnly
                      className="ce-chip-remove"
                      aria-label={`移除模型 ${model}`}
                      onClick={() => removeModel(model)}
                    >
                      <X size={12} />
                    </Button>
                  </Chip>
                ))}
              </div>
            ) : (
              <div className={`ce-empty ${attempted ? "ce-invalid" : ""}`}>
                <Layers3 size={20} />
                <p>至少添加一个模型后即可创建渠道</p>
              </div>
            )}
            {suggestions.length > 0 && !discoveredModels?.length && (
              <div className="ce-suggestions">
                <div className="ce-suggestions-heading">
                  <span>示例模型</span>
                  {!simulated && (
                    <Link
                      href={modelDocs[protocol]}
                      target="_blank"
                      rel="noreferrer"
                      className="ce-model-docs"
                    >
                      模型文档
                    </Link>
                  )}
                </div>
                <div>
                  {suggestions.map((model) => (
                    <Button
                      key={model}
                      type="button"
                      variant="secondary"
                      disabled={models.includes(model)}
                      onClick={() => addModels([model])}
                    >
                      <Plus size={12} />
                      {model}
                    </Button>
                  ))}
                </div>
                <small>
                  模型示例，可填写上游自定义 ID；请以该上游实际支持的模型为准。
                </small>
              </div>
            )}
            <label className="ce-field">
              <span>
                默认测试模型 <em>*</em>
              </span>
              <Select
                aria-label="默认测试模型"
                value={defaultModel}
                disabled={!models.length}
                onChange={(event) => setDefaultModel(event.target.value)}
              >
                <option value="">选择用于测试连接的模型</option>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
              <small>
                用于渠道测试与健康探测。客户端请求仍按传入的模型路由。
              </small>
            </label>
          </Section>

          <div className="ce-advanced-heading">
            <h3>其他设置</h3>
            <p>标签、连接方式与调度参数，可按需调整</p>
          </div>
          <Accordion
            className="ce-advanced"
            allowsMultipleExpanded
            defaultExpandedKeys={
              initialConnection !== "direct" ? ["connection"] : []
            }
          >
            <FoldedSection
              id="tags"
              title="标签与访问范围"
              summary={
                selectedTags.length
                  ? `${selectedTags.length} 个标签`
                  : "未设置标签"
              }
              icon={<Tags size={16} />}
            >
              {availableTags.length > 0 && (
                <div className="ce-tags" aria-label="可选标签">
                  {availableTags.map((tag) => (
                    <Button
                      type="button"
                      key={tag}
                      variant={
                        selectedTags.includes(tag) ? "primary" : "secondary"
                      }
                      aria-pressed={selectedTags.includes(tag)}
                      aria-label={`渠道标签 ${tag}`}
                      onClick={() => toggleTag(tag)}
                    >
                      {selectedTags.includes(tag) && <Check size={12} />}
                      {tag}
                    </Button>
                  ))}
                </div>
              )}
              <div className="ce-add-row">
                <Input
                  aria-label="新标签"
                  maxLength={256}
                  placeholder="输入标签名，或用逗号批量创建"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTags();
                    }
                  }}
                />
                <Button
                  type="button"
                  disabled={!tagInput.trim()}
                  onClick={addTags}
                >
                  <Plus size={14} />
                  添加标签
                </Button>
              </div>
              <small className="ce-hint">
                标签区分大小写，保存渠道时同步创建；最多选择 100 个。
              </small>
            </FoldedSection>

            <FoldedSection
              id="routing"
              title="调度设置"
              summary={`优先级 ${priority} · 权重 ${weight} · ${enabled ? "已启用" : "已停用"}`}
              icon={<Settings2 size={16} />}
            >
              <div className="ce-fields">
                <label className="ce-field">
                  <span>优先级</span>
                  <Input
                    aria-label="优先级"
                    required
                    type="number"
                    min={-10000}
                    max={10000}
                    step={1}
                    value={priority}
                    onChange={(event) =>
                      setPriority(Number(event.target.value))
                    }
                  />
                  <small>数值越小越优先，故障时按策略回退。</small>
                </label>
                <label className="ce-field">
                  <span>权重</span>
                  <Input
                    aria-label="权重"
                    required
                    type="number"
                    min={0}
                    max={10000}
                    step="any"
                    value={weight}
                    onChange={(event) => setWeight(Number(event.target.value))}
                  />
                  <small>
                    用于加权策略；0 作为最低权重处理，仍可能参与分配。
                  </small>
                </label>
              </div>
              <Card className="ce-enable">
                <div>
                  <strong>启用渠道</strong>
                  <p>
                    {channel?.archived
                      ? "此渠道已归档，需先恢复后才会参与请求路由。"
                      : "启用后，符合 API Key 范围的请求可使用此渠道。"}
                  </p>
                </div>
                <Switch
                  aria-label="启用渠道"
                  checked={enabled}
                  disabled={channel?.archived}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
              </Card>
            </FoldedSection>
            <FoldedSection
              id="connection"
              title="连接与显示"
              summary={
                connection === "direct"
                  ? "直连上游"
                  : connection === "relay"
                    ? "HTTPS API 中继"
                    : "Cloudflare AI Gateway"
              }
              icon={<Server size={16} />}
            >
              <div className="ce-fields">
                <label className="ce-field">
                  <span>服务商显示名称</span>
                  <Input
                    aria-label="服务商显示名称"
                    required
                    maxLength={128}
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                  />
                </label>
                <label className="ce-field">
                  <span>连接方式</span>
                  <Select
                    aria-label="连接方式"
                    value={connection}
                    disabled={simulated}
                    onChange={(event) =>
                      setConnection(event.target.value as Connection)
                    }
                  >
                    <option value="direct">直连上游</option>
                    <option value="relay">HTTPS API 中继</option>
                    <option value="ai-gateway">Cloudflare AI Gateway</option>
                  </Select>
                </label>
                {!simulated && connection === "relay" && (
                  <label className="ce-field ce-full">
                    <span>
                      中继 Base URL <em>*</em>
                    </span>
                    <Input
                      aria-label="中继 Base URL"
                      required
                      type="url"
                      maxLength={2048}
                      value={relayUrl}
                      onChange={(event) => setRelayUrl(event.target.value)}
                      placeholder="https://relay.example.com/v1"
                    />
                    <small>
                      中继需提供 {format} 兼容接口，并接收该渠道的认证头。
                    </small>
                  </label>
                )}
                {!simulated && connection === "ai-gateway" && (
                  <label className="ce-field ce-full">
                    <span>
                      自定义服务商 slug <em>*</em>
                    </span>
                    <Input
                      aria-label="自定义服务商 slug"
                      required
                      maxLength={128}
                      value={slug}
                      onChange={(event) => setSlug(event.target.value)}
                      placeholder="my-provider"
                    />
                    <small>
                      Account ID、Gateway ID 与网关认证令牌在全局设置中配置。
                    </small>
                  </label>
                )}
              </div>
            </FoldedSection>
          </Accordion>
        </div>
      </form>
    </Dialog>
  );
}
