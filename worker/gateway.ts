import type { AttemptRecord, GatewayChannel, GatewayLog, KeyProfile } from '../shared/types';
import type { Credential, GatewayContext, GatewayStore } from './env';
import { type ChatBody, normalizeJSON, normalizedStream, prepareBody, RequestFailure, toAnthropic, toGemini, upstreamHeaders, upstreamUrl, validateChatRequest } from './protocols';
import { meaningfulOpenAIChunk, sseBytes, StreamFailure } from './sse';
import { mockUpstream, sleep } from './mock';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const MAX_PREREAD = 1024 * 1024;
type Candidate = { channel: GatewayChannel; model: string };
type Failure = { status: number; message: string; kind: AttemptRecord['result']; retry: boolean };

export function channelInScope(channel: GatewayChannel, profile: KeyProfile | null): boolean {
  if (!profile || profile.scope === 'all') return true;
  if (profile.scope === 'channels') return profile.channelIds.includes(channel.id);
  if (!profile.tags.length) return false;
  const hits = profile.tags.map(t => channel.tags.includes(t));
  return profile.match === 'all' ? hits.every(Boolean) : profile.match === 'none' ? hits.every(v => !v) : hits.some(Boolean);
}

export function resolveChannelModel(channel: GatewayChannel, requested: string): string | null {
  const alias = channel.config.aliases.find(a => a.from === requested);
  if (alias) return alias.to;
  return channel.models.includes(requested) || channel.model === requested ? requested : null;
}

export function gatewayCandidates(context: GatewayContext, requested: string, includeUnavailable = false): Candidate[] {
  const targets = context.profile?.mappings.find(m => m.from === requested)?.to || [requested];
  const mapped = context.profile?.modelMode === 'selected' ? targets.filter(model => context.profile!.models.includes(model)) : targets;
  if (!mapped.length) return [];
  return context.channels.flatMap(channel => {
    if (channel.archived || !channelInScope(channel, context.profile)) return [];
    if (context.forceChannelId) { if (channel.id !== context.forceChannelId) return []; }
    else if (!includeUnavailable && (!channel.enabled || channel.health.autoDisabled || (context.settings.autoSwitch && channel.status !== 'healthy'))) return [];
    for (const model of mapped) { const resolved = resolveChannelModel(channel, model); if (resolved) return [{ channel, model: resolved }]; }
    return [];
  });
}

export async function orderedCandidates(candidates: Candidate[], context: GatewayContext, store: GatewayStore, scope: string, routingScope = scope, stream = true): Promise<Candidate[]> {
  const strategy = context.settings.strategy;
  const ordered = [...candidates].sort((a, b) => a.channel.priority - b.channel.priority || b.channel.weight - a.channel.weight || a.channel.id.localeCompare(b.channel.id));
  if (strategy === 'adaptive') ordered.sort((a, b) => {
    const score = (c: GatewayChannel) => (stream ? c.health.averageTtft ?? c.ttft ?? 1 : c.health.averageDuration ?? 1) * (1 + (100 - c.successRate) / 20) / Math.max(1, c.weight);
    return score(a.channel) - score(b.channel);
  });
  if (strategy === 'round-robin' && ordered.length) { const offset = (await store.nextRoundRobin(routingScope)) % ordered.length; ordered.push(...ordered.splice(0, offset)); }
  if (strategy === 'weighted') {
    // Exponential races implement weighted sampling without replacement, including failover order.
    const ranks = ordered.map(c => ({ c, rank: -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / Math.max(0.001, c.channel.weight) }));
    ranks.sort((a, b) => a.rank - b.rank); ordered.splice(0, ordered.length, ...ranks.map(r => r.c));
  }
  // A circuit in cooldown is excluded even when general quality-based auto switching is disabled.
  const available = strategy === 'circuit-breaker' ? ordered.filter(c => c.channel.status === 'healthy' || Date.parse(c.channel.health.cooldownUntil || '1970-01-01') <= Date.now()) : ordered;
  if (context.settings.stickyMode === 'prefer' && scope) {
    const sticky = await store.getSticky(scope); const index = available.findIndex(c => c.channel.id === sticky && c.channel.status === 'healthy');
    if (index > 0) available.unshift(...available.splice(index, 1));
  }
  return available;
}

