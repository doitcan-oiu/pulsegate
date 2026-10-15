import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Disclosure,
  Slider,
  Spinner,
} from "@heroui/react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FlaskConical,
  ImagePlus,
  RotateCcw,
  Send,
  Square,
  SlidersHorizontal,
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
import { modelsForProfile, usableApiKey } from "./access-policy";
import { splitSSEFrames } from "./playground-stream";
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
const MAX_MODEL_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_PLAYGROUND_PAYLOAD_BYTES = 4 * 1024 * 1024;
const requestBytes = (value: string) => new TextEncoder().encode(value).byteLength;
const requestSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
function modelsForKey(channels: GatewayChannel[], key?: GatewayApiKey) {
  if (!key || !usableApiKey(key)) return [];
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
    keys.find((key) => usableApiKey(key))?.id || "",
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
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<MockScenario>("healthy");
  const [delay, setDelay] = useState(50);
  const [httpStatus, setHttpStatus] = useState(503);
  const [failures, setFailures] = useState(1);
  const controller = useRef<AbortController | null>(null);
  const threadId = useRef(crypto.randomUUID());
  const messageList = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
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
  const modelsSignature = JSON.stringify(models);
  useEffect(() => {
    if (initialChannelId) {
      setChannelId(initialChannelId);
      setMode("channel");
    }
  }, [initialChannelId]);
  useEffect(() => {
    if (!running && (!channelId || !channels.some((item) => item.id === channelId && !item.archived)))
      setChannelId(channels.find((item) => !item.archived)?.id || "");
  }, [channels, channelId, running]);
  useEffect(() => {
    if (!running && (!keyId || !keys.some((item) => item.id === keyId && usableApiKey(item))))
      setKeyId(keys.find((item) => usableApiKey(item))?.id || "");
  }, [keys, keyId, running]);
  useEffect(() => {
    if (!running && !models.includes(model)) setModel(models[0] || "");
  }, [modelsSignature, model, running]);
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
    if (followOutput.current && messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
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
    if (running || controller.current) return;
    if (!model || !models.includes(model) || (mode === "channel" ? !channel || channel.archived : !key || !usableApiKey(key))) {
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
    const request = requestBody(historyToSend);
    const modelBytes = requestBytes(JSON.stringify(request));
    const payload = JSON.stringify({
      mode,
      channelId: mode === "channel" ? channelId : undefined,
      keyId: mode === "gateway" ? keyId : undefined,
      request,
    });
    if (modelBytes > MAX_MODEL_REQUEST_BYTES || requestBytes(payload) > MAX_PLAYGROUND_PAYLOAD_BYTES) {
      setBudgetError(`当前会话请求为 ${requestSize(modelBytes)}，超过单次 2 MiB 上限。历史回复、系统提示和图片编码均计入大小；请开启新会话或缩小图片后发送，待发内容会保留。`);
      return;
    }
    setBudgetError(null);
    const assistantId = crypto.randomUUID();
    const abort = new AbortController();
    controller.current = abort;
    followOutput.current = true;
    setControlsExpanded(false);
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
          input: Math.max(usage?.input ?? 0, payload.usage.prompt_tokens ?? 0),
          output: Math.max(usage?.output ?? 0, payload.usage.completion_tokens ?? 0),
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
        body: payload,
        signal: abort.signal,
      });
      requestId = response.headers.get("x-pulsegate-request-id");
      if (requestId) editMessage(assistantId, { requestId });
      if (!response.ok) {
        if (response.status === 413) {
          setMessages(messages);
          if (!history) {
            setInput(user.content);
            setImage(user.image ?? null);
          }
          setBudgetError("请求内容超过服务端大小上限，待发内容已保留。请开启新会话或缩小图片后重试。");
          return;
        }
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
          for (const line of frame.split(/\r\n|\r|\n/)) {
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
            const parsed = splitSSEFrames(buffer, chunk.done);
            buffer = parsed.remainder;
            for (const frame of parsed.frames) {
              consume(frame);
              if (finished) break;
            }
            if (chunk.done) break;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      }
      if (abort.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
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
      try { await onRefresh?.(); }
      catch { toast.error("请求已结束，状态刷新失败。请手动刷新控制台。"); }
    }
  }
  function retry() {
    const lastUser = messages
      .map((message) => message.role)
      .lastIndexOf("user");
    if (lastUser >= 0) void send(messages.slice(0, lastUser + 1));
  }
  function newConversation() {
    if (budgetError && !input.trim() && !image) {
      const lastUser = [...messages].reverse().find(message => message.role === "user");
      if (lastUser) {
        setInput(lastUser.content);
        setImage(lastUser.image ?? null);
      }
    }
    setMessages([]);
    setBudgetError(null);
    threadId.current = crypto.randomUUID();
    followOutput.current = true;
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
    reader.onload = () => { setImage(String(reader.result)); setBudgetError(null); };
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
  const curl = curlOpen ? `curl '${window.location.origin}/v1/chat/completions' \\\n  -H 'Authorization: Bearer $PULSEGATE_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  --data '${JSON.stringify(requestBody(messages.filter((message) => message.role === "user").slice(-1))).replace(/'/g, "'\\''")}'${stream ? " \\\n  --no-buffer" : ""}` : "";
  return (
    <div className={`pg-layout${controlsExpanded ? " pg-controls-expanded" : ""}`}>
      <div className="pg-requestbar">
        <div className="pg-route-selects">
          <Select aria-label="测试模式" value={mode} disabled={running} onChange={event => setMode(event.target.value as "channel" | "gateway")}>
            <option value="gateway">网关路由</option><option value="channel">渠道直测</option>
          </Select>
          {mode === "channel" ? <Select aria-label="渠道" value={channelId} disabled={running} onChange={event => setChannelId(event.target.value)}>
            <option value="">选择渠道</option>{channels.filter(item => !item.archived).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </Select> : <Select aria-label="网关 API Key" value={keyId} disabled={running} onChange={event => setKeyId(event.target.value)}>
            <option value="">选择 API Key</option>{keys.filter(item => usableApiKey(item)).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </Select>}
          <Select aria-label="模型" value={model} disabled={running} onChange={event => setModel(event.target.value)}>
            <option value="">{models.length ? "选择模型" : "暂无模型"}</option>{models.map(item => <option key={item}>{item}</option>)}
          </Select>
        </div>
        <Button className="pg-control-toggle" variant="tertiary" size="sm" aria-label={controlsExpanded ? "收起请求参数" : "展开请求参数"} aria-expanded={controlsExpanded} aria-controls="pg-control-body" onClick={() => setControlsExpanded(old => !old)}><SlidersHorizontal size={15} /><span>参数</span><ChevronDown size={13} /></Button>
      </div>
      {mode === "channel" && channel && ["anthropic", "gemini"].includes(channel.config.protocol) && <div className="pg-protocol-warning" role="note">当前测试场发送 OpenAI Chat Completions 请求。{channel.config.protocol === "anthropic" ? "Anthropic" : "Gemini"} 原生接口请使用对应客户端；此处仅适用于兼容入口。</div>}
      <div className="pg-workspace">
        <aside className="pg-controls" id="pg-control-body" aria-label="请求参数">
          <div className="pg-control-heading">请求参数</div>
          <div className="pg-control-body">
            <div className="pg-field"><span>温度 <b>{temperature.toFixed(1)}</b></span><Slider aria-label="温度" minValue={0} maxValue={2} step={0.1} value={temperature} isDisabled={running} onChange={value => setTemperature(Array.isArray(value) ? value[0] : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><div className="pg-range-values"><small>0</small><small>2</small></div></div>
            <div className="pg-field"><span>最大输出 Tokens</span><Input disabled={running} type="number" min="1" max="1000000" aria-label="最大 token 数" value={maxTokens} onChange={event => setMaxTokens(Number(event.target.value))} /></div>
            <div className="pg-stream"><span>流式输出 <small>SSE</small></span><Switch aria-label="流式响应" disabled={running} checked={stream} onChange={event => setStream(event.target.checked)} /></div>
            <div className="pg-field"><span>系统提示</span><TextArea disabled={running} aria-label="系统提示" value={system} rows={5} onChange={event => setSystem(event.target.value)} /></div>
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
        </aside>
        <section className="pg-chat" aria-label="响应与对话">
          <header className="pg-chat-head">
            <code><b>POST</b> /v1/chat/completions</code>
            <div className="pg-chat-tools"><span>{running ? <><Spinner size="sm" />处理中</> : messages.length ? `${messages.filter(message => message.role === "user").length} 次对话` : ""}</span>
              <Button type="button" size="sm" variant="tertiary" isIconOnly title="重试最后一条" aria-label="重试最后一条" disabled={running || !messages.some(message => message.role === "user")} onClick={retry}><RotateCcw size={15} /></Button>
              <Button type="button" size="sm" variant="tertiary" isIconOnly title="新会话，保留输入草稿" aria-label="开启新会话" disabled={running || !messages.length} onClick={newConversation}><Trash2 size={15} /></Button>
              <Button type="button" size="sm" variant="tertiary" isIconOnly title="导出 cURL" aria-label="导出 cURL" onClick={() => setCurlOpen(true)}><Download size={15} /></Button>
            </div>
          </header>
          <div className="pg-messages" ref={messageList} role="log" aria-label="测试对话" onScroll={event => { const node = event.currentTarget; followOutput.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96; }}>
            {!messages.length && <div className="pg-welcome"><h3>发送请求</h3><p>选择模型，在下方输入消息。</p><div><Button variant="tertiary" size="sm" onClick={() => setInput("你好，请简短介绍一下你自己。")}>简短问答</Button><Button variant="tertiary" size="sm" onClick={() => setInput("请用三个要点解释 SSE 流式输出。")}>流式输出</Button></div></div>}
            {messages.map(message => <MessageView key={message.id} message={message} />)}
          </div>
        <form
          className="pg-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {budgetError && <div className="pg-budget-error" role="alert"><p>{budgetError}</p>{messages.length > 0 && <Button type="button" size="sm" variant="secondary" onClick={newConversation}>开启新会话，保留待发内容</Button>}</div>}
          {image && (
            <div className="pg-attachment">
              <img src={image} alt="待发送附件" />
              <span>图片已附加</span>
              <Button
                type="button"
                onClick={() => { setImage(null); setBudgetError(null); }}
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
            onChange={(e) => { setInput(e.target.value); setBudgetError(null); }}
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
            <small>单图 ≤ 1 MiB · 会话请求 ≤ 2 MiB</small>
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
        </section>
      </div>
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
