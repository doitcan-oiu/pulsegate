import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Accordion, Card, Chip, Link } from "@heroui/react";
import {
  Check,
  CircleDollarSign,
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
import { changedChannelConfig } from "./channel-config-patch";
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
type BalanceBackend = "newapi" | "sub2api";
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
};
type AccountDraft = {
  username: string;
  password: string;
  accountAuth: "password" | "token" | "cookie";
  accessToken: string;
  accountUserId: string;
  cookie: string;
};
const emptyAccountDraft = (): AccountDraft => ({
  username: "",
  password: "",
  accountAuth: "password",
  accessToken: "",
  accountUserId: "",
  cookie: "",
});
type Props = {
  channel?: GatewayChannel;
  tags: string[];
  devMode: boolean;
  close: () => void;
  onSaved: () => Promise<void>;
  modelSuggestions?: Partial<Record<NativeService, string[]>>;
};

const services: {
  id: NativeService;
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
    endpoint: "https://api.openai.com",
    description: "OpenAI 模型列表与测试",
  },
  {
    id: "anthropic",
    protocol: "anthropic",
    name: "Anthropic",
    format: "Anthropic (Messages)",
    endpoint: "https://api.anthropic.com",
    description: "Anthropic 模型列表与测试",
  },
  {
    id: "gemini",
    protocol: "gemini",
    name: "Gemini",
    format: "Gemini (Contents)",
    endpoint: "https://generativelanguage.googleapis.com",
    description: "Gemini 模型列表与测试",
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
  const initialBalanceBackend =
    channel?.config.integration === "newapi" ||
    channel?.config.integration === "sub2api"
      ? channel.config.integration
      : undefined;
  const savedBalanceBackend = channel?.accountIntegration ?? initialBalanceBackend;
  const [balanceEnabled, setBalanceEnabled] = useState(
    Boolean(initialBalanceBackend) && channel?.config.protocol !== "mock",
  );
  const [balanceBackend, setBalanceBackend] = useState<BalanceBackend>(
    initialBalanceBackend ?? savedBalanceBackend ?? "newapi",
  );
  const [accountDrafts, setAccountDrafts] = useState<
    Record<BalanceBackend, AccountDraft>
  >(() => ({
    newapi: {
      ...emptyAccountDraft(),
      accountAuth:
        savedBalanceBackend === "newapi" && channel?.accountAuthMode === "token"
          ? "token"
          : "password",
    },
    sub2api: {
      ...emptyAccountDraft(),
      accountAuth:
        savedBalanceBackend === "sub2api" && channel?.accountAuthMode === "cookie"
          ? "cookie"
          : "password",
    },
  }));
  const { username, password, accountAuth, accessToken, accountUserId, cookie } =
    accountDrafts[balanceBackend];
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
  const savePending = useRef(false);
  const configBaseline = useRef(structuredClone(channel?.config ?? defaultChannelConfig));
  const [discardOpen, setDiscardOpen] = useState(false);
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
  const drafts = useRef<Partial<Record<NativeService, ProviderDraft>>>({});
  const simulated = protocol === "mock";
  const service = services.find((item) => item.protocol === protocol);
  const requiresAccount = balanceEnabled && !simulated;
  const balanceBackendName = balanceBackend === "newapi" ? "NewAPI" : "Sub2API";
  const useAccountToken = balanceBackend === "newapi" && accountAuth === "token";
  const useAccountCookie = balanceBackend === "sub2api" && accountAuth === "cookie";
  const hasSavedAccount = Boolean(
    channel?.hasAccountCredentials &&
      savedBalanceBackend === balanceBackend &&
      (channel.accountAuthMode ?? "password") ===
        (useAccountToken ? "token" : useAccountCookie ? "cookie" : "password"),
  );
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
  const draftSignature = JSON.stringify({ name, provider, protocol, endpoint, models, defaultModel, selectedTags, priority, weight, enabled, secrets, connection, relayUrl, slug, balanceEnabled, balanceBackend, accountDrafts, modelInput, batchInput, tagInput });
  const initialDraftSignature = useRef(draftSignature);
  const hasChanges = draftSignature !== initialDraftSignature.current;

  useEffect(() => {
    if (!hasChanges) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasChanges]);

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
  }, [endpoint, protocol, connection, relayUrl, slug, secrets]);

  function closeEditor(force = false) {
    if (busy || savePending.current) return;
    if (hasChanges && !force) { setDiscardOpen(true); return; }
    setDiscardOpen(false);
    discoveryRequest.current.sequence += 1;
    discoveryRequest.current.controller?.abort();
    close();
  }

  function connectionConfig() {
    return changedChannelConfig({
      protocol,
      integration: simulated
        ? (channel?.config.integration ?? "native")
        : requiresAccount
          ? balanceBackend
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
    }, configBaseline.current);
  }

  function updateAccount(patch: Partial<AccountDraft>) {
    setAccountDrafts((previous) => ({
      ...previous,
      [balanceBackend]: { ...previous[balanceBackend], ...patch },
    }));
  }

  function chooseService(next: NativeService) {
    if (simulated || busy || next === protocol) return;
    const selected = services.find((item) => item.id === next)!;
    discoveryRequest.current.sequence += 1;
    discoveryRequest.current.controller?.abort();
    if (channel) {
      setProtocol(selected.protocol);
      return;
    }
    drafts.current[protocol as NativeService] = {
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
    };
    const draft = drafts.current[next];
    setProtocol(selected.protocol);
    // New channels keep connection/model/API key drafts per request protocol.
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
    if (busy || savePending.current) return;
    setAttempted(true);
    if (!name.trim() || !provider.trim()) {
      toast.error("请填写渠道名称和服务商显示名称");
      return;
    }
    if (modelInput.trim() || (batchOpen && batchInput.trim()) || tagInput.trim()) {
      toast.error("还有未添加的模型或标签，请先点击添加，或清空对应输入");
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
      if (useAccountCookie) {
        const hasEnteredAccount = Boolean(cookie.trim() || accessToken.trim());
        if (!hasSavedAccount && !hasEnteredAccount) {
          toast.error("请填写 Sub2API 浏览器 Cookie 或后台登录 Token，至少一个");
          return;
        }
        if (cookie.trim().length > 16000 || /[\x00-\x1f\x7f]/.test(cookie)) {
          toast.error("Cookie 不超过 16,000 个字符，请粘贴单行请求头内容");
          return;
        }
        const rawToken = accessToken.trim();
        const token = rawToken.replace(/^Bearer(?:\s+|$)/i, "");
        if (
          (rawToken && !token) ||
          rawToken.length > 4096 ||
          /\s/.test(token) ||
          /[\x00-\x1f\x7f]/.test(accessToken)
        ) {
          toast.error("请填写有效的后台登录 Token，不超过 4,096 个字符，不能包含空格（可带 Bearer 前缀）");
          return;
        }
      } else if (useAccountToken) {
        const hasEnteredAccount = Boolean(
          accessToken.trim() || accountUserId.trim(),
        );
        if ((!hasSavedAccount || hasEnteredAccount) && !accessToken.trim()) {
          toast.error("请填写 NewAPI 后台访问令牌");
          return;
        }
        if (accessToken.trim().length > 4096 || /\s/.test(accessToken.trim())) {
          toast.error("后台访问令牌不超过 4,096 个字符，不能包含空格");
          return;
        }
        const userId = accountUserId.trim();
        if (
          userId &&
          (!/^\d+$/.test(userId) ||
            !Number.isSafeInteger(Number(userId)) ||
            Number(userId) <= 0)
        ) {
          toast.error("用户 ID 须为正整数");
          return;
        }
      } else {
        const hasEnteredAccount = Boolean(username.trim() || password);
        if (
          (!hasSavedAccount || hasEnteredAccount) &&
          (!username.trim() || !password)
        ) {
          toast.error(`请填写完整的 ${balanceBackendName} 账号和密码`);
          return;
        }
        if (username.trim().length > 256 || password.length > 4096) {
          toast.error("账号不超过 256 个字符，密码不超过 4,096 个字符");
          return;
        }
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
    const accountCredentials = useAccountCookie
      ? cookie.trim() || accessToken.trim()
        ? {
            cookie: cookie.trim(),
            ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
          }
        : undefined
      : useAccountToken
        ? accessToken.trim()
          ? {
              accessToken: accessToken.trim(),
              ...(accountUserId.trim() ? { userId: accountUserId.trim() } : {}),
            }
          : undefined
        : username.trim() && password
          ? { username: username.trim(), password }
          : undefined;
    savePending.current = true;
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
          ...(requiresAccount && accountCredentials
            ? { accountCredentials }
            : {}),
        }),
      });
      setSecrets("");
      setAccountDrafts({
        newapi: emptyAccountDraft(),
        sub2api: emptyAccountDraft(),
      });
      toast.success(channel ? "渠道已保存" : "渠道已创建");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "渠道保存失败");
    } finally {
      savePending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog
      title={channel ? "编辑渠道" : "添加渠道"}
      subtitle={
        channel ? "管理上游连接、模型和调度设置" : "连接一个新的 AI 模型服务商"
      }
      close={() => closeEditor()}
      wide
      className="ce-dialog"
      footer={
        <div className="ce-footer">
          <span>
            <ShieldCheck size={15} />
            {hasChanges ? "有未保存的更改" : "上游密钥加密保存"}
          </span>
          <div>
            <Button type="button" onClick={() => closeEditor()} disabled={busy}>
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
        <aside className="ce-services" aria-label="选择上游接口类型">
          <div className="ce-services-heading">
            <h3>接口类型</h3>
          </div>
          <div className="ce-service-list">
            {services.map((item) => (
              <Button
                type="button"
                key={item.id}
                variant="ghost"
                className="ce-service"
                aria-label={`选择 ${item.name} 接口类型`}
                aria-pressed={protocol === item.protocol && !simulated}
                disabled={simulated || busy}
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
              <p>保留模拟协议与故障场景，无法启用上游余额监控。</p>
            </Card>
          ) : (
            <Card className="ce-service-note">
              <Info size={18} />
              <strong>模型发现与渠道测试</strong>
              <p>
                {channel
                  ? "切换接口类型保留连接、模型与密钥。公开请求保持客户端格式，余额监控独立配置。"
                  : "每种接口类型保留连接与模型草稿。公开请求保持客户端格式，余额监控独立配置。"}
              </p>
            </Card>
          )}
        </aside>

        <div className="ce-config">
          <Section
            title="基本信息与连接"
            description="定义渠道名称，填写上游服务地址和认证信息"
            icon={<Globe size={16} />}
            action={
              <div className="ce-format">
                <span>上游接口类型</span>
                <strong>{format}</strong>
                <small>用于模型发现与渠道测试</small>
              </div>
            }
          >
            {simulated && (
              <Notice>
                此渠道使用本地故障模拟，不发送真实上游请求；接口类型
                保持原配置。
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
                    service?.endpoint || "https://your-gateway.example.com"
                  }
                />
                <small>
                  {simulated
                    ? "路径在「端点配置」中调整。"
                    : `Base URL 可只填域名；模型获取与渠道测试默认补 ${protocol === "gemini" ? "/v1beta" : "/v1"}，已有版本或自定义路径会保留。`}
                </small>
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
              <Notice>暂无上游密钥，此渠道暂时无法接收真实请求。可先关闭「启用渠道」，稍后在密钥管理中补充。</Notice>
            )}
          </Section>

          <Section
            title="上游余额监控"
            description="独立选择后台类型和凭据，用于自动刷新账户余额"
            icon={<CircleDollarSign size={16} />}
            action={
              <Switch
                aria-label="启用上游余额监控"
                checked={requiresAccount}
                disabled={simulated || busy}
                onChange={(event) => setBalanceEnabled(event.target.checked)}
              />
            }
          >
            {!requiresAccount && (
              <p className="ce-balance-hint">
                {simulated
                  ? "本地模拟渠道不读取上游账户余额。"
                  : "开启后可选择 NewAPI 或 Sub2API；关闭后停止余额刷新，已保存的后台凭据仍保留。"}
              </p>
            )}
            {requiresAccount && (
              <div className="ce-account">
                <label className="ce-field">
                  <span>后台类型</span>
                  <Select
                    aria-label="余额监控后台类型"
                    value={balanceBackend}
                    disabled={busy}
                    onChange={(event) =>
                      setBalanceBackend(event.target.value as BalanceBackend)
                    }
                  >
                    <option value="newapi">NewAPI</option>
                    <option value="sub2api">Sub2API</option>
                  </Select>
                </label>
                <div className="ce-account-heading">
                  <KeyRound size={16} />
                  <strong>{balanceBackendName} 账户</strong>
                  {hasSavedAccount && (
                    <Chip size="sm">已保存</Chip>
                  )}
                </div>
                <label className="ce-field">
                  <span>余额刷新认证</span>
                  <Select
                    aria-label={`${balanceBackendName} 余额刷新认证方式`}
                    value={accountAuth}
                    onChange={(event) =>
                      updateAccount({
                        accountAuth: event.target.value as AccountDraft["accountAuth"],
                      })
                    }
                  >
                    <option value="password">账号密码</option>
                    {balanceBackend === "newapi" ? (
                      <option value="token">后台访问令牌</option>
                    ) : (
                      <option value="cookie">Cookie / 浏览器会话</option>
                    )}
                  </Select>
                </label>
                <div className="ce-fields">
                  {useAccountCookie ? (
                    <>
                      <label className="ce-field ce-full">
                        <span>
                          浏览器 Cookie（可选）
                        </span>
                        <Input
                          aria-label="Sub2API 浏览器 Cookie"
                          type="password"
                          maxLength={16000}
                          autoComplete="new-password"
                          value={cookie}
                          onChange={(event) =>
                            updateAccount({ cookie: event.target.value })
                          }
                          placeholder={hasSavedAccount ? "全部留空保留会话；Cookie 与 Token 至少一个" : "name=value; name=value；也可只填后台登录 Token"}
                        />
                        <small>
                          在浏览器登录 Sub2API 并完成人机验证，在开发者工具「网络」中找到个人信息或余额请求，复制请求头 Cookie 的值。
                        </small>
                      </label>
                      <label className="ce-field ce-full">
                        <span>后台登录 Token（可选）</span>
                        <Input
                          aria-label="Sub2API 后台登录 Token"
                          type="password"
                          maxLength={4096}
                          autoComplete="new-password"
                          value={accessToken}
                          onChange={(event) =>
                            updateAccount({ accessToken: event.target.value })
                          }
                          placeholder={hasSavedAccount ? "全部留空保留会话；填写新值替换已保存会话" : "登录后的 JWT，可带 Bearer 前缀"}
                        />
                        <small>
                          标准 Sub2API 可只填登录后的 Bearer Token，从个人信息请求的 Authorization 或本地存储中的 auth_token 复制。若请求还需要人机验证 Cookie，请同时填写；使用 Cookie 登录的定制站点可不填 Token。
                        </small>
                      </label>
                    </>
                  ) : useAccountToken ? (
                    <>
                      <label className="ce-field ce-full">
                        <span>
                          后台访问令牌<em>{hasSavedAccount ? "" : " *"}</em>
                        </span>
                        <Input
                          aria-label="NewAPI 后台访问令牌"
                          type="password"
                          maxLength={4096}
                          autoComplete="new-password"
                          value={accessToken}
                          onChange={(event) =>
                            updateAccount({ accessToken: event.target.value })
                          }
                          placeholder={hasSavedAccount ? "留空保留已保存令牌" : "填写后台个人访问令牌"}
                        />
                        <small>
                          在 NewAPI 后台「个人设置 → 安全设置」中生成访问令牌，用于读取账户余额。
                        </small>
                      </label>
                      <label className="ce-field ce-full">
                        <span>用户 ID（旧版站点必填）</span>
                        <Input
                          aria-label="NewAPI 后台用户 ID"
                          inputMode="numeric"
                          maxLength={20}
                          autoComplete="off"
                          value={accountUserId}
                          onChange={(event) =>
                            updateAccount({ accountUserId: event.target.value })
                          }
                          placeholder={hasSavedAccount ? "留空保留；修改时请同时填写令牌" : "个人资料中的数字用户 ID；新版可留空"}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="ce-field">
                        <span>
                          {balanceBackend === "sub2api" ? "邮箱 / 账号" : "账号"}
                          <em>{hasSavedAccount ? "" : " *"}</em>
                        </span>
                        <Input
                          aria-label={`${balanceBackendName} 账号`}
                          maxLength={256}
                          autoComplete="off"
                          value={username}
                          onChange={(event) =>
                            updateAccount({ username: event.target.value })
                          }
                          placeholder={
                            hasSavedAccount
                              ? "留空保留已保存账号"
                              : balanceBackend === "sub2api"
                                ? "name@example.com"
                                : "用户名"
                          }
                        />
                      </label>
                      <label className="ce-field">
                        <span>
                          密码<em>{hasSavedAccount ? "" : " *"}</em>
                        </span>
                        <Input
                          aria-label={`${balanceBackendName} 密码`}
                          type="password"
                          maxLength={4096}
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) =>
                            updateAccount({ password: event.target.value })
                          }
                          placeholder={hasSavedAccount ? "留空保留已保存密码" : "输入账户密码"}
                        />
                      </label>
                    </>
                  )}
                </div>
                <small>
                  用于自动刷新后台余额；推理与模型获取使用 API Key。
                  {hasSavedAccount
                    ? useAccountCookie
                      ? "全部留空保留已保存会话。"
                      : "留空保留原凭据，修改时请完整填写。"
                    : "后台凭据加密保存，不回显。"}
                  {channel?.hasAccountCredentials && !hasSavedAccount &&
                    "切换后台类型或认证方式后，须填写对应的完整凭据。"}
                  {balanceBackend === "newapi" &&
                    !useAccountToken &&
                    "开启人机验证的站点请使用后台访问令牌。"}
                  {balanceBackend === "sub2api" &&
                    !useAccountCookie &&
                    "开启人机验证的站点可切换到 Cookie / 浏览器会话。"}
                  {useAccountCookie &&
                    "Cookie 与后台登录 Token 至少填写一个；填写新会话会替换已保存 Cookie 和 Token，请提供所需的完整会话。会话过期或失效后，请重新登录并更新。"}
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
                      placeholder="https://relay.example.com"
                    />
                    <small>
                      中继需支持客户端实际调用的入口和请求格式，并接收渠道认证头。
                      模型获取与渠道测试使用 {format}，只填域名时默认补
                      {protocol === "gemini" ? " /v1beta" : " /v1"}。
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
    {discardOpen && <Dialog title="放弃渠道更改？" subtitle="当前修改尚未保存，关闭后需要重新填写。" close={() => setDiscardOpen(false)} className="ce-discard-dialog" footer={<div className="ce-discard-actions"><Button variant="secondary" onClick={() => setDiscardOpen(false)}>继续编辑</Button><Button variant="danger" onClick={() => closeEditor(true)}>放弃并关闭</Button></div>}><p className="ce-discard-description">渠道连接、模型和凭据草稿将一并清除。</p></Dialog>}
    </>
  );
}
