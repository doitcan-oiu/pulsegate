import { useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Card, Chip } from "@heroui/react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CircleGauge,
  Clock3,
  Globe,
  Info,
  KeyRound,
  Link,
  ListFilter,
  Network,
  Plus,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChannelConfig, GatewayChannel } from "../shared/types";
import { defaultChannelConfig } from "../shared/types";
import { Button, Input } from "./ui";
import { PanelNumber, PanelSection, PanelToggle } from "./ChannelPanelUI";
import "./channel-policy-panels.css";

export type ChannelPolicyPanelName =
  "relay" | "conversions" | "rateLimit" | "endpoints" | "autoDisable";

type Props = {
  panel: ChannelPolicyPanelName;
  config: ChannelConfig;
  setConfig: Dispatch<SetStateAction<ChannelConfig>>;
  channel: GatewayChannel;
};

type EndpointKey = keyof ChannelConfig["endpoints"];
const protocolName: Record<ChannelConfig["protocol"], string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini",
  mock: "本地模拟",
};
const endpointGroups: {
  protocol: "openai" | "anthropic" | "gemini";
  title: string;
  description: string;
  items: {
    key: EndpointKey;
    title: string;
    method: string;
    description: string;
  }[];
}[] = [
  {
    protocol: "openai",
    title: "OpenAI 兼容协议",
    description: "使用 Chat Completions 接口发送对话请求。",
    items: [
      {
        key: "chat",
        title: "聊天补全",
        method: "POST",
        description: "流式与非流式请求共用这个路径。",
      },
      {
        key: "models",
        title: "模型列表",
        method: "GET",
        description: "添加或编辑渠道时，快速获取模型使用此上游列表路径。",
      },
    ],
  },
  {
    protocol: "anthropic",
    title: "Anthropic 原生协议",
    description: "网关将 OpenAI 格式的对话转换为 Messages 请求。",
    items: [
      {
        key: "messages",
        title: "消息生成",
        method: "POST",
        description: "用于 Anthropic 原生 Messages API。",
      },
    ],
  },
  {
    protocol: "gemini",
    title: "Gemini 原生协议",
    description: "{model} 自动替换为上游模型名。",
    items: [
      {
        key: "generate",
        title: "内容生成",
        method: "POST",
        description:
          "流式请求自动切换为 streamGenerateContent 并添加 alt=sse。",
      },
    ],
  },
];
const statusOptions = [
  { code: 400, label: "请求错误" },
  { code: 401, label: "认证失败" },
  { code: 403, label: "访问被拒绝" },
  { code: 404, label: "资源不存在" },
  { code: 408, label: "请求超时" },
  { code: 429, label: "请求过多" },
  { code: 500, label: "服务器错误" },
  { code: 502, label: "网关错误" },
  { code: 503, label: "服务不可用" },
  { code: 504, label: "网关超时" },
];

function activeEndpoint(config: ChannelConfig): EndpointKey {
  return config.protocol === "anthropic"
    ? "messages"
    : config.protocol === "gemini"
      ? "generate"
      : "chat";
}

function resolvedPath(
  config: ChannelConfig,
  channel: GatewayChannel,
  key: EndpointKey,
) {
  const model =
    config.aliases.find((alias) => alias.from === channel.model)?.to ??
    channel.model;
  return config.endpoints[key].replace(
    "{model}",
    encodeURIComponent(model || "model-name"),
  );
}

function joinAddress(baseText: string, path: string) {
  try {
    const base = new URL(baseText);
    if (
      base.username ||
      base.password ||
      !["http:", "https:"].includes(base.protocol)
    )
      return "请输入有效的 API 地址";
    const prefix = base.pathname.replace(/\/$/, "");
    const suffix =
      prefix && path.startsWith(`${prefix}/`)
        ? path
        : `${prefix}/${path.replace(/^\//, "")}`;
    return `${base.origin}${suffix}`;
  } catch {
    return "请输入有效的 API 地址";
  }
}

function addressPreview(
  config: ChannelConfig,
  channel: GatewayChannel,
  key: EndpointKey,
) {
  const path = resolvedPath(config, channel, key);
  if (config.gatewayMode === "ai-gateway") {
    let upstreamPath = path;
    try {
      upstreamPath = new URL(joinAddress(channel.endpoint, path)).pathname;
    } catch {
      /* Show the configured path until the address is valid. */
    }
    const slug =
      config.customProviderSlug.replace(/^custom-/, "") || "<服务商 slug>";
    return `https://gateway.ai.cloudflare.com/v1/<Account>/<Gateway>/custom-${slug}${upstreamPath}`;
  }
  return joinAddress(config.relayUrl || channel.endpoint, path);
}

