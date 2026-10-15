import { useEffect, useId, useRef, useState } from "react";
import { Card, Spinner, Table } from "@heroui/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { GatewayLog } from "../shared/types";
import { Button, Dialog, Input, Select } from "./ui";
import "./request-logs.css";

const results = { success: "成功", error: "失败", slow: "响应缓慢", failover: "已切换" };
const sources = { api: "API 调用", playground: "测试场", probe: "健康探测" };
const number = (value: number) => value.toLocaleString("zh-CN");
const duration = (value: number) => value.toFixed(2);
const queryBytes = (value: string) => new TextEncoder().encode(value).byteLength;
const MAX_QUERY_BYTES = 48;
function timestamp(value: string) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }),
    time: date.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    full: date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
  };
}

type Props = {
  logs: GatewayLog[];
  total: number;
  query: string;
  result: string;
  page: number;
  loading: boolean;
  clearing: boolean;
  onQuery: (value: string) => void;
  onResult: (value: string) => void;
  onPage: (value: number) => void;
  onOpen: (id: string) => void;
  onClear: () => Promise<void>;
};

export default function RequestLogs({ logs, total, query, result, page, loading, clearing, onQuery, onResult, onPage, onOpen, onClear }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query);
  const [queryError, setQueryError] = useState("");
  const composing = useRef(false);
  const searchHelpId = useId();
  useEffect(() => {
    if (!composing.current) { setSearchDraft(query); setQueryError(""); }
  }, [query]);
  const filtered = Boolean(query || result);
  const pages = Math.max(1, Math.ceil(total / 25));
  function updateSearch(value: string) {
    setSearchDraft(value);
    if (composing.current) return;
    if (queryBytes(value) > MAX_QUERY_BYTES) {
      setQueryError("搜索词过长，最多 48 个英文字符或 16 个汉字；混合输入请适当缩短。下方保留上一次有效搜索的结果。");
      return;
    }
    setQueryError("");
    onQuery(value);
  }
  function resetFilters() {
    setSearchDraft(""); setQueryError(""); onQuery(""); onResult("");
  }
  async function clear() {
    try { await onClear(); setConfirmClear(false); } catch { /* The parent displays the error and retains the records. */ }
  }
  return (
    <>
      <Card className="rl-panel" aria-busy={loading || clearing}>
        <div className="rl-toolbar">
          <div className="rl-search">
            <Search size={17} aria-hidden />
            <Input
              type="search"
              aria-label="搜索请求日志"
              placeholder="搜索请求 ID、模型或渠道…"
              value={searchDraft}
              disabled={clearing}
              aria-describedby={searchHelpId}
              aria-invalid={Boolean(queryError)}
              onChange={(event) => updateSearch(event.target.value)}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={(event) => { composing.current = false; updateSearch(event.currentTarget.value); }}
            />
          </div>
          <Select aria-label="请求结果" className="rl-result-select" value={result} disabled={clearing} onChange={(event) => onResult(event.target.value)}>
            <option value="">全部结果</option>
            {Object.entries(results).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <div className="rl-record-count" role="status" aria-live="polite">
            {loading ? <><Spinner size="sm" /> 正在加载</> : <><strong>{number(total)}</strong> 条记录</>}
          </div>
          <Button className="rl-clear" variant="ghost" size="sm" disabled={clearing || (loading && !logs.length) || (!filtered && !total)} onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} />清空日志
          </Button>
        </div>
        <div id={searchHelpId} className={`rl-search-help ${queryError ? "rl-search-error" : ""}`} role={queryError ? "alert" : undefined}>{queryError || "支持请求 ID、模型和渠道名称；最多 48 个英文字符或 16 个汉字，混合输入请适当缩短。"}</div>
        {filtered && (
          <div className="rl-filter-hint">
            <span>筛选结果{query ? ` · “${query}”` : ""}{result ? ` · ${results[result as keyof typeof results]}` : ""}</span>
            <Button variant="ghost" size="sm" disabled={clearing} onClick={resetFilters}><X size={13} />重置筛选</Button>
          </div>
        )}
        {logs.length > 0 && <Table variant="secondary" className="rl-table-root">
          <Table.ScrollContainer>
            <Table.Content aria-label="请求日志" className="rl-table" onRowAction={(id) => { if (!clearing && !loading) onOpen(String(id)); }}>
              <Table.Header>
                <Table.Column id="time">时间</Table.Column>
                <Table.Column id="model" isRowHeader>模型 / 请求 ID</Table.Column>
                <Table.Column id="channel">渠道 / 来源</Table.Column>
                <Table.Column id="latency">耗时</Table.Column>
                <Table.Column id="tokens" className="rl-numeric">Tokens</Table.Column>
                <Table.Column id="result">结果</Table.Column>
                <Table.Column id="trace" aria-label="查看请求追踪"><span className="rl-trace-heading">追踪</span></Table.Column>
              </Table.Header>
              <Table.Body>
                {logs.map((log) => {
                  const time = timestamp(log.createdAt);
                  const Icon = log.result === "error" ? XCircle : log.result === "slow" ? Clock3 : log.result === "failover" ? ArrowRight : Check;
                  return (
                    <Table.Row key={log.id} id={log.id} className={`rl-row rl-row-${log.result}`}>
                      <Table.Cell>
                        <time className="rl-time" dateTime={log.createdAt} title={time.full}><strong>{time.time}</strong><span>{time.date}</span></time>
                      </Table.Cell>
                      <Table.Cell>
                        <strong className="rl-model" title={log.model}>{log.model}</strong>
                        <code className="rl-request-id" title={log.id}>{log.id.slice(0, 16)}</code>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="rl-channel" title={log.channel || "未选中渠道"}>{log.channel || "未选中渠道"}</span>
                        <span className="rl-source"><span>{sources[log.source]}</span><span className="rl-format">{log.stream ? "SSE" : "JSON"}</span></span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="rl-duration">{duration(log.duration)}<small>s</small></span>
                        <span className="rl-secondary">首字 <span className="rl-mono">{log.stream && log.ttft > 0 ? `${duration(log.ttft)} s` : "—"}</span></span>
                      </Table.Cell>
                      <Table.Cell className="rl-numeric"><span className="rl-token-value">{number(log.tokens)}</span></Table.Cell>
                      <Table.Cell>
                        <span className={`rl-status rl-status-${log.result}`} title={log.error || results[log.result]}><Icon size={12} aria-hidden />{results[log.result]}</span>
                        <span className={`rl-http ${log.status >= 400 ? "rl-http-error" : ""}`}>HTTP <span>{log.status}</span></span>
                      </Table.Cell>
                      <Table.Cell>
                        <Button className="rl-trace" variant="ghost" size="sm" aria-label={`查看请求 ${log.id}，${log.attempts} 次尝试`} disabled={clearing || loading} onClick={(event) => { event.stopPropagation(); onOpen(log.id); }}>
                          <span>详情</span><ChevronRight size={14} />
                        </Button>
                        <span className="rl-secondary rl-attempts">{log.attempts} 次尝试</span>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>}
        {!logs.length && (
          <div className="rl-empty" role="status">
            {loading ? <Spinner /> : <span className="rl-empty-icon"><FileSearch size={27} /></span>}
            <strong>{loading ? "正在加载请求日志" : filtered ? "没有找到匹配的请求" : "还没有请求日志"}</strong>
            <p>{loading ? "请稍候…" : filtered ? "试试其他关键词，或重置筛选条件。" : "通过网关发起请求后，可以在这里查看耗时、结果和渠道追踪。"}</p>
            {!loading && filtered && <Button size="sm" variant="secondary" onClick={resetFilters}>重置筛选</Button>}
          </div>
        )}
        <div className="rl-footer">
          <span className="rl-range">{total ? `${number((page - 1) * 25 + 1)}–${number(Math.min(page * 25, total))} / ${number(total)} 条` : "0 条记录"}<span>每页 25 条 · 北京时间</span></span>
          <div className="rl-pagination">
            <Button variant="secondary" size="sm" isIconOnly aria-label="上一页日志" disabled={page <= 1 || loading || clearing} onClick={() => onPage(page - 1)}><ArrowLeft size={15} /></Button>
            <span><strong>{page}</strong> / {pages}</span>
            <Button variant="secondary" size="sm" isIconOnly aria-label="下一页日志" disabled={page >= pages || loading || clearing} onClick={() => onPage(page + 1)}><ArrowRight size={15} /></Button>
          </div>
        </div>
      </Card>
      {confirmClear && (
        <Dialog title="清空全部请求日志" subtitle="清空后无法恢复，请确认不再需要这些记录。" close={() => { if (!clearing) setConfirmClear(false); }} className="rl-clear-dialog" footer={
          <><Button disabled={clearing} onClick={() => setConfirmClear(false)}>取消</Button><Button variant="danger" disabled={clearing} onClick={() => void clear()}>{clearing ? <Spinner size="sm" /> : <Trash2 size={15} />}{clearing ? "正在清空…" : "确认清空"}</Button></>
        }>
          <div className="rl-clear-notice"><span><Trash2 size={21} /></span><div><strong>删除所有日志和请求追踪详情</strong><p>包括当前筛选之外的记录。基于日志生成的用量统计也会清空。</p></div></div>
        </Dialog>
      )}
    </>
  );
}
