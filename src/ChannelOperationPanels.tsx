import { useEffect, useState } from "react";
import { Card, Chip, Spinner, Table } from "@heroui/react";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  FileClock,
  History,
  KeyRound,
  Layers,
  LockKeyhole,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
function Metric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="cop-metric">
      <span>
        <Icon size={15} />
        {label}
      </span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </Card>
  );
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
      <div className="cop-metrics">
        <Metric
          icon={ShieldCheck}
          label="HTTP 状态"
          value={httpStatus(data.status)}
          hint="上游响应状态"
        />
        <Metric
          icon={Waves}
          label="有效首字延迟"
          value={seconds(ttft, nonStream ? "不适用" : "未检测到")}
          hint={nonStream ? "非流式请求查看完成耗时" : "从请求开始到有效内容"}
        />
        <Metric
          icon={Clock3}
          label="请求完成耗时"
          value={seconds(data.duration)}
          hint="包含本次请求的全部尝试"
        />
      </div>
      {error && (
        <div className="cop-error-note">
          <CircleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
      {!!attempts.length && (
        <div className="cop-attempts">
          <div className="cop-title-inline">
            <Layers size={15} />
            <h4>请求轨迹</h4>
            <Chip size="sm">{attempts.length} 次尝试</Chip>
          </div>
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
        </div>
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
  onTest,
  onPlayground,
}: {
  channel: GatewayChannel;
  model: string;
  onModelChange: (model: string) => void;
  stream: boolean;
  onStreamChange: (stream: boolean) => void;
  busy: boolean;
  result: unknown;
  onTest: () => void;
  onPlayground?: () => void;
}) {
  return (
    <div className="cop-panel">
      <PanelSection
        title="测试请求"
        description="使用这个渠道的真实配置发送请求，记录响应状态、有效首字与完成耗时。"
        icon={Play}
      >
        <div className="cop-channel-summary">
          <div>
            <strong>{channel.name}</strong>
            <small>
              {channel.provider} · {channel.models.length} 个模型
            </small>
          </div>
          <Chip size="sm">渠道直测</Chip>
        </div>
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
        <div className="cop-mode-grid" role="group" aria-label="测试响应模式">
          <Button
            className="cop-mode"
            variant={stream ? "primary" : "secondary"}
            aria-pressed={stream}
            disabled={busy}
            onClick={() => onStreamChange(true)}
          >
            <Waves size={20} />
            <span>
              <strong>SSE 流式</strong>
              <small>检测有效首字与完整输出</small>
            </span>
            {stream && <Check size={15} />}
          </Button>
          <Button
            className="cop-mode"
            variant={!stream ? "primary" : "secondary"}
            aria-pressed={!stream}
            disabled={busy}
            onClick={() => onStreamChange(false)}
          >
            <MessageSquare size={20} />
            <span>
              <strong>非流式</strong>
              <small>检测整段响应与完成耗时</small>
            </span>
            {!stream && <Check size={15} />}
          </Button>
        </div>
      </PanelSection>
      <PanelSection
        title="检测流程"
        description="渠道直测会在当前渠道内重试，不跨渠道回退。"
        icon={Activity}
      >
        <div className="cop-process">
          <span>
            <LockKeyhole size={16} />
            协议与密钥
          </span>
          <ArrowRight size={15} />
          <span>
            <Waves size={16} />
            {stream ? "首字检测" : "响应检测"}
          </span>
          <ArrowRight size={15} />
          <span>
            <FileClock size={16} />
            记录日志
          </span>
        </div>
      </PanelSection>
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
      ) : (
        <PanelEmpty
          icon={Activity}
          title="等待测试"
          description="发送请求后，在这里查看检测结果和每次尝试的轨迹。"
        />
      )}
      <footer className="cop-footer">
        {onPlayground && (
          <Button variant="secondary" disabled={busy} onClick={onPlayground}>
            <MessageSquare size={15} />
            打开测试场
          </Button>
        )}
        <Button variant="primary" disabled={busy || !model} onClick={onTest}>
          {busy ? <Spinner size="sm" /> : <Play size={15} />}
          {busy ? "测试中…" : "发送测试请求"}
        </Button>
      </footer>
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
      <div className="cop-metrics">
        <Metric
          icon={History}
          label="测试记录"
          value={data?.total ?? logs.length}
          hint="来自真实渠道请求日志"
        />
        <Metric
          icon={CheckCheck}
          label="本页成功率"
          value={
            logs.length
              ? `${Math.round((succeeded / logs.length) * 100)}%`
              : "—"
          }
          hint={
            logs.length
              ? `${succeeded} / ${logs.length} 次完成`
              : "暂无测试记录"
          }
        />
        <Metric
          icon={Waves}
          label="本页平均首字"
          value={seconds(average)}
          hint={`${measured.length} 个有效流式样本`}
        />
      </div>
      {logs.length ? (
        <Table>
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
      <p className="cop-help">
        历史记录包含成功、异常和慢响应。首字只统计有效的流式内容。
      </p>
    </div>
  );
}

export function ChannelCredentialsPanel({
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
  onCancelRotate,
  onSubmit,
}: {
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
  onCancelRotate: () => void;
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
  const totalFailures = credentials.reduce(
    (count, key) => count + key.failureCount,
    0,
  );
  const current = credentials.find((key) => key.id === rotating);
  return (
    <div className="cop-panel">
      <div className="cop-metrics">
        <Metric
          icon={KeyRound}
          label="上游密钥"
          value={credentials.length}
          hint="独立管理每一把密钥"
        />
        <Metric
          icon={ShieldCheck}
          label="当前启用"
          value={available}
          hint={`${credentials.length - available} 把已停用`}
        />
        <Metric
          icon={CircleAlert}
          label="连续失败合计"
          value={totalFailures}
          hint="各密钥当前失败计数之和"
        />
      </div>
      <PanelSection
        title="密钥列表"
        description="密钥加密保存在 D1，只显示掩码，保存后无法读取原文。复制渠道不会复制密钥。"
        icon={LockKeyhole}
      >
        <div className="cop-credentials">
          {credentials.length ? (
            credentials.map((key) => (
              <Card
                className="cop-credential"
                key={key.id}
                data-rotating={rotating === key.id || undefined}
              >
                <div className="cop-credential-heading">
                  <span className="cop-credential-icon">
                    <KeyRound size={18} />
                  </span>
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
              </Card>
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
        description={
          rotating
            ? `替换「${current?.label || label}」的密钥原文，保留同一密钥记录。`
            : "为密钥设置易识别的名称，方便区分环境或用途。"
        }
        icon={rotating ? RefreshCw : KeyRound}
        action={
          rotating ? (
            <Chip color="accent" size="sm">
              轮换模式
            </Chip>
          ) : undefined
        }
      >
        <form
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
          <p className="cop-help">
            <LockKeyhole size={13} />
            显示按钮只用于本次输入的内容；已保存的密钥保持掩码。
          </p>
          <footer className="cop-footer">
            {rotating && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={onCancelRotate}
              >
                取消轮换
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !label.trim() || !secret.trim()}
            >
              {busy ? (
                <Spinner size="sm" />
              ) : rotating ? (
                <RefreshCw size={15} />
              ) : (
                <KeyRound size={15} />
              )}
              {busy ? "保存中…" : rotating ? "确认轮换" : "添加密钥"}
            </Button>
          </footer>
        </form>
      </PanelSection>
    </div>
  );
}

export function ChannelDeletePanel({
  channel,
  confirmation,
  onConfirmationChange,
  busy,
  onDelete,
  onClose,
}: {
  channel: GatewayChannel;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  busy: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const matches = confirmation === channel.name;
  return (
    <div className="cop-panel">
      <Card className="cop-delete-summary">
        <div className="cop-title-inline">
          <Trash2 size={21} />
          <div>
            <h3>永久删除这个渠道</h3>
            <p>此操作无法撤销，请确认影响范围。</p>
          </div>
        </div>
        <strong>{channel.name}</strong>
        <div className="cop-delete-tags">
          <Chip size="sm">{channel.provider}</Chip>
          <Chip size="sm">{channel.models.length} 个模型</Chip>
          {channel.tags.map((tag) => (
            <Chip key={tag} size="sm">
              {tag}
            </Chip>
          ))}
        </div>
      </Card>
      <PanelSection title="删除后的影响" icon={CircleAlert}>
        <ul className="cop-impact">
          <li>
            <Trash2 size={17} />
            <div>
              <strong>移除渠道配置</strong>
              <small>该渠道将退出路由候选列表，不能继续接收请求。</small>
            </div>
          </li>
          <li>
            <KeyRound size={17} />
            <div>
              <strong>移除 {channel.credentialCount} 把上游密钥</strong>
              <small>密钥将随渠道删除，重新创建渠道时需要重新添加。</small>
            </div>
          </li>
          <li>
            <FileClock size={17} />
            <div>
              <strong>保留历史请求日志</strong>
              <small>已产生的请求记录保留，可用于后续排查和追溯。</small>
            </div>
          </li>
        </ul>
      </PanelSection>
      <PanelSection
        title="确认渠道名称"
        description="输入下方显示的完整名称，名称必须完全一致。"
        icon={ShieldCheck}
      >
        <code className="cop-confirm-name">{channel.name}</code>
        <label className="cop-field">
          <span>渠道名称</span>
          <Input
            aria-label="确认删除的渠道名称"
            aria-invalid={!!confirmation && !matches}
            disabled={busy}
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            autoComplete="off"
            placeholder="请输入完整渠道名称"
          />
        </label>
        <div
          className={`cop-match ${matches ? "cop-match-success" : confirmation ? "cop-match-danger" : ""}`}
          role="status"
        >
          {matches ? <Check size={15} /> : <CircleAlert size={15} />}
          {matches
            ? "名称匹配，可以确认删除"
            : confirmation
              ? "名称尚未匹配，请检查大小写和空格"
              : "填写渠道名称后才能删除"}
        </div>
      </PanelSection>
      <footer className="cop-footer">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button variant="danger" disabled={busy || !matches} onClick={onDelete}>
          {busy ? <Spinner size="sm" /> : <Trash2 size={15} />}
          {busy ? "删除中…" : "永久删除渠道"}
        </Button>
      </footer>
    </div>
  );
}