function ChoiceCard({
  title,
  description,
  icon: Icon,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="cpp-choice"
      variant={selected ? "primary" : "secondary"}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={20} />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {selected && <Check size={16} className="cpp-choice-check" />}
    </Button>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="cpp-notice">
      <Info size={16} />
      <p>{children}</p>
    </div>
  );
}

function RelayPanel({ config, setConfig, channel }: Omit<Props, "panel">) {
  const [relayMode, setRelayMode] = useState(Boolean(config.relayUrl));
  const [draftUrl, setDraftUrl] = useState(config.relayUrl);
  const aiGateway = config.gatewayMode === "ai-gateway";
  const simulated = config.protocol === "mock";
  const activeKey = activeEndpoint(config);
  return (
    <div className="cpp-root">
      <PanelSection
        title="连接方式"
        icon={Network}
        description="选择网关连接这个渠道的方式。"
      >
        <div className="cpp-two-columns">
          <ChoiceCard
            title="直连上游"
            description="使用渠道的 Base URL"
            icon={Globe}
            selected={!relayMode}
            disabled={aiGateway || simulated}
            onClick={() => {
              setRelayMode(false);
              setConfig((old) => ({ ...old, relayUrl: "" }));
            }}
          />
          <ChoiceCard
            title="HTTPS API 中继"
            description="使用兼容上游协议的中继服务"
            icon={Network}
            selected={relayMode}
            disabled={aiGateway || simulated}
            onClick={() => {
              setRelayMode(true);
              setConfig((old) => ({ ...old, relayUrl: draftUrl }));
            }}
          />
        </div>
        {aiGateway ? (
          <Notice>
            当前使用 Cloudflare AI Gateway，实际请求经全局 Account / Gateway
            和此渠道的自定义服务商路由。这里的 HTTPS
            中继配置会保留，但在此模式下不生效。
          </Notice>
        ) : simulated ? (
          <Notice>
            当前渠道使用本地模拟协议，不发送真实上游请求。切换为真实上游协议后连接方式才会生效。
          </Notice>
        ) : relayMode ? (
          <label className="cpp-field">
            <span>中继 API Base URL</span>
            <Input
              aria-label="HTTPS 中继 URL"
              type="url"
              required
              value={draftUrl}
              placeholder="https://relay.example.com/v1"
              onChange={(event) => {
                setDraftUrl(event.target.value);
                setConfig((old) => ({ ...old, relayUrl: event.target.value }));
              }}
            />
            <small>
              中继需提供 {protocolName[config.protocol]}{" "}
              兼容接口，并接收渠道的上游认证头。仅支持 HTTPS API 中继。
            </small>
          </label>
        ) : (
          <div className="cpp-address">
            <span>上游 Base URL</span>
            <code>{channel.endpoint}</code>
          </div>
        )}
      </PanelSection>
      <PanelSection
        title="请求路径预览"
        icon={Link}
        description={
          aiGateway
            ? "Account 与 Gateway 使用全局设置中的实际值。"
            : "根据当前连接方式和协议端点生成，保存后生效。"
        }
      >
        <div className="cpp-route">
          <Card className="cpp-route-node">
            <Server size={19} />
            <strong>PulseGate</strong>
            <small>智能网关</small>
          </Card>
          <ArrowRight size={18} className="cpp-route-arrow" />
          <Card className="cpp-route-node">
            <Network size={19} />
            <strong>
              {aiGateway
                ? "AI Gateway"
                : simulated
                  ? "本地模拟"
                  : relayMode
                    ? "HTTPS 中继"
                    : "上游 API"}
            </strong>
            <small>
              {aiGateway
                ? "Cloudflare 自定义服务商"
                : protocolName[config.protocol]}
            </small>
          </Card>
        </div>
        <div className="cpp-preview">
          <Chip size="sm">POST</Chip>
          <code>
            {simulated
              ? "本地模拟响应，不访问外部 API"
              : relayMode && !draftUrl && !aiGateway
                ? "填写中继地址后显示完整请求路径"
                : addressPreview(config, channel, activeKey)}
          </code>
        </div>
      </PanelSection>
    </div>
  );
}