async function boundedText(body: ReadableStream<Uint8Array> | null, max: number, signal?: AbortSignal, upstream = false): Promise<string> {
  if (!body) return '';
  const reader = body.getReader(), decoder = new TextDecoder(); let size = 0, text = '';
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) {
        if (upstream) throw new StreamFailure(`Upstream body exceeded ${max / 1024} KiB limit`);
        throw new RequestFailure(`Body exceeded ${max / 1024 / 1024} MiB limit`, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    return text + decoder.decode();
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function redact(message: string, secrets: string[]): string {
  let result = message;
  for (const secret of secrets) if (secret.length > 3) result = result.split(secret).join('[REDACTED]');
  return result.replace(/(Bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]').replace(/((?:api[_-]?key|token|authorization)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1[REDACTED]').slice(0, 4000);
}

export function publicError(context: GatewayContext, message: string): string {
  return context.settings.errorMode === 'raw' ? message : context.settings.errorMode === 'custom' ? context.settings.customErrorMessage || '服务器错误，请重试' : '上游服务暂时不可用，请稍后重试';
}
function seconds(start: number): number { return (Date.now() - start) / 1000; }
function timeLabel(date: Date) { return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
function usage(value: any) { return { inputTokens: Math.max(0, Number(value?.usage?.prompt_tokens) || 0), outputTokens: Math.max(0, Number(value?.usage?.completion_tokens) || 0) }; }
function estimatedBudget(channel: GatewayChannel, body: ChatBody): number {
  const effective = { ...body, ...channel.config.bodyOverrides };
  const max = effective.max_completion_tokens ?? effective.max_tokens ?? effective.generationConfig?.maxOutputTokens ?? 4096;
  if (!Number.isSafeInteger(max) || max <= 0) throw new RequestFailure('最大输出 Token 数必须为正整数');
  // Reserve the full submitted payload, including tool schemas; output is a reservation, usage logs remain provider-reported.
  return Math.ceil(JSON.stringify(effective).length / 3) + max;
}

export async function handleGateway(request: Request, context: GatewayContext, store: GatewayStore): Promise<Response> {
  const requestId = crypto.randomUUID(), requestStart = Date.now();
  let attempts = 0, lastCandidate: Candidate | null = null, lastFailure: Failure | null = null;
  let totalInput = 0, totalOutput = 0, lastTtft: number | null = null, latestDuration = 0;
  let original: ChatBody;
  const probeDeadlineExpired = () => context.source === 'probe' && request.signal.aborted && request.signal.reason?.name === 'TimeoutError';
  const cancelledFailure = (): Failure => ({ status: probeDeadlineExpired() ? 504 : 499, message: probeDeadlineExpired() ? '渠道探测整体响应超时' : '客户端取消了请求', kind: probeDeadlineExpired() ? 'error' : 'cancelled', retry: false });
  const errorResponse = (status: number, message: string) => Response.json({ error: { message, type: 'gateway_error', code: status === 403 ? 'scope_denied' : 'upstream_error', request_id: requestId } }, { status, headers: { 'x-pulsegate-request-id': requestId } });
  try {
    if (Number(request.headers.get('content-length')) > MAX_BODY) throw new RequestFailure('请求体不能超过 2 MiB', 413);
    const text = await boundedText(request.body, MAX_BODY, request.signal);
    try { original = JSON.parse(text); } catch { throw new RequestFailure('请求体必须为有效 JSON'); }
    validateChatRequest(original);
    const expiry = context.key?.expires ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(context.key.expires) ? `${context.key.expires}T23:59:59.999+08:00` : context.key.expires) : null;
    if (context.key && (!context.profile || context.key.status !== 'active' || (expiry !== null && Number.isFinite(expiry) && expiry <= Date.now()))) throw new RequestFailure('API Key 未启用、已过期或策略无效', 401);
  } catch (error) { return errorResponse(error instanceof RequestFailure ? error.status : request.signal.aborted ? 499 : 400, error instanceof Error ? error.message : '无效请求'); }

  const traceId = request.headers.get('x-trace-id')?.slice(0, 128) || null;
  const threadId = request.headers.get('x-thread-id')?.slice(0, 128) || null;
  const identity = `${context.key?.id || 'admin'}:${context.profile?.id || 'all'}:${original.model}`;
  const traceScope = traceId ? `${identity}:trace:${traceId}` : null, threadScope = threadId ? `${identity}:thread:${threadId}` : null;
  const scope = traceScope || threadScope || '';
  const recordEarlyError = async (status: number, message: string) => {
    const date = new Date();
    await store.recordLog({ id: requestId, createdAt: date.toISOString(), time: timeLabel(date), model: original.model,
      channel: '无可用渠道', channelId: null, apiKeyId: context.key?.id || null, stream: Boolean(original.stream),
      ttft: 0, duration: seconds(requestStart), tokens: 0, status, result: 'error', attempts: 0, source: context.source, traceId, error: message });
  };
  // Authorization describes allowed resources independently of their health or activation state.
  if (!gatewayCandidates(context, original.model, true).length) return errorResponse(403, '当前策略范围内没有支持该模型的授权渠道');
  let candidates = gatewayCandidates(context, original.model);
  // Trace affinity precedes thread affinity; scoped identity prevents affinity crossing Key profiles.
  if (scope && context.settings.stickyMode === 'prefer' && traceScope && threadScope && !await store.getSticky(traceScope)) {
    const prior = await store.getSticky(threadScope); if (prior && candidates.some(c => c.channel.id === prior && c.channel.status === 'healthy')) await store.setSticky(traceScope, prior);
  }
  candidates = await orderedCandidates(candidates, context, store, scope, identity, Boolean(original.stream));
  if (!candidates.length) {
    const message = '已授权模型的渠道均已停用、降级或暂时不可调度';
    await recordEarlyError(503, message); return errorResponse(503, publicError(context, message));
  }
  if (context.key && context.profile) {
    const limit = Number(context.profile.requestLimit) || 0;
    if (!await store.incrementKeyUsage(context.key.id, context.profile.id, Math.max(0, limit))) {
      const message = 'API Key 请求额度已用完或生效策略已变更';
      await recordEarlyError(429, message); return errorResponse(429, message);
    }
  }
  const secrets: string[] = [];
  const aigToken = context.env.AI_GATEWAY_TOKEN || await store.getAiGatewayToken(); if (aigToken) secrets.push(aigToken);
  const recordLog = async (status: number, error: string | null, success: boolean) => {
    const date = new Date(); const log: GatewayLog = {
      id: requestId, createdAt: date.toISOString(), time: timeLabel(date), model: original.model,
      channel: lastCandidate?.channel.name || '无可用渠道', channelId: lastCandidate?.channel.id || null, apiKeyId: context.key?.id || null,
      stream: Boolean(original.stream), ttft: lastTtft || 0, duration: seconds(requestStart), tokens: totalInput + totalOutput, status,
      result: success ? candidates.findIndex(c => c.channel.id === lastCandidate?.channel.id) > 0 ? 'failover' : original.stream ? (lastTtft || 0) > context.settings.threshold ? 'slow' : 'success' : latestDuration > context.settings.responseThreshold ? 'slow' : 'success' : 'error',
      attempts, source: context.source, traceId, error: error ? redact(error, secrets) : null,
    }; await store.recordLog(log);
  };
  const remember = async (channel: GatewayChannel, candidateIndex: number) => {
    if (context.settings.stickyMode === 'prefer') { if (traceScope) await store.setSticky(traceScope, channel.id); if (threadScope) await store.setSticky(threadScope, channel.id); }
    if (candidateIndex > 0) { const date = new Date(); await store.recordEvent({ id: crypto.randomUUID(), createdAt: date.toISOString(), time: timeLabel(date), title: '已切换备用渠道', description: `${channel.name} 已接管 ${original.model} 请求`, type: 'switch', channelId: channel.id }); }
  };
  const allowedChannels = context.settings.retryEnabled ? Math.min(candidates.length, 1 + Math.max(0, Math.min(10, context.settings.maxChannelRetries))) : 1;
  for (let candidateIndex = 0; candidateIndex < allowedChannels; candidateIndex++) {
    const candidate = candidates[candidateIndex]; lastCandidate = candidate;
    let channel = candidate.channel;
    let credentials = await store.getCredentials(channel.id, context.source === 'probe');
    if (context.forceCredentialId) {
      if (context.source !== 'probe') return errorResponse(403, '仅恢复探测允许指定上游密钥');
      credentials = credentials.filter(c => c.id === context.forceCredentialId);
    }
    secrets.push(...credentials.map(c => c.secret));
    if (!credentials.length && channel.config.protocol !== 'mock') { lastFailure = { status: 503, message: '渠道没有可用的上游密钥', kind: 'error', retry: true }; if (!context.settings.retryEnabled) break; continue; }
    if (channel.config.protocol === 'mock' && context.env.DEV_MODE !== 'true') { lastFailure = { status: 403, message: '演示渠道仅在 DEV_MODE=true 时启用', kind: 'error', retry: false }; break; }
    const credentialOffset = credentials.length > 1 && !context.forceCredentialId ? await store.nextRoundRobin(`credentials:${channel.id}`) : 0;
    const rounds = context.settings.retryEnabled ? 1 + Math.max(0, Math.min(5, context.settings.maxSameChannelRetries)) : 1;
    for (let round = 0; round < rounds; round++) {
      if (request.signal.aborted) { lastFailure = cancelledFailure(); break; }
      if (attempts > 0) {
        try { await sleep(Math.max(100, Math.min(10000, context.settings.retryDelayMs)), request.signal); }
        catch { lastFailure = cancelledFailure(); break; }
      }
      if (store.getChannel) {
        const fresh = await store.getChannel(channel.id);
        if (!fresh || fresh.archived || (!context.forceChannelId && (!fresh.enabled || fresh.health.autoDisabled || (context.settings.autoSwitch && fresh.status !== 'healthy')))) {
          lastFailure = { status: 503, message: '渠道已停用或健康状态已变化', kind: 'error', retry: true }; break;
        }
        // Revalidate tags and model support too, because channel edits can happen during backoff.
        const authorized = gatewayCandidates({ ...context, channels: [fresh] }, original.model)[0];
        if (!authorized) { lastFailure = { status: 403, message: '渠道已不在授权范围内或不再支持该模型', kind: 'error', retry: true }; break; }
        channel = authorized.channel; candidate.channel = channel; candidate.model = authorized.model;
      }
      // Re-read enabled credentials after every failed attempt: a state write may disable a key.
      if (channel.config.protocol === 'mock' && context.env.DEV_MODE !== 'true') { lastFailure = { status: 403, message: '演示渠道仅在 DEV_MODE=true 时启用', kind: 'error', retry: false }; break; }
      if ((round > 0 || store.getChannel) && channel.config.protocol !== 'mock') {
        credentials = await store.getCredentials(channel.id, context.source === 'probe');
        if (context.forceCredentialId) credentials = credentials.filter(c => c.id === context.forceCredentialId);
        secrets.push(...credentials.map(c => c.secret));
        if (!credentials.length) { lastFailure = { status: 503, message: '渠道没有可用的上游密钥', kind: 'error', retry: true }; break; }
      }
      if (request.signal.aborted) { lastFailure = cancelledFailure(); break; }
      const credential: Credential | null = credentials.length ? credentials[(credentialOffset + round) % credentials.length] : null;
      let estimatedTokens: number, body: ChatBody, payload: string, target = '', headers: Headers | undefined;
      try {
        // Local conversion/configuration failures are not upstream health samples. A different
        // authorized protocol can still support the same request within the channel budget.
        body = prepareBody(channel, original, candidate.model); validateChatRequest(body);
        const native = channel.config.protocol === 'anthropic' ? toAnthropic(body, channel) : channel.config.protocol === 'gemini' ? toGemini(body, channel) : body;
        payload = JSON.stringify(native); estimatedTokens = estimatedBudget(channel, body);
        if (channel.config.protocol !== 'mock') { target = upstreamUrl(channel, context.settings, candidate.model, Boolean(original.stream)); headers = upstreamHeaders(channel, credential!.secret, aigToken); }
      } catch (error) {
        lastFailure = { status: error instanceof RequestFailure ? error.status : 400, message: redact(error instanceof Error ? error.message : '渠道请求配置无效', secrets), kind: 'error', retry: true };
        break;
      }
      if (!await store.reserveChannel(channel, estimatedTokens)) { lastFailure = { status: 429, message: '渠道速率限制已触发', kind: 'error', retry: true }; break; }
      if (request.signal.aborted) { lastFailure = cancelledFailure(); break; }
      const attemptStart = Date.now(), startedAt = new Date(attemptStart).toISOString(); attempts++;
      const controller = new AbortController(); let timedOut = false, timeout: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) cancel();
      const timeoutSec = original.stream ? context.settings.streamFirstTokenTimeout : context.settings.nonStreamTimeout;
      if (timeoutSec > 0) timeout = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Upstream timeout', 'TimeoutError')); }, timeoutSec * 1000);
      const cleanup = () => { if (timeout !== undefined) clearTimeout(timeout); request.signal.removeEventListener('abort', cancel); };
      let iterator: AsyncGenerator<Record<string, any> | '[DONE]'> | null = null;
      let response: Response | null = null, currentUsage = { inputTokens: 0, outputTokens: 0 }, ttft: number | null = null;
      let completed = false;
      const record = async (result: AttemptRecord['result'], status: number, error: string | null) => {
        if (completed) return; completed = true;
        totalInput += currentUsage.inputTokens; totalOutput += currentUsage.outputTokens; lastTtft = ttft; latestDuration = seconds(attemptStart);
        await store.recordAttempt({ id: crypto.randomUUID(), requestId, channelId: channel.id, channelName: channel.name, credentialId: credential?.id || null,
          model: candidate.model, stream: Boolean(original.stream), startedAt, ttft, duration: latestDuration, status, result,
          error: error ? redact(error, secrets) : null, ...currentUsage, attempt: attempts });
      };
      try {
        response = channel.config.protocol === 'mock' ? await mockUpstream(channel, body, attempts, controller.signal) : await fetch(target, {
          method: 'POST', headers, signal: controller.signal,
          body: payload, redirect: 'manual',
        });
        if (!response.ok) {
          let raw;
          try { raw = await boundedText(response.body, 64 * 1024, controller.signal, true); }
          catch (error) { if (error instanceof StreamFailure) throw new StreamFailure(`HTTP ${response.status}: error body exceeded 64 KiB`, response.status); throw error; }
          throw new StreamFailure(`HTTP ${response.status}: ${raw || response.statusText}`, response.status);
        }
        if (!original.stream) {
          const raw = await boundedText(response.body, MAX_RESPONSE, controller.signal, true); let value;
          try { value = JSON.parse(raw); } catch { throw new StreamFailure('Upstream returned malformed JSON'); }
          const normalized = normalizeJSON(value, channel, original.model); currentUsage = usage(normalized);
          if (context.settings.emptyResponseDetection && !meaningfulOpenAIChunk(normalized)) throw new StreamFailure('Upstream returned an empty completion', 502, 'empty');
          cleanup(); await record(seconds(attemptStart) > context.settings.responseThreshold ? 'slow' : 'success', 200, null); await remember(channel, candidateIndex); await recordLog(200, null, true);
          return Response.json(normalized, { headers: { 'x-pulsegate-request-id': requestId, 'x-pulsegate-channel-id': channel.id, 'x-pulsegate-attempts': String(attempts) } });
        }
        if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new StreamFailure('Upstream did not return text/event-stream');
        iterator = normalizedStream(response.body, channel, original.model, controller.signal);
        const prefix: Uint8Array[] = []; let size = 0, ended = false, meaningful = false;
        while (true) {
          const item = await iterator.next(); if (item.done) { ended = true; break; }
          const bytes = sseBytes(item.value); size += bytes.byteLength;
          if (size > MAX_PREREAD) throw new StreamFailure('Upstream produced more than 1 MiB before the first meaningful token');
          prefix.push(bytes);
          if (item.value === '[DONE]') { ended = true; break; }
          currentUsage = { inputTokens: Math.max(currentUsage.inputTokens, usage(item.value).inputTokens), outputTokens: Math.max(currentUsage.outputTokens, usage(item.value).outputTokens) };
          if (meaningfulOpenAIChunk(item.value)) { ttft = seconds(attemptStart); meaningful = true; break; }
        }
        if (!meaningful && context.settings.emptyResponseDetection) throw new StreamFailure('Upstream stream completed without content', 502, 'empty');
        if (timeout !== undefined) clearTimeout(timeout); // Only TTFT is bounded. An established stream stays attached to this upstream.
        await remember(channel, candidateIndex);
        let finished = false, downstreamCancelled = false;
        const finish = async (success: boolean, error: string | null, status = 200) => {
          if (finished) return; finished = true; cleanup();
          await record(success ? ttft !== null && ttft > context.settings.threshold ? 'slow' : 'success' : status === 499 ? 'cancelled' : 'error', status, error);
          await recordLog(status, error, success);
        };
        const downstream = new ReadableStream<Uint8Array>({
          async pull(output) {
            try {
              if (prefix.length) {
                const bytes = prefix.shift()!;
                if (ended && !prefix.length) { await finish(true, null); output.enqueue(bytes); output.close(); await iterator?.return(undefined); return; }
                output.enqueue(bytes); return;
              }
              if (ended) { await finish(true, null); output.close(); await iterator?.return(undefined); return; }
              const item = await iterator!.next();
              if (item.done) { ended = true; await finish(true, null); output.close(); return; }
              if (item.value === '[DONE]') { ended = true; await finish(true, null); output.enqueue(sseBytes(item.value)); output.close(); await iterator?.return(undefined); return; }
              else currentUsage = { inputTokens: Math.max(currentUsage.inputTokens, usage(item.value).inputTokens), outputTokens: Math.max(currentUsage.outputTokens, usage(item.value).outputTokens) };
              output.enqueue(sseBytes(item.value));
            } catch (error) {
              const message = redact(probeDeadlineExpired() ? '渠道探测整体响应超时' : error instanceof Error ? error.message : 'Upstream stream failed', secrets);
              await finish(false, message, probeDeadlineExpired() ? 504 : request.signal.aborted || downstreamCancelled ? 499 : 502);
              if (!downstreamCancelled) {
                if (!request.signal.aborted) output.enqueue(sseBytes({ error: { message: publicError(context, message), type: 'upstream_stream_error', request_id: requestId } }));
                output.close();
              }
              controller.abort(); await iterator?.return(undefined).catch(() => {});
            }
          },
          async cancel() { downstreamCancelled = true; controller.abort(); await iterator?.return(undefined).catch(() => {}); await finish(false, '客户端取消流式响应', 499); },
        });
        return new Response(downstream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'x-pulsegate-request-id': requestId, 'x-pulsegate-channel-id': channel.id, 'x-pulsegate-attempts': String(attempts), 'x-pulsegate-ttft-ms': String(Math.round((ttft || 0) * 1000)) } });
      } catch (error) {
        cleanup(); controller.abort();
        await iterator?.return(undefined).catch(() => {});
        await response?.body?.cancel().catch(() => {});
        const status = probeDeadlineExpired() ? 504 : request.signal.aborted ? 499 : timedOut ? 504 : error instanceof StreamFailure || error instanceof RequestFailure ? error.status : 502;
        const message = redact(probeDeadlineExpired() ? '渠道探测整体响应超时' : timedOut ? original.stream ? '流式首字等待超时' : '非流式响应等待超时' : error instanceof Error ? error.message : '上游连接失败', secrets);
        const kind = probeDeadlineExpired() ? 'error' : request.signal.aborted ? 'cancelled' : error instanceof StreamFailure ? error.kind : 'error';
        const retry = !request.signal.aborted && !(error instanceof RequestFailure) && (timedOut || kind === 'empty' || !(error instanceof StreamFailure) || context.settings.retryStatuses.includes(status));
        lastFailure = { status, message, kind, retry }; await record(kind, status, message);
        if (!retry || !context.settings.retryEnabled) break;
      }
    }
    if (!lastFailure?.retry || !context.settings.retryEnabled) break;
  }
  const failed = lastFailure || { status: 503, message: '无可用上游', kind: 'error', retry: false };
  await recordLog(failed.status, failed.message, false);
  return errorResponse(failed.status, publicError(context, failed.message));
}

export async function probeChannel(channel: GatewayChannel, context: GatewayContext, store: GatewayStore, options: { stream?: boolean; credentialId?: string } = {}): Promise<Response> {
  const model = channel.models[0] || channel.model;
  const deadline = Math.max(1, Math.floor(Math.min(30, context.settings.nonStreamTimeout || 30) * 1000));
  return handleGateway(new Request('https://pulsegate.internal/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(deadline), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 1, stream: options.stream ?? true }) }), { ...context, source: 'probe', key: null, profile: null, forceChannelId: channel.id, forceCredentialId: options.credentialId ?? context.forceCredentialId, settings: { ...context.settings, maxChannelRetries: 0, maxSameChannelRetries: 0 } }, store);
}
