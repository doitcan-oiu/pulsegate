import { useEffect, useState } from "react";
import { Chip, Spinner, Table } from "@heroui/react";
import {
  Activity,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  FileClock,
  History,
  KeyRound,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  AttemptRecord,
  CredentialMeta,
  GatewayChannel,
  GatewayLog,
} from "../shared/types";
import { Button, Input, Select, toast } from "./ui";
import { PanelEmpty, PanelSection } from "./ChannelPanelUI";
import { api } from "./api";
import "./channel-operation-panels.css";

type LogDetail = { log: GatewayLog; attempts: AttemptRecord[] };
type ResultShape = {
  success?: boolean;
  status?: number;
  ttft?: number | null;
  duration?: number | null;
  error?: string | null;
  requestId?: string;
  attempts?: AttemptRecord[];
};
const resultLabels: Record<string, string> = {
  success: "成功",
  slow: "响应偏慢",
  failover: "故障转移",
  error: "失败",
  empty: "空响应",
  cancelled: "已取消",
};
function resultColor(
  result: string,
): "success" | "warning" | "danger" | "default" {
  return result === "success"
    ? "success"
    : result === "error" || result === "empty"
      ? "danger"
      : result === "slow" || result === "failover"
        ? "warning"
        : "default";
}
function seconds(value: unknown, empty = "—") {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toFixed(2)} s`
    : empty;
}
function httpStatus(value: unknown) {
  return typeof value === "number" && value >= 100 && value <= 599
    ? String(value)
    : "未收到响应";
}
function dateText(value: string | null | undefined) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
function errorText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer ••••")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "sk-••••")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}
export function TestResult({ result }: { result: unknown }) {
  if (!result || typeof result !== "object")
    return (
      <PanelEmpty
        icon={CircleAlert}
        title="暂无检测结果"
        description="完成请求后会显示实际状态与耗时。"
      />
    );
  const data = result as ResultShape;
  const attempts = Array.isArray(data.attempts) ? data.attempts : [];
  const lastAttempt = attempts.at(-1);
  const hasMeasuredFirstToken = attempts.some(
    (attempt) => attempt.ttft != null,
  );
  const nonStream = lastAttempt?.stream === false;
  const ttft =
    nonStream || (attempts.length && !hasMeasuredFirstToken) ? null : data.ttft;
  const slow = lastAttempt?.result === "slow";
  const outcome =
    data.success === true
      ? slow
        ? "响应偏慢"
        : "测试成功"
      : data.success === false
        ? "测试失败"
        : "检测结果";
  const error = errorText(data.error);
  return (
    <section className="cop-test-result" aria-label="渠道检测结果">
      <div className="cop-result-title">
        <div className="cop-title-inline">
          <Activity size={17} />
          <h3>检测结果</h3>
        </div>
        <Chip
          color={
            data.success === true
              ? slow
                ? "warning"
                : "success"
              : data.success === false
                ? "danger"
                : "default"
          }
          size="sm"
        >
          <Chip.Label>{outcome}</Chip.Label>
        </Chip>
      </div>
      <dl className="cop-result-metrics">
        <div><dt>HTTP 状态</dt><dd>{httpStatus(data.status)}</dd></div>
        <div><dt>有效首字</dt><dd>{seconds(ttft, nonStream ? "不适用" : "未检测到")}</dd></div>
        <div><dt>完成耗时</dt><dd>{seconds(data.duration)}</dd></div>
      </dl>
      {error && (
        <div className="cop-error-note">
          <CircleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
      {!!attempts.length && (
        <details className="cop-attempts">
          <summary>请求轨迹 · {attempts.length} 次尝试</summary>
          <ol>
            {attempts.map((attempt, index) => (
              <li key={attempt.id || index}>
                <span className="cop-attempt-step">
                  {attempt.attempt || index + 1}
                </span>
                <div className="cop-attempt-main">
                  <div>
                    <strong>{attempt.channelName || "当前渠道"}</strong>
                    <Chip color={resultColor(attempt.result)} size="sm">
                      <Chip.Label>
                        {resultLabels[attempt.result] || "未知结果"}
                      </Chip.Label>
                    </Chip>
                  </div>
                  <small>
                    {attempt.model} · {attempt.stream ? "SSE 流式" : "非流式"} ·
                    HTTP {httpStatus(attempt.status)}
                  </small>
                  {attempt.error && (
                    <p className="cop-attempt-error">
                      {errorText(attempt.error)}
                    </p>
                  )}
                </div>
                <div className="cop-attempt-time">
                  <strong>
                    {attempt.stream
                      ? seconds(attempt.ttft, "无有效首字")
                      : "非流式响应"}
                  </strong>
                  <small>完成 {seconds(attempt.duration)}</small>
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
      {data.requestId && (
        <p className="cop-request-id">
          请求 ID <code>{data.requestId}</code>
        </p>
      )}
    </section>
  );
}

export function ChannelTestPanel({
  channel,
  model,
  onModelChange,
  stream,
  onStreamChange,
  busy,
  result,
}: {
  channel: GatewayChannel;
  model: string;
  onModelChange: (model: string) => void;
  stream: boolean;
  onStreamChange: (stream: boolean) => void;
  busy: boolean;
  result: unknown;
}) {
  return (
    <div className="cop-panel">
      <div className="cop-test-fields">
        <label className="cop-field">
          <span>测试模型</span>
          <Select
            aria-label="测试模型"
            value={model}
            disabled={busy}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {channel.models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </label>
        <label className="cop-field">
          <span>响应模式</span>
          <Select
            aria-label="测试响应模式"
            value={stream ? "stream" : "complete"}
            disabled={busy}
            onChange={(event) => onStreamChange(event.target.value === "stream")}
          >
            <option value="stream">SSE 流式</option>
            <option value="complete">非流式</option>
          </Select>
        </label>
      </div>
      <p className="cop-help">使用当前渠道配置测试并记录日志，不跨渠道回退。</p>
      {busy ? (
        <div className="cop-loading" role="status">
          <Spinner size="sm" />
          <div>
            <strong>正在发送测试请求</strong>
            <small>等待上游返回并完成健康检测…</small>
          </div>
        </div>
      ) : result != null ? (
        <TestResult result={result} />
      ) : null}
    </div>
  );
}

export function TestHistory({
  result,
  busy,
}: {
  result: unknown;
  busy: boolean;
}) {
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const data =
    result && typeof result === "object"
      ? (result as { logs?: GatewayLog[]; total?: number })
      : null;
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const succeeded = logs.filter((log) => log.result !== "error").length;
  const measured = logs.filter(
    (log) => log.stream && Number.isFinite(log.ttft) && log.ttft > 0,
  );
  const average = measured.length
    ? measured.reduce((sum, log) => sum + log.ttft, 0) / measured.length
    : null;
  async function showDetail(id: string) {
    setLoadingId(id);
    try {
      setDetail(await api<LogDetail>(`/api/logs/${encodeURIComponent(id)}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "详情加载失败");
    } finally {
      setLoadingId(null);
    }
  }
  if (busy)
    return (
      <div className="cop-loading" role="status">
        <Spinner size="sm" />
        <div>
          <strong>正在读取测试历史</strong>
          <small>加载实际请求日志与检测记录…</small>
        </div>
      </div>
    );
  return (
    <div className="cop-panel cop-history">
      {logs.length > 0 && <p className="cop-help">共 {data?.total ?? logs.length} 条 · 本页成功 {succeeded}/{logs.length} · 平均首字 {seconds(average)}</p>}
      {logs.length ? (
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content
              className="cop-history-table"
              aria-label="渠道测试历史"
            >
              <Table.Header>
                <Table.Column id="time" isRowHeader>
                  时间
                </Table.Column>
                <Table.Column id="model">模型 / 模式</Table.Column>
                <Table.Column id="result">结果</Table.Column>
                <Table.Column id="ttft">有效首字</Table.Column>
                <Table.Column id="duration">完成耗时</Table.Column>
                <Table.Column id="status">HTTP</Table.Column>
                <Table.Column id="actions">操作</Table.Column>
              </Table.Header>
              <Table.Body>
                {logs.map((log) => (
                  <Table.Row
                    id={log.id}
                    key={log.id}
                    textValue={`${log.model} ${resultLabels[log.result]}`}
                  >
                    <Table.Cell>{dateText(log.createdAt)}</Table.Cell>
                    <Table.Cell>
                      <div className="cop-history-model">
                        <strong>{log.model}</strong>
                        <small>
                          {log.stream ? "SSE 流式" : "非流式"} · {log.attempts}{" "}
                          次尝试
                        </small>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip color={resultColor(log.result)} size="sm">
                        <Chip.Label>
                          {resultLabels[log.result] || "未知结果"}
                        </Chip.Label>
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {log.stream
                        ? seconds(
                            log.result === "error" && !log.ttft
                              ? null
                              : log.ttft,
                          )
                        : "—"}
                    </Table.Cell>
                    <Table.Cell>{seconds(log.duration)}</Table.Cell>
                    <Table.Cell>{httpStatus(log.status)}</Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        disabled={loadingId != null}
                        onClick={() => void showDetail(log.id)}
                      >
                        {loadingId === log.id ? (
                          <Spinner size="sm" />
                        ) : (
                          <History size={14} />
                        )}
                        详情
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <PanelEmpty
          icon={History}
          title="尚无测试历史"
          description="发送一次渠道测试请求，检测结果会保存在这里。"
        />
      )}
      {detail && (
        <PanelSection
          title="请求详情"
          description={`${detail.log.model} · ${dateText(detail.log.createdAt)}`}
          icon={FileClock}
          action={
            <Button
              isIconOnly
              variant="ghost"
              aria-label="收起请求详情"
              onClick={() => setDetail(null)}
            >
              <X size={16} />
            </Button>
          }
        >
          <TestResult
            result={{
              success: detail.log.result !== "error",
              status: detail.log.status,
              ttft: detail.log.stream ? detail.log.ttft : null,
              duration: detail.log.duration,
              error: detail.log.error,
              requestId: detail.log.id,
              attempts: detail.attempts,
            }}
          />
        </PanelSection>
      )}
    </div>
  );
}

export function ChannelCredentialsPanel({
  formId,
  credentials,
  busy,
  label,
  onLabelChange,
  secret,
  onSecretChange,
  rotating,
  onRotate,
  onToggle,
  onDelete,
  onSubmit,
}: {
  formId: string;
  credentials: CredentialMeta[];
  busy: boolean;
  label: string;
  onLabelChange: (value: string) => void;
  secret: string;
  onSecretChange: (value: string) => void;
  rotating: string | null;
  onRotate: (key: CredentialMeta) => void;
  onToggle: (key: CredentialMeta) => void;
  onDelete: (key: CredentialMeta) => void;
  onSubmit: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  useEffect(() => {
    setShowSecret(false);
  }, [rotating]);
  useEffect(() => {
    if (!secret) setShowSecret(false);
  }, [secret]);
  const available = credentials.filter((key) => key.enabled).length;
  const current = credentials.find((key) => key.id === rotating);
  return (
    <div className="cop-panel">
      <PanelSection
        title={`密钥列表 · ${available}/${credentials.length} 已启用`}
        description="保存后仅显示掩码，复制渠道不会复制密钥。"
      >
        <div className="cop-credentials">
          {credentials.length ? (
            credentials.map((key) => (
              <article
                className="cop-credential"
                key={key.id}
                data-rotating={rotating === key.id || undefined}
              >
                <div className="cop-credential-heading">
                  <div>
                    <strong>{key.label}</strong>
                    <code>{key.preview}</code>
                  </div>
                  <Chip color={key.enabled ? "success" : "default"} size="sm">
                    <Chip.Label>{key.enabled ? "已启用" : "已停用"}</Chip.Label>
                  </Chip>
                  {rotating === key.id && (
                    <Chip color="accent" size="sm">
                      正在轮换
                    </Chip>
                  )}
                </div>
                <div className="cop-credential-facts">
                  <span>
                    连续失败 <b>{key.failureCount}</b>
                  </span>
                  <span>创建于 {dateText(key.createdAt)}</span>
                </div>
                {key.reason && (
                  <p className="cop-credential-reason">
                    <CircleAlert size={13} />
                    {errorText(key.reason)}
                  </p>
                )}
                {key.disabledAt && (
                  <small className="cop-help">
                    最近停用 {dateText(key.disabledAt)}
                  </small>
                )}
                <div className="cop-credential-actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onRotate(key)}
                  >
                    <RefreshCw size={14} />
                    轮换
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onToggle(key)}
                  >
                    {key.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    variant="danger-soft"
                    disabled={busy}
                    onClick={() => onDelete(key)}
                  >
                    <Trash2 size={14} />
                    删除
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <PanelEmpty
              icon={KeyRound}
              title="尚未添加上游密钥"
              description="在下方添加第一把密钥，用于访问该渠道的上游接口。"
            />
          )}
        </div>
      </PanelSection>
      <PanelSection
        title={rotating ? "轮换上游密钥" : "添加上游密钥"}
        description={rotating ? `替换「${current?.label || label}」的密钥，保留原记录。` : undefined}
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && label.trim() && secret.trim()) onSubmit();
          }}
        >
          <div className="cop-form-grid">
            <label className="cop-field">
              <span>密钥名称</span>
              <Input
                required
                disabled={busy}
                maxLength={100}
                value={label}
                onChange={(event) => onLabelChange(event.target.value)}
                placeholder="例如：生产密钥 01"
              />
            </label>
            <label className="cop-field">
              <span>{rotating ? "新的密钥" : "上游 API Key"}</span>
              <div className="cop-secret-input">
                <Input
                  required
                  disabled={busy}
                  type={showSecret ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={(event) => onSecretChange(event.target.value)}
                  placeholder="sk-…"
                />
                <Button
                  type="button"
                  variant="secondary"
                  isIconOnly
                  disabled={!secret || busy}
                  aria-label={
                    showSecret ? "隐藏本次输入的密钥" : "显示本次输入的密钥"
                  }
                  aria-pressed={showSecret}
                  onClick={() => setShowSecret((value) => !value)}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </label>
          </div>
        </form>
      </PanelSection>
    </div>
  );
}

export function ChannelDeletePanel({
  formId,
  channel,
  confirmation,
  onConfirmationChange,
  busy,
  onDelete,
}: {
  formId: string;
  channel: GatewayChannel;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  busy: boolean;
  onDelete: () => void;
}) {
  const matches = confirmation === channel.name;
  return (
    <form id={formId} className="cop-delete-form" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && matches) onDelete();
    }}>
      <p className="cop-delete-impact">
        渠道配置和 {channel.credentialCount} 把上游密钥将被永久删除，历史请求日志保留。此操作无法撤销。
      </p>
        <label className="cop-field">
          <span>输入渠道名称以确认删除</span>
          <Input
            aria-label="确认删除的渠道名称"
            aria-invalid={!!confirmation && !matches}
            disabled={busy}
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            autoComplete="off"
            placeholder={channel.name}
          />
        </label>
        <div
          className={`cop-match ${matches ? "cop-match-success" : confirmation ? "cop-match-danger" : ""}`}
          role="status"
        >
          {matches ? <Check size={15} /> : confirmation ? <CircleAlert size={15} /> : null}
          {matches
            ? "名称已匹配"
            : confirmation
              ? "名称尚未匹配，请检查大小写和空格"
              : "名称须完全一致，包括大小写和空格"}
        </div>
    </form>
  );
}