function ConversionsPanel({ config, setConfig }: Omit<Props, "panel">) {
  const nativeProtocol =
    config.protocol === "anthropic" || config.protocol === "gemini";
  return (
    <div className="cpp-root">
      <PanelSection
        title="可选参数兼容"
        icon={ListFilter}
        description="用于 Anthropic / Gemini 原生协议的参数转换。"
        action={
          <Chip size="sm">
            {nativeProtocol
              ? protocolName[config.protocol]
              : "当前协议不应用此规则"}
          </Chip>
        }
      >
        <PanelToggle
          title="移除不支持的可选参数"
          description="开启后忽略原生适配器未支持的额外参数；关闭时会返回参数不支持错误。"
          checked={config.conversions.stripUnsupported}
          onChange={(checked) =>
            setConfig((old) => ({
              ...old,
              conversions: { ...old.conversions, stripUnsupported: checked },
            }))
          }
        />
        <div className="cpp-example">
          <div>
            <small>客户端请求</small>
            <code>{'{ "temperature": 0.7, "presence_penalty": 0.2 }'}</code>
          </div>
          <ArrowRight size={18} />
          <div>
            <small>
              {!nativeProtocol
                ? "当前协议：保持原样"
                : config.conversions.stripUnsupported
                  ? "原生转换：忽略额外参数"
                  : "原生转换：拒绝额外参数"}
            </small>
            <code>
              {!nativeProtocol
                ? '{ "temperature": 0.7, "presence_penalty": 0.2 }'
                : config.conversions.stripUnsupported
                  ? '{ "temperature": 0.7 }'
                  : "400 · 不支持 presence_penalty"}
            </code>
          </div>
        </div>
        <Notice>
          temperature、top_p、token 上限和 function
          工具等已支持参数会正常转换；OpenAI
          兼容与本地模拟协议保持其参数处理方式。
        </Notice>
      </PanelSection>
      <PanelSection
        title="消息角色兼容"
        icon={ArrowLeftRight}
        description="适用于不接受系统角色消息的上游。"
      >
        <PanelToggle
          title="将系统消息转换为用户消息"
          description="system 和 developer 角色在发送给上游前替换为 user，消息内容保持一致。"
          checked={config.conversions.systemToUser}
          onChange={(checked) =>
            setConfig((old) => ({
              ...old,
              conversions: { ...old.conversions, systemToUser: checked },
            }))
          }
        />
        <div className="cpp-example">
          <div>
            <small>转换前</small>
            <Chip size="sm">system / developer</Chip>
            <p>你是一个有用的助手。</p>
          </div>
          <ArrowRight size={18} />
          <div>
            <small>
              {config.conversions.systemToUser ? "转换后" : "当前保持原角色"}
            </small>
            <Chip size="sm">
              {config.conversions.systemToUser ? "user" : "system / developer"}
            </Chip>
            <p>你是一个有用的助手。</p>
          </div>
        </div>
        <Notice>
          角色转换可能改变模型对系统指令的优先级。原生协议的基础消息、工具调用和响应格式转换由网关自动完成。
        </Notice>
      </PanelSection>
    </div>
  );
}

