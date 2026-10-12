import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Avatar,
  Card,
  Chip,
  Disclosure,
  Slider,
  Spinner,
  Tabs,
} from "@heroui/react";
import {
  Check,
  Copy,
  Download,
  FlaskConical,
  ImagePlus,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, Dialog, Input, Select, Switch, TextArea, toast } from "./ui";
import type {
  AttemptRecord,
  GatewayApiKey,
  GatewayChannel,
  GatewayLog,
  MockScenario,
} from "../shared/types";
import { api } from "./api";
import { modelsForProfile } from "./access-policy";
import "./playground.css";

type Props = {
  channels: GatewayChannel[];
  keys: GatewayApiKey[];
  initialChannelId?: string;
  onRefresh?: () => void | Promise<void>;
  devMode?: boolean;
};
type ImagePart = { type: "image_url"; image_url: { url: string } };
type Tool = { id: string; name: string; arguments: string };
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  tools?: Tool[];
  reasoning?: string;
  error?: string;
  requestId?: string;
  trace?: { log: GatewayLog; attempts: AttemptRecord[] };
  usage?: { input: number; output: number };
  pending?: boolean;
};
type WireMessage = {
  role: string;
  content: string | ({ type: "text"; text: string } | ImagePart)[];
};
type SSEPayload = {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        id: string;
        function?: { name: string; arguments: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
  type?: string;
  message?: string;
};
const scenarioNames: Record<MockScenario, string> = {
  healthy: "健康响应",
  slow: "首字延迟",
  error: "HTTP 错误",
  empty: "空响应",
  disconnect: "流中断",
  transient: "暂时失败后恢复",
};
const readableError = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败";
function modelsForKey(channels: GatewayChannel[], key?: GatewayApiKey) {
  if (!key) return [];
  const profile = key.profiles.find((item) => item.id === key.activeProfile);
  if (!profile) return [];
  return modelsForProfile(channels, profile);
}
export default function Playground({
  channels,
  keys,
  initialChannelId,
  onRefresh,
  devMode = false,
}: Props) {
  const [mode, setMode] = useState<"channel" | "gateway">(
    initialChannelId ? "channel" : "gateway",
  );
  const [channelId, setChannelId] = useState(
    initialChannelId || channels.find((channel) => !channel.archived)?.id || "",
  );
  const [keyId, setKeyId] = useState(
    keys.find((key) => key.status === "active")?.id || "",
  );
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(1);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [system, setSystem] = useState("你是一个有用的助手。");
  const [stream, setStream] = useState(true);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const [fixtureBusy, setFixtureBusy] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [scenario, setScenario] = useState<MockScenario>("healthy");
  const [delay, setDelay] = useState(50);
  const [httpStatus, setHttpStatus] = useState(503);
  const [failures, setFailures] = useState(1);
  const controller = useRef<AbortController | null>(null);
  const threadId = useRef(crypto.randomUUID());
  const bottom = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const channel = channels.find((item) => item.id === channelId);
  const key = keys.find((item) => item.id === keyId);
  const models =
    mode === "channel"
      ? [
          ...new Set([
            ...(channel?.models || []),
            ...(channel?.config.aliases.map((alias) => alias.from) || []),
          ]),
        ]
      : modelsForKey(channels, key);
  const modelsSignature = models.join("|");
  useEffect(() => {
    if (initialChannelId) {
      setChannelId(initialChannelId);
      setMode("channel");
    }
  }, [initialChannelId]);
  useEffect(() => {
    if (!channelId || !channels.some((item) => item.id === channelId))
      setChannelId(channels.find((item) => !item.archived)?.id || "");
  }, [channels, channelId]);
  useEffect(() => {
    if (!keyId || !keys.some((item) => item.id === keyId))
      setKeyId(keys.find((item) => item.status === "active")?.id || "");
  }, [keys, keyId]);
  useEffect(() => {
    if (!models.includes(model)) setModel(models[0] || "");
  }, [modelsSignature, model]);
  useEffect(() => {
    if (channel?.config.protocol === "mock") {
      setScenario(channel.config.mock.scenario);
      setDelay(channel.config.mock.delayMs);
      setHttpStatus(channel.config.mock.status);
      setFailures(channel.config.mock.failuresBeforeSuccess);
    }
  }, [
    channelId,
    channel?.config.mock.scenario,
    channel?.config.mock.delayMs,
    channel?.config.mock.status,
    channel?.config.mock.failuresBeforeSuccess,
  ]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);
  useEffect(() => () => controller.current?.abort(), []);
  const editMessage = (id: string, update: Partial<Message>) =>
    setMessages((old) =>
      old.map((message) =>
        message.id === id ? { ...message, ...update } : message,
      ),
    );
  const requestBody = (history: Message[]) => ({
    model,
    messages: [
      ...(system.trim() ? [{ role: "system", content: system }] : []),
      ...history
        .filter((message) => !message.error && !message.pending)
        .map((message) => ({
          role: message.role,
          content: message.image
            ? [
                { type: "text" as const, text: message.content },
                {
                  type: "image_url" as const,
                  image_url: { url: message.image },
                },
              ]
            : message.content,
        })),
    ] as WireMessage[],
    temperature,
    max_tokens: maxTokens,
    stream,
  });
  async function loadTrace(id: string, assistantId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const trace = await api<{ log: GatewayLog; attempts: AttemptRecord[] }>(
          `/api/logs/${encodeURIComponent(id)}`,
        );
        editMessage(assistantId, { trace });
        return;
      } catch {
        if (attempt === 4) return;
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * (attempt + 1)),
        );
      }
    }
  }
  async function send(history?: Message[]) {
    if (running) return;
    if (!model || (mode === "channel" ? !channelId : !keyId)) {
      toast.error(
        mode === "channel"
          ? "请选择渠道和模型"
          : "请先创建可用 API Key 并选择模型",
      );
      return;
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1000000) {
      toast.error("最大 token 数须为 1–1000000 的整数");
      return;
    }
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      ...(image ? { image } : {}),
    };
    const historyToSend = history || [...messages, user];
    if (!history && !user.content && !user.image) return;
    const assistantId = crypto.randomUUID();
    const abort = new AbortController();
    controller.current = abort;
    setMessages([
      ...historyToSend,
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);
    if (!history) {
      setInput("");
      setImage(null);
    }
    setRunning(true);
    let requestId: string | null = null;
    const tools = new Map<number, Tool>();
    let content = "";
    let reasoning = "";
    let usage: Message["usage"];
    const apply = (payload: SSEPayload) => {
      if (payload.error || payload.type === "error") {
        const error = payload.error;
        throw new Error(
          typeof error === "string"
            ? error
            : error?.message || payload.message || "上游流式请求失败",
        );
      }
      const choice = payload.choices?.[0];
      if (typeof choice?.delta?.content === "string")
        content += choice.delta.content;
      const thought =
        choice?.delta?.reasoning_content || choice?.delta?.reasoning;
      if (typeof thought === "string") reasoning += thought;
      for (const delta of choice?.delta?.tool_calls || []) {
        const tool = tools.get(delta.index) || {
          id: delta.id || `tool-${delta.index}`,
          name: "",
          arguments: "",
        };
        if (delta.id) tool.id = delta.id;
        if (delta.function?.name) tool.name += delta.function.name;
        if (delta.function?.arguments)
          tool.arguments += delta.function.arguments;
        tools.set(delta.index, tool);
      }
      if (choice?.message) {
        content = choice.message.content || "";
        reasoning = choice.message.reasoning_content || "";
        for (const [index, tool] of (choice.message.tool_calls || []).entries())
          tools.set(index, {
            id: tool.id,
            name: tool.function?.name || "",
            arguments: tool.function?.arguments || "",
          });
      }
      if (payload.usage)
        usage = {
          input: payload.usage.prompt_tokens || 0,
          output: payload.usage.completion_tokens || 0,
        };
      editMessage(assistantId, {
        content,
        reasoning,
        tools: [...tools.values()],
        usage,
      });
    };
    try {
      const response = await fetch("/api/playground/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Thread-Id": threadId.current,
        },
        body: JSON.stringify({
          mode,
          channelId: mode === "channel" ? channelId : undefined,
          keyId: mode === "gateway" ? keyId : undefined,
          request: requestBody(historyToSend),
        }),
        signal: abort.signal,
      });
      requestId = response.headers.get("x-pulsegate-request-id");
      if (requestId) editMessage(assistantId, { requestId });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as SSEPayload;
        const error = data.error;
        throw new Error(
          typeof error === "string"
            ? error
            : error?.message || data.message || `HTTP ${response.status}`,
        );
      }
      if (
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        apply((await response.json()) as SSEPayload);
      } else {
        if (!response.body) throw new Error("响应没有可读取的流");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        const consume = (frame: string) => {
          let event = "message";
          const data: string[] = [];
          for (const line of frame.split(/\r?\n/)) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (!data.length) return;
          const text = data.join("\n");
          if (text === "[DONE]") {
            finished = true;
            return;
          }
          let payload: SSEPayload;
          try {
            payload = JSON.parse(text);
          } catch {
            if (event === "error") throw new Error(text);
            throw new Error("收到格式异常的 SSE 数据");
          }
          if (event === "error")
            throw new Error(
              typeof payload.error === "string"
                ? payload.error
                : payload.error?.message || payload.message || "上游流中断",
            );
          apply(payload);
        };
        try {
          while (!finished) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            let boundary: RegExpExecArray | null;
            while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
              consume(buffer.slice(0, boundary.index));
              buffer = buffer.slice(boundary.index + boundary[0].length);
              if (finished) break;
            }
            if (chunk.done) {
              if (buffer.trim()) consume(buffer);
              break;
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        if (!finished) throw new Error("流式响应提前结束，未收到完成标记");
      }
      if (!content && !reasoning && !tools.size)
        throw new Error("上游返回了空响应");
      editMessage(assistantId, { pending: false });
    } catch (error) {
      const stopped = abort.signal.aborted;
      editMessage(assistantId, {
        pending: false,
        error: stopped ? "已停止生成" : readableError(error),
      });
      if (!stopped) toast.error(readableError(error));
    } finally {
      setRunning(false);
      controller.current = null;
      if (requestId) void loadTrace(requestId, assistantId);
      onRefresh?.();
    }
  }
  function retry() {
    const lastUser = messages
      .map((message) => message.role)
      .lastIndexOf("user");
    if (lastUser >= 0) void send(messages.slice(0, lastUser + 1));
  }
  async function attach(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      toast.error("支持 PNG、JPEG、WebP 和 GIF");
      return;
    }
    if (file.size > 1048576) {
      toast.error("图片不能超过 1 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.onerror = () => toast.error("图片读取失败");
    reader.readAsDataURL(file);
  }
  async function installFixtures() {
    setFixtureBusy(true);
    try {
      const installed = await api<{ channels: GatewayChannel[] }>(
        "/api/dev/fixtures",
        { method: "POST" },
      );
      await onRefresh?.();
      setMode("channel");
      if (installed.channels[0]) setChannelId(installed.channels[0].id);
      toast.success("已安装健康主渠道与备用渠道，可调整故障场景");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setFixtureBusy(false);
    }
  }
  async function saveScenario() {
    if (!channel || channel.config.protocol !== "mock") return;
    setFixtureBusy(true);
    try {
      await api(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          config: {
            ...channel.config,
            mock: {
              scenario,
              delayMs: delay,
              status: httpStatus,
              failuresBeforeSuccess: failures,
            },
          },
        }),
      });
      onRefresh?.();
      toast.success("本地上游故障场景已更新");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setFixtureBusy(false);
    }
  }
  const curl = `curl '${window.location.origin}/v1/chat/completions' \\\n  -H 'Authorization: Bearer $PULSEGATE_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  --data '${JSON.stringify(requestBody(messages.filter((message) => message.role === "user").slice(-1))).replace(/'/g, "'\\''")}'${stream ? " \\\n  --no-buffer" : ""}`;
  return (
    <div className="pg-layout">
      <Card className="pg-controls">
        <header>
          <span className="pg-eyebrow">PLAYGROUND</span>
          <h3>测试场</h3>
          <p>验证模型响应、首字延迟与渠道切换。</p>
        </header>
        <div className="pg-control-body">
          <span className="pg-label">测试模式</span>
          <Tabs
            className="pg-segment"
            selectedKey={mode}
            onSelectionChange={(value) =>
              setMode(String(value) as "channel" | "gateway")
            }
            disabledKeys={running ? ["channel", "gateway"] : []}
          >
            <Tabs.List aria-label="测试模式">
              <Tabs.Tab id="channel">
                渠道直测
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="gateway">
                模型网关
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel id="channel" className="pg-mode-description">
              诊断指定上游的响应质量
            </Tabs.Panel>
            <Tabs.Panel id="gateway" className="pg-mode-description">
              验证当前 Key 的实际路由策略
            </Tabs.Panel>
          </Tabs>
          {mode === "channel" ? (
            <div className="pg-field">
              <span>渠道</span>
              <Select
                disabled={running}
                aria-label="渠道"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                <option value="">请选择渠道</option>
                {channels
                  .filter((item) => !item.archived)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                      {!item.enabled ? "（已停用）" : ""}
                    </option>
                  ))}
              </Select>
              <small>直测指定渠道，用于诊断上游；不会跨渠道重试。</small>
            </div>
          ) : (
            <div className="pg-field">
              <span>网关 API Key</span>
              <Select
                disabled={running}
                aria-label="网关 API Key"
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
              >
                <option value="">请选择 API Key</option>
                {keys
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.preview}
                    </option>
                  ))}
              </Select>
              <small>使用此 Key 的实际标签权限、模型白名单与映射。</small>
            </div>
          )}
          <div className="pg-field">
            <span>模型</span>
            <Select
              disabled={running}
              aria-label="模型"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">
                {models.length ? "请选择模型" : "暂无可用模型"}
              </option>
              {models.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
            <small>{models.length} 个模型可用</small>
          </div>
          <div className="pg-field">
            <span>
              温度 <b>{temperature.toFixed(1)}</b>
            </span>
            <Slider
              aria-label="温度"
              minValue={0}
              maxValue={2}
              step={0.1}
              value={temperature}
              isDisabled={running}
              onChange={(value) =>
                setTemperature(Array.isArray(value) ? value[0] : value)
              }
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb />
              </Slider.Track>
            </Slider>
            <div className="pg-range-values">
              <small>0</small>
              <small>1</small>
              <small>2</small>
            </div>
          </div>
          <div className="pg-field">
            <span>最大 token 数</span>
            <Input
              disabled={running}
              type="number"
              min="1"
              max="1000000"
              aria-label="最大 token 数"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </div>
          <div className="pg-field">
            <span>系统提示</span>
            <TextArea
              disabled={running}
              aria-label="系统提示"
              value={system}
              rows={4}
              onChange={(e) => setSystem(e.target.value)}
            />
          </div>
          <div className="pg-stream">
            <span>
              流式响应 <small>SSE</small>
            </span>
            <Switch
              aria-label="流式响应"
              disabled={running}
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
            />
          </div>
          {devMode && (
            <Collapsible
              className="pg-fixture"
              title={
                <>
                  <FlaskConical size={15} />
                  本地故障实验
                </>
              }
            >
              <p>实验渠道经过同一网关引擎，健康数据与日志均真实保存。</p>
              <Button
                className="pg-outline"
                variant="secondary"
                onClick={() => void installFixtures()}
                disabled={fixtureBusy || running}
              >
                {fixtureBusy ? "处理中…" : "安装 / 重置实验渠道"}
              </Button>
              {mode === "gateway" &&
                channels.some((item) => item.config.protocol === "mock") && (
                  <div className="pg-field">
                    <span>配置实验上游</span>
                    <Select
                      aria-label="渠道"
                      value={channelId}
                      disabled={running}
                      onChange={(e) => setChannelId(e.target.value)}
                    >
                      <option value="">选择实验渠道</option>
                      {channels
                        .filter(
                          (item) =>
                            item.config.protocol === "mock" && !item.archived,
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                )}
              {channel?.config.protocol === "mock" && (
                <>
                  <div className="pg-field">
                    <span>上游场景</span>
                    <Select
                      aria-label="上游场景"
                      value={scenario}
                      onChange={(e) => {
                        const next = e.target.value as MockScenario;
                        setScenario(next);
                        if (next === "slow") setDelay(15000);
                        else if (next === "healthy") setDelay(50);
                      }}
                      disabled={running}
                    >
                      {Object.entries(scenarioNames).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="pg-field">
                    <span>首字等待（毫秒）</span>
                    <Input
                      type="number"
                      min="0"
                      max="600000"
                      aria-label="首字等待（毫秒）"
                      value={delay}
                      onChange={(e) => setDelay(Number(e.target.value))}
                      disabled={running}
                    />
                  </div>
                  {(scenario === "error" || scenario === "transient") && (
                    <div className="pg-field">
                      <span>HTTP 状态码</span>
                      <Input
                        type="number"
                        min="400"
                        max="599"
                        aria-label="HTTP 状态码"
                        value={httpStatus}
                        onChange={(e) => setHttpStatus(Number(e.target.value))}
                        disabled={running}
                      />
                    </div>
                  )}
                  {scenario === "transient" && (
                    <div className="pg-field">
                      <span>成功前失败次数</span>
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        aria-label="成功前失败次数"
                        value={failures}
                        onChange={(e) => setFailures(Number(e.target.value))}
                        disabled={running}
                      />
                    </div>
                  )}
                  <Button
                    className="pg-outline"
                    variant="secondary"
                    onClick={() => void saveScenario()}
                    disabled={fixtureBusy || running}
                  >
                    保存故障场景
                  </Button>
                </>
              )}
            </Collapsible>
          )}
        </div>
        <footer>
          <Button
            className="pg-outline"
            variant="secondary"
            onClick={retry}
            disabled={
              running || !messages.some((message) => message.role === "user")
            }
          >
            <RotateCcw size={14} />
            重试最后一条
          </Button>
          <Button
            className="pg-outline"
            variant="secondary"
            disabled={running || !messages.length}
            onClick={() => {
              setMessages([]);
              threadId.current = crypto.randomUUID();
            }}
          >
            <Trash2 size={14} />
            清除聊天
          </Button>
          <Button
            className="pg-outline"
            variant="secondary"
            onClick={() => setCurlOpen(true)}
          >
            <Download size={14} />
            导出 cURL
          </Button>
        </footer>
      </Card>
      <Card className="pg-chat">
        <div className="pg-chat-head">
          <Chip size="sm" color="accent" className="pg-chat-model">
            <Chip.Label>
              {mode === "channel" ? "渠道直测" : "网关路由"}
              {model ? ` / ${model}` : ""}
            </Chip.Label>
          </Chip>
          <span>
            {running ? (
              <>
                <Spinner size="sm" />
                请求进行中
              </>
            ) : (
              "准备就绪"
            )}
          </span>
        </div>
        <div className="pg-messages">
          {!messages.length && (
            <div className="pg-welcome">
              <div>
                <MessageSquare size={31} />
              </div>
              <h3>从一次真实请求开始</h3>
              <p>
                选择渠道或网关 API Key，在下方输入消息。
                <br />
                请求结束后可查看每次尝试、首字延迟与切换路径。
              </p>
              <div>
                <Button
                  onClick={() => setInput("你好，请简短介绍一下你自己。")}
                >
                  测试简短响应
                </Button>
                <Button
                  onClick={() => setInput("请用三个要点解释 SSE 流式输出。")}
                >
                  测试流式输出
                </Button>
              </div>
            </div>
          )}
          {messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}
          <div ref={bottom} />
        </div>
        <form
          className="pg-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {image && (
            <div className="pg-attachment">
              <img src={image} alt="待发送附件" />
              <span>图片已附加</span>
              <Button
                type="button"
                onClick={() => setImage(null)}
                variant="tertiary"
                size="sm"
                isIconOnly
                aria-label="移除图片"
              >
                <X size={13} />
              </Button>
            </div>
          )}
          <TextArea
            aria-label="消息"
            placeholder="输入消息… Enter 发送，Shift + Enter 换行"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
            rows={2}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="pg-composer-actions">
            <Button
              className="pg-image-button"
              variant="tertiary"
              type="button"
              isIconOnly
              aria-label="添加图片"
              disabled={running}
              onClick={() => imageInput.current?.click()}
              title="添加图片，最多 1 MB"
            >
              <ImagePlus size={18} />
            </Button>
            <input
              ref={imageInput}
              className="pg-image-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={running}
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <small>图片内容只发送给所选上游</small>
            {running ? (
              <Button
                className="pg-send pg-stop"
                variant="danger-soft"
                type="button"
                onClick={() => controller.current?.abort()}
                aria-label="停止生成"
              >
                <Square size={15} />
                停止
              </Button>
            ) : (
              <Button
                className="pg-send"
                variant="primary"
                isIconOnly
                disabled={(!input.trim() && !image) || !model}
                aria-label="发送消息"
                type="submit"
              >
                <Send size={16} />
              </Button>
            )}
          </div>
        </form>
      </Card>
      {curlOpen && (
        <Dialog title="导出网关 cURL" close={() => setCurlOpen(false)}>
          <p className="pg-curl-hint">
            将 PULSEGATE_API_KEY
            替换为你的网关密钥。密钥原文不会出现在此导出中；渠道直测配置在此转换为公开网关请求。
          </p>
          <pre className="pg-curl-result">{curl}</pre>
          <footer className="pg-curl-footer">
            <Button
              className="pg-curl-copy"
              variant="primary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(curl)
                  .then(() => toast.success("cURL 已复制"))
                  .catch(() => toast.error("无法访问剪贴板"));
              }}
            >
              <Copy size={14} /> 复制 cURL
            </Button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
function MessageView({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  return (
    <article className={`pg-message pg-${message.role}`}>
      <Avatar
        className="pg-avatar"
        size="sm"
        color={message.role === "user" ? "default" : "accent"}
      >
        <Avatar.Fallback>
          {message.role === "user" ? "你" : "AI"}
        </Avatar.Fallback>
      </Avatar>
      <div className="pg-message-body">
        <header>
          <strong>{message.role === "user" ? "你" : "模型"}</strong>
          {message.pending && (
            <span>
              <Spinner size="sm" />
              {message.content ? "生成中…" : "等待有效首字…"}
            </span>
          )}
          <Button
            className="pg-copy-message"
            variant="tertiary"
            size="sm"
            isIconOnly
            title="复制内容"
            aria-label="复制消息"
            onClick={() => {
              void navigator.clipboard
                .writeText(message.content)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => toast.error("复制失败"));
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </Button>
        </header>
        {message.image && (
          <img
            className="pg-message-image"
            src={message.image}
            alt="发送的图片"
          />
        )}
        {message.reasoning && (
          <Collapsible className="pg-reasoning" title="思考内容">
            <p>{message.reasoning}</p>
          </Collapsible>
        )}
        {message.content && <div className="pg-text">{message.content}</div>}
        {message.tools?.map((tool) => (
          <Collapsible
            key={tool.id}
            className="pg-tool"
            defaultOpen
            title={`工具调用 · ${tool.name || tool.id}`}
          >
            <pre>{tool.arguments}</pre>
            <small>测试场展示调用内容，未自动执行外部工具。</small>
          </Collapsible>
        ))}
        {message.error && (
          <Alert status="danger" className="pg-error">
            <Alert.Content>
              <Alert.Description>{message.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
        {message.usage && (
          <small className="pg-usage">
            输入 {message.usage.input} · 输出 {message.usage.output} token
          </small>
        )}
        {message.trace && (
          <Collapsible
            className="pg-trace"
            title={
              <span>
                {message.trace.log.attempts > 1
                  ? "渠道切换 / 重试"
                  : "请求完成"}{" "}
                · {message.trace.log.status} · 首字{" "}
                {message.trace.log.ttft.toFixed(2)}s · 总耗时{" "}
                {message.trace.log.duration.toFixed(2)}s
              </span>
            }
          >
            <div className="pg-attempts">
              {message.trace.attempts.map((attempt) => (
                <div key={attempt.id}>
                  <b>#{attempt.attempt}</b>
                  <span>
                    <strong>{attempt.channelName}</strong>
                    <small>
                      {attempt.model} · HTTP {attempt.status} · {attempt.result}
                    </small>
                    {attempt.error && (
                      <small className="pg-attempt-error">
                        {attempt.error}
                      </small>
                    )}
                  </span>
                  <em>
                    {attempt.ttft != null
                      ? `${attempt.ttft.toFixed(2)}s 首字`
                      : "无有效首字"}
                    <small>{attempt.duration.toFixed(2)}s 完成</small>
                  </em>
                </div>
              ))}
            </div>
            <code>{message.requestId}</code>
          </Collapsible>
        )}
        {message.requestId && !message.trace && (
          <small className="pg-usage">请求 ID：{message.requestId}</small>
        )}
      </div>
    </article>
  );
}
function Collapsible({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Disclosure className={className} defaultExpanded={defaultOpen}>
      <Disclosure.Heading>
        <Disclosure.Trigger>
          {title}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body>{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
