import { useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Chip } from "@heroui/react";
import {
  Check,
  CircleGauge,
  Globe,
  Info,
  KeyRound,
  Network,
  Plus,
  RotateCcw,
  Server,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChannelConfig, GatewayChannel } from "../shared/types";
import { defaultChannelConfig } from "../shared/types";
import { resolveApiUrl } from "../shared/upstream-url";
import { Button, Input } from "./ui";
import { PanelNumber, PanelSection, PanelToggle } from "./ChannelPanelUI";
import "./channel-policy-panels.css";

export type ChannelPolicyPanelName =
  "relay" | "rateLimit" | "endpoints" | "autoDisable";

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
    title: "Chat Completions 端点",
    description: "公开 /v1/chat/completions 使用对应路径，保留客户端请求格式。",
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
    title: "Messages 端点",
    description: "公开 /v1/messages 使用对应路径，保留客户端 Messages 请求格式。",
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
    title: "Gemini 渠道测试端点",
    description: "用于 Gemini 渠道测试，{model} 替换为上游模型名。",
    items: [
      {
        key: "generate",
        title: "内容生成",
        method: "POST",
        description:
          "流式渠道测试使用 streamGenerateContent 并添加 alt=sse。",
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

function joinAddress(
  baseText: string,
  path: string,
  protocol: ChannelConfig["protocol"],
  model: string,
) {
  try {
    const base = new URL(baseText);
    if (
      base.username ||
      base.password ||
      !["http:", "https:"].includes(base.protocol)
    )
      return "请输入有效的 API 地址";
    return resolveApiUrl(base, path, protocol, model).toString();
  } catch {
    return "请输入有效的 API 地址";
  }
}

function addressPreview(
  config: ChannelConfig,
  channel: GatewayChannel,
  key: EndpointKey,
) {
  const path = config.endpoints[key];
  const protocol = key === "chat"
    ? "openai"
    : key === "messages"
      ? "anthropic"
      : key === "generate"
        ? "gemini"
        : config.protocol;
  const model =
    config.aliases.find((alias) => alias.from === channel.model)?.to ??
    channel.model;
  if (config.gatewayMode === "ai-gateway") {
    let upstreamPath = path.replace(
      "{model}",
      encodeURIComponent(model || "model-name"),
    );
    try {
      upstreamPath = new URL(
        joinAddress(channel.endpoint, path, protocol, model || "model-name"),
      ).pathname;
    } catch {
      /* Show the configured path until the address is valid. */
    }
    const slug =
      config.customProviderSlug.replace(/^custom-/, "") || "<服务商 slug>";
    return `https://gateway.ai.cloudflare.com/v1/<Account>/<Gateway>/custom-${slug}${upstreamPath}`;
  }
  return joinAddress(
    config.relayUrl || channel.endpoint,
    path,
    protocol,
    model || "model-name",
  );
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
      <PanelSection title="连接方式" icon={Network}>
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
            description="通过中继地址转发请求"
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
            当前通过 Cloudflare AI Gateway 转发，中继配置暂不生效。
          </Notice>
        ) : simulated ? (
          <Notice>当前渠道使用本地模拟，不发送真实上游请求。</Notice>
        ) : relayMode ? (
          <label className="cpp-field">
            <span>中继 API Base URL</span>
            <Input
              aria-label="HTTPS 中继 URL"
              type="url"
              required
              value={draftUrl}
              placeholder="https://relay.example.com"
              onChange={(event) => {
                setDraftUrl(event.target.value);
                setConfig((old) => ({ ...old, relayUrl: event.target.value }));
              }}
            />
            <small>需支持客户端请求格式和渠道认证头。</small>
          </label>
        ) : (
          <div className="cpp-address">
            <span>上游 Base URL</span>
            <code>{channel.endpoint}</code>
          </div>
        )}
        <details className="cpp-details">
          <summary>渠道测试地址与拼接规则</summary>
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
          <p className="cpp-helper">
            {aiGateway
              ? "Account 与 Gateway 使用全局设置。"
              : `模型获取与渠道测试只填域名时默认补 ${config.protocol === "gemini" ? "/v1beta" : "/v1"}；公开请求保持客户端入口和格式。`}
          </p>
        </details>
      </PanelSection>
    </div>
  );
}

function RateLimitPanel({ config, setConfig }: Omit<Props, "panel">) {
  return (
    <div className="cpp-root">
      <div className="cpp-two-columns">
        <PanelSection title="请求额度" icon={CircleGauge}>
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
            description="0 表示不限。"
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
        <PanelSection title="Token 额度" icon={Sparkles}>
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
            description="0 表示不限，使用请求预估量。"
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
      <div className="cpp-limit-note">
        <p className="cpp-helper">每个自然分钟重置，流式与非流式共用；超额后尝试其他渠道。</p>
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
      </div>
    </div>
  );
}

function EndpointsPanel({ config, setConfig, channel }: Omit<Props, "panel">) {
  const activeKey = activeEndpoint(config);
  const simulated = config.protocol === "mock";
  return (
    <div className="cpp-root">
      <p className="cpp-helper">
        {simulated ? "本地模拟不访问外部端点。" : `当前测试接口：${protocolName[config.protocol]}。公开请求使用各自入口的路径与格式。`}
      </p>
      {endpointGroups.map((group) => (
        <PanelSection
          key={group.protocol}
          title={group.title}
          description={group.description}
          icon={Network}
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
                        渠道测试
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
                  <details className="cpp-details cpp-endpoint-preview">
                    <summary>地址预览与说明</summary>
                    <code>{addressPreview(config, channel, item.key)}</code>
                    <p className="cpp-helper">{item.description}</p>
                  </details>
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
  return (
    <div className="cpp-root">
      <PanelToggle
        title="覆盖全局自动禁用策略"
        checked={policy.enabled}
        onChange={(checked) => update({ enabled: checked })}
        description="关闭时跟随全局策略。此处仅配置 HTTP 错误，不影响全局健康策略。"
      />
      <PanelSection title="禁用规则" icon={KeyRound}>
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
        <div className="cpp-two-columns cpp-policy-fields">
          <PanelNumber
            label="连续错误次数"
            value={policy.threshold}
            onChange={(value) => update({ threshold: value })}
            min={1}
            max={100}
            step={1}
            unit="次"
            disabled={disabled}
            description="成功或未匹配状态码会重置计数。"
          />
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
        </div>
      </PanelSection>
      <PanelSection
        title="触发状态码"
        icon={ShieldAlert}
        description="选择需要计入连续错误的 HTTP 状态码。"
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
      <div className="cpp-recovery">
        <PanelToggle
          title="冷却后自动探测与恢复"
          checked={policy.recover}
          onChange={(checked) => update({ recover: checked })}
          disabled={disabled}
          description="通过全局恢复规则后重新启用；关闭后需手动恢复。"
        />
      </div>
    </div>
  );
}

export function ChannelPolicyPanel({ panel, ...props }: Props) {
  if (panel === "relay") return <RelayPanel {...props} />;
  if (panel === "rateLimit") return <RateLimitPanel {...props} />;
  if (panel === "endpoints") return <EndpointsPanel {...props} />;
  return <AutoDisablePanel {...props} />;
}