function RateLimitPanel({ config, setConfig }: Omit<Props, "panel">) {
  return (
    <div className="cpp-root">
      <div className="cpp-two-columns">
        <PanelSection
          title="请求额度"
          icon={CircleGauge}
          description="限制渠道每分钟可承接的请求。"
          action={
            <Chip size="sm">
              {config.rateLimit.requestsPerMinute === 0 ? "不限" : "已限制"}
            </Chip>
          }
        >
          <PanelNumber
            label="每分钟请求数"
            value={config.rateLimit.requestsPerMinute}
            onChange={(value) =>
              setConfig((old) => ({
                ...old,
                rateLimit: { ...old.rateLimit, requestsPerMinute: value },
              }))
            }
            min={0}
            max={1000000}
            step={1}
            unit="请求 / 分钟"
            description="0 表示不限，最大 1,000,000。"
          />
          <div className="cpp-presets">
            {[0, 60, 120, 600].map((value) => (
              <Button
                key={value}
                variant={
                  config.rateLimit.requestsPerMinute === value
                    ? "primary"
                    : "secondary"
                }
                onClick={() =>
                  setConfig((old) => ({
                    ...old,
                    rateLimit: { ...old.rateLimit, requestsPerMinute: value },
                  }))
                }
              >
                {value === 0 ? "不限" : value}
              </Button>
            ))}
          </div>
        </PanelSection>
        <PanelSection
          title="Token 额度"
          icon={Sparkles}
          description="限制渠道每分钟的预估 token 使用量。"
          action={
            <Chip size="sm">
              {config.rateLimit.tokensPerMinute === 0 ? "不限" : "已限制"}
            </Chip>
          }
        >
          <PanelNumber
            label="每分钟 token 数"
            value={config.rateLimit.tokensPerMinute}
            onChange={(value) =>
              setConfig((old) => ({
                ...old,
                rateLimit: { ...old.rateLimit, tokensPerMinute: value },
              }))
            }
            min={0}
            max={1000000000}
            step={1000}
            unit="token / 分钟"
            description="0 表示不限，按请求预估量预留额度。"
          />
          <div className="cpp-presets">
            {[0, 10000, 100000, 1000000].map((value) => (
              <Button
                key={value}
                variant={
                  config.rateLimit.tokensPerMinute === value
                    ? "primary"
                    : "secondary"
                }
                onClick={() =>
                  setConfig((old) => ({
                    ...old,
                    rateLimit: { ...old.rateLimit, tokensPerMinute: value },
                  }))
                }
              >
                {value === 0
                  ? "不限"
                  : value === 10000
                    ? "1 万"
                    : value === 100000
                      ? "10 万"
                      : "100 万"}
              </Button>
            ))}
          </div>
        </PanelSection>
      </div>
      <Card className="cpp-limit-summary">
        <CircleGauge size={20} />
        <div>
          <strong>超出额度时，尝试其他可用渠道</strong>
          <p>
            限制按渠道、每个自然分钟计数，流式与非流式请求共用额度。Token
            限制使用发送前的预估量，不代表精确计费。
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() =>
            setConfig((old) => ({
              ...old,
              rateLimit: { requestsPerMinute: 0, tokensPerMinute: 0 },
            }))
          }
        >
          <RotateCcw size={14} />
          恢复不限
        </Button>
      </Card>
    </div>
  );
}

function EndpointsPanel({ config, setConfig, channel }: Omit<Props, "panel">) {
  const activeKey = activeEndpoint(config);
  const simulated = config.protocol === "mock";
  return (
    <div className="cpp-root">
      <Card className="cpp-protocol-summary">
        <Network size={20} />
        <div>
          <strong>当前协议：{protocolName[config.protocol]}</strong>
          <p>
            {simulated
              ? "本地模拟不访问以下端点；切换为真实协议后使用对应配置。"
              : `聊天请求使用${endpointGroups.flatMap((group) => group.items).find((item) => item.key === activeKey)?.title}端点，其他协议的路径会保留。`}
          </p>
        </div>
        <Chip size="sm">
          {config.gatewayMode === "ai-gateway"
            ? "AI Gateway"
            : config.relayUrl
              ? "HTTPS 中继"
              : "直连"}
        </Chip>
      </Card>
      {endpointGroups.map((group) => (
        <PanelSection
          key={group.protocol}
          title={group.title}
          description={group.description}
          icon={Network}
          action={
            <Chip size="sm">
              {config.protocol === group.protocol ? "当前协议" : "备用配置"}
            </Chip>
          }
        >
          <div className="cpp-endpoint-list">
            {group.items.map((item) => {
              const active = !simulated && item.key === activeKey;
              return (
                <div className="cpp-endpoint" key={item.key}>
                  <div className="cpp-endpoint-title">
                    <strong>{item.title}</strong>
                    <Chip size="sm">{item.method}</Chip>
                    {active && (
                      <Chip size="sm" color="accent">
                        当前生效
                      </Chip>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfig((old) => ({
                          ...old,
                          endpoints: {
                            ...old.endpoints,
                            [item.key]:
                              defaultChannelConfig.endpoints[item.key],
                          },
                        }))
                      }
                      aria-label={`恢复${item.title}默认路径`}
                    >
                      <RotateCcw size={13} />
                      默认路径
                    </Button>
                  </div>
                  <Input
                    aria-label={`${item.title}端点路径`}
                    value={config.endpoints[item.key]}
                    onChange={(event) =>
                      setConfig((old) => ({
                        ...old,
                        endpoints: {
                          ...old.endpoints,
                          [item.key]: event.target.value,
                        },
                      }))
                    }
                    placeholder={defaultChannelConfig.endpoints[item.key]}
                  />
                  <small>{item.description}</small>
                  <div className="cpp-endpoint-preview">
                    <span>地址预览</span>
                    <code>{addressPreview(config, channel, item.key)}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </PanelSection>
      ))}
      <Notice>
        路径需以 / 开头，相对 API Base URL 拼接；不包含查询参数或片段。AI
        Gateway 的 Account 与 Gateway 使用全局设置。
      </Notice>
    </div>
  );
}

function AutoDisablePanel({ config, setConfig }: Omit<Props, "panel">) {
  const [customStatus, setCustomStatus] = useState("");
  const [statusError, setStatusError] = useState("");
  const policy = config.autoDisable;
  const disabled = !policy.enabled;
  const update = (patch: Partial<ChannelConfig["autoDisable"]>) =>
    setConfig((old) => ({
      ...old,
      autoDisable: { ...old.autoDisable, ...patch },
    }));
  const customCodes = policy.statuses.filter(
    (code) => !statusOptions.some((option) => option.code === code),
  );
  const toggleStatus = (code: number) => {
    if (!policy.statuses.includes(code) && policy.statuses.length >= 100) {
      setStatusError("最多选择 100 个状态码");
      return;
    }
    setStatusError("");
    setConfig((old) => {
      const statuses = old.autoDisable.statuses.includes(code)
        ? old.autoDisable.statuses.filter((status) => status !== code)
        : [...old.autoDisable.statuses, code];
      return { ...old, autoDisable: { ...old.autoDisable, statuses } };
    });
  };
  const addStatus = () => {
    const code = Number(customStatus);
    if (
      !/^\d{3}$/.test(customStatus.trim()) ||
      !Number.isInteger(code) ||
      code < 400 ||
      code > 599
    ) {
      setStatusError("请输入 400–599 之间的三位 HTTP 状态码");
      return;
    }
    if (!policy.statuses.includes(code) && policy.statuses.length >= 100) {
      setStatusError("最多选择 100 个状态码");
      return;
    }
    update({ statuses: [...new Set([...policy.statuses, code])] });
    setCustomStatus("");
    setStatusError("");
  };
  const steps: { icon: LucideIcon; title: string; description: string }[] = [
    {
      icon: ShieldAlert,
      title: "错误触发",
      description: `连续 ${policy.threshold} 次匹配状态码`,
    },
    {
      icon: policy.target === "key" ? KeyRound : Server,
      title: policy.target === "key" ? "禁用上游密钥" : "禁用整个渠道",
      description: "暂停参与请求调度",
    },
    {
      icon: Clock3,
      title: "等待冷却",
      description: `${policy.cooldown.toLocaleString()} 秒`,
    },
    {
      icon: policy.recover ? RotateCcw : Shield,
      title: policy.recover ? "自动探测恢复" : "手动恢复",
      description: policy.recover
        ? "通过全局恢复规则后启用"
        : "保留禁用，等待人工处理",
    },
  ];
  return (
    <div className="cpp-root">
      <PanelSection
        title="渠道专属策略"
        icon={Shield}
        description="开启后使用下面的配置；关闭时跟随全局自动禁用策略。"
        action={
          <Chip size="sm">{policy.enabled ? "渠道覆盖" : "跟随全局"}</Chip>
        }
      >
        <PanelToggle
          title="覆盖全局自动禁用策略"
          checked={policy.enabled}
          onChange={(checked) => update({ enabled: checked })}
          description="该配置针对上游 HTTP 错误；首字延迟和健康窗口仍由全局健康策略判断。"
        />
      </PanelSection>
      <PanelSection
        title="禁用对象"
        icon={KeyRound}
        description="指定错误达到阈值后，选择暂停哪一部分。"
      >
        <div className="cpp-two-columns">
          <ChoiceCard
            title="上游密钥"
            description="禁用出错的上游密钥，保留其他密钥"
            icon={KeyRound}
            selected={policy.target === "key"}
            disabled={disabled}
            onClick={() => update({ target: "key" })}
          />
          <ChoiceCard
            title="整个渠道"
            description="暂停此渠道所有上游请求"
            icon={Server}
            selected={policy.target === "channel"}
            disabled={disabled}
            onClick={() => update({ target: "channel" })}
          />
        </div>
      </PanelSection>
      <PanelSection
        title="触发状态码"
        icon={ShieldAlert}
        description="点击选择需要累计失败次数的 HTTP 错误；未匹配的状态码会重置连续计数。"
        action={<Chip size="sm">已选 {policy.statuses.length}</Chip>}
      >
        <div className="cpp-status-grid">
          {statusOptions.map((option) => (
            <Button
              key={option.code}
              className="cpp-status-choice"
              variant={
                policy.statuses.includes(option.code) ? "primary" : "secondary"
              }
              aria-pressed={policy.statuses.includes(option.code)}
              disabled={disabled}
              onClick={() => toggleStatus(option.code)}
            >
              <strong>{option.code}</strong>
              <span>{option.label}</span>
              {policy.statuses.includes(option.code) && <Check size={13} />}
            </Button>
          ))}
        </div>
        {customCodes.length > 0 && (
          <div className="cpp-custom-statuses">
            <small>自定义状态码</small>
            {customCodes.map((code) => (
              <Button
                key={code}
                variant="primary"
                disabled={disabled}
                onClick={() => toggleStatus(code)}
                aria-label={`取消状态码 ${code}`}
              >
                {code}
                <X size={13} />
              </Button>
            ))}
          </div>
        )}
        <div className="cpp-add-status">
          <Input
            aria-label="自定义 HTTP 状态码"
            inputMode="numeric"
            maxLength={3}
            placeholder="添加 400–599 状态码"
            value={customStatus}
            disabled={disabled}
            onChange={(event) => {
              setCustomStatus(event.target.value);
              setStatusError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addStatus();
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={disabled || !customStatus.trim()}
            onClick={addStatus}
          >
            <Plus size={14} />
            添加
          </Button>
        </div>
        {statusError && (
          <p className="cpp-error" role="alert">
            {statusError}
          </p>
        )}
        {!policy.statuses.length && (
          <small className="cpp-helper">
            尚未选择状态码，这条渠道策略不会由 HTTP 状态码触发。
          </small>
        )}
      </PanelSection>
      <div className="cpp-two-columns">
        <PanelSection
          title="连续失败阈值"
          icon={ShieldAlert}
          description="匹配错误累计到这个次数时禁用。"
        >
          <PanelNumber
            label="连续错误次数"
            value={policy.threshold}
            onChange={(value) => update({ threshold: value })}
            min={1}
            max={100}
            step={1}
            unit="次"
            disabled={disabled}
            description="支持 1–100 次，成功或未匹配状态码会重置计数。"
          />
        </PanelSection>
        <PanelSection
          title="冷却时间"
          icon={Clock3}
          description="禁用后等待多久再尝试恢复。"
        >
          <PanelNumber
            label="冷却时间"
            value={policy.cooldown}
            onChange={(value) => update({ cooldown: value })}
            min={1}
            max={86400}
            step={1}
            unit="秒"
            disabled={disabled}
            description="支持 1–86,400 秒。"
          />
        </PanelSection>
      </div>
      <PanelSection
        title="恢复流程"
        icon={RotateCcw}
        description={
          policy.enabled
            ? "流程随上面的配置实时更新，保存后生效。"
            : "以下是渠道专属策略的预览，当前执行全局策略。"
        }
      >
        <PanelToggle
          title="冷却后自动探测与恢复"
          checked={policy.recover}
          onChange={(checked) => update({ recover: checked })}
          disabled={disabled}
          description="启用后由定时探测检查，达到全局连续恢复次数后重新启用；关闭后需人工处理。"
        />
        <div className="cpp-policy-flow">
          {steps.map((step, index) => (
            <div className="cpp-policy-step" key={step.title}>
              <span className="cpp-step-number">{index + 1}</span>
              <step.icon size={18} />
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </div>
          ))}
        </div>
      </PanelSection>
    </div>
  );
}

export function ChannelPolicyPanel({ panel, ...props }: Props) {
  if (panel === "relay") return <RelayPanel {...props} />;
  if (panel === "conversions") return <ConversionsPanel {...props} />;
  if (panel === "rateLimit") return <RateLimitPanel {...props} />;
  if (panel === "endpoints") return <EndpointsPanel {...props} />;
  return <AutoDisablePanel {...props} />;
}
