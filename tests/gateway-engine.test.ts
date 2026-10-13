import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultChannelConfig, defaultSettings, type AttemptRecord, type GatewayChannel, type GatewayLog, type KeyProfile } from '../shared/types';
import type { GatewayContext, GatewayStore } from '../worker/env';
import { channelInScope, gatewayCandidates, handleGateway, orderedCandidates, probeChannel } from '../worker/gateway';
import { autoDisableDecision, evaluateHealth } from '../worker/health';
import { normalizeJSON, prepareBody, RequestFailure, toAnthropic, toGemini, upstreamHeaders, upstreamUrl } from '../worker/protocols';
import { sseBytes } from '../worker/sse';

function channel(id = 'a', scenario: GatewayChannel['config']['mock']['scenario'] = 'healthy'): GatewayChannel {
  return { id, name: `Channel ${id}`, provider: 'Mock', model: 'test', models: ['test'], tags: ['production'], weight: 1, endpoint: 'https://upstream.example/v1', status: 'healthy', priority: id === 'a' ? 0 : 1, ttft: 0.01, successRate: 100, requests: 0, enabled: true, color: '#000', history: [], createdAt: new Date().toISOString(), archived: false, credentialCount: 0,
    health: { averageTtft: null, averageDuration: null, samples: 0, cooldownUntil: null, recoveryCount: 0, failureCount: 0, reason: null, autoDisabled: false }, config: { ...structuredClone(defaultChannelConfig), protocol: 'mock', mock: { scenario, delayMs: 1, status: 503, failuresBeforeSuccess: 1 } } };
}
function setup(channels = [channel()]) {
  const attempts: AttemptRecord[] = [], logs: GatewayLog[] = [], sticky = new Map<string, string>();
  const context: GatewayContext = { channels, settings: { ...defaultSettings, maxSameChannelRetries: 0, retryDelayMs: 100 }, env: { DEV_MODE: 'true' } as GatewayContext['env'], ctx: { waitUntil: vi.fn() } as unknown as ExecutionContext, key: null, profile: null, source: 'playground' };
  const store: GatewayStore = {
    getCredentials: async () => [{ id: 'credential', label: 'test', secret: 'secret-super-important', enabled: true, failureCount: 0, disabledAt: null }],
    recordAttempt: async a => { attempts.push(a); }, recordLog: async l => { logs.push(l); }, recordEvent: async () => {},
    getRecentAttempts: async () => [], updateHealth: async () => {}, setCredentialHealth: async () => {}, incrementKeyUsage: async () => true,
    nextRoundRobin: async () => 0, getSticky: async key => sticky.get(key) || null, setSticky: async (key, id) => { sticky.set(key, id); },
    getAiGatewayToken: async () => null, reserveChannel: async () => true,
  };
  return { context, store, attempts, logs, sticky };
}
function request(stream = true, signal?: AbortSignal) { return new Request('https://gateway.test/v1/chat/completions', { method: 'POST', signal, body: JSON.stringify({ model: 'test', stream, messages: [{ role: 'user', content: 'hello' }] }) }); }
const profile: KeyProfile = { id: 'profile', name: 'production', scope: 'tags', tags: ['production'], match: 'any', channelIds: [], modelMode: 'all', models: [], requestLimit: '', mappings: [] };
afterEach(() => vi.unstubAllGlobals());

describe('scope and model selection', () => {
  it('applies ANY / ALL / NONE and empty tag scopes fail closed', () => {
    const c = channel(); expect(channelInScope(c, profile)).toBe(true);
    expect(channelInScope(c, { ...profile, match: 'all', tags: ['production', 'backup'] })).toBe(false);
    expect(channelInScope(c, { ...profile, match: 'none' })).toBe(false);
    expect(channelInScope(c, { ...profile, match: 'none', tags: ['backup'] })).toBe(true);
    expect(channelInScope(c, { ...profile, match: 'none', tags: [] })).toBe(false);
  });
  it('checks mapped target whitelist and resolves aliases without widening scope', () => {
    const c = channel(); c.config.aliases = [{ from: 'mapped', to: 'actual-upstream' }];
    const { context } = setup([c]); context.profile = { ...profile, modelMode: 'selected', models: ['mapped'], mappings: [{ from: 'public-model', to: ['mapped'] }] };
    expect(gatewayCandidates(context, 'public-model')[0]?.model).toBe('actual-upstream');
    expect(gatewayCandidates(context, 'other')).toEqual([]);
    context.profile.mappings = [{ from: 'public-model', to: ['outside'] }]; expect(gatewayCandidates(context, 'public-model')).toEqual([]);
    context.profile.mappings = [{ from: 'public-model', to: ['mapped'] }];
    context.profile.tags = ['other']; expect(gatewayCandidates(context, 'public-model')).toEqual([]);
  });
  it('forced tests can inspect degraded disabled channels but archived is excluded', () => {
    const c = channel(); c.enabled = false; c.status = 'degraded'; const { context } = setup([c]);
    expect(gatewayCandidates(context, 'test')).toEqual([]); context.forceChannelId = c.id;
    expect(gatewayCandidates(context, 'test')).toHaveLength(1); c.archived = true; expect(gatewayCandidates(context, 'test')).toEqual([]);
  });
});

describe('gateway execution', () => {
  it('returns a traceable 503 with the configured error message when authorized channels are unavailable', async () => {
    for (const status of ['disabled', 'degraded', 'offline'] as const) {
      const primary = channel('a'); if (status === 'disabled') primary.enabled = false; else primary.status = status;
      const outside = channel('b'); outside.tags = ['outside']; const { context, store, logs, attempts } = setup([primary, outside]);
      context.profile = profile; context.settings.customErrorMessage = '服务正在恢复，请稍后重试';
      const response = await handleGateway(new Request(request(false), { headers: { 'x-trace-id': 'unavailable-trace' } }), context, store);
      expect(response.status).toBe(503); expect((await response.json() as any).error.message).toBe('服务正在恢复，请稍后重试');
      expect(logs).toHaveLength(1); expect(logs[0].id).toBe(response.headers.get('x-pulsegate-request-id')); expect(logs[0].traceId).toBe('unavailable-trace'); expect(logs[0].attempts).toBe(0); expect(attempts).toHaveLength(0);
    }
  });
  it('keeps scope denials at 403 and records zero-attempt quota failures', async () => {
    const denied = setup(); denied.context.profile = { ...profile, tags: ['outside'] };
    const forbidden = await handleGateway(request(false), denied.context, denied.store); expect(forbidden.status).toBe(403); expect(denied.logs).toHaveLength(0);
    const { context, store, logs, attempts } = setup(); context.profile = profile;
    context.key = { id: 'client-key', name: 'client', preview: 'pg_masked', status: 'active', createdAt: new Date().toISOString(), expires: '', note: '', used: 1, activeProfile: profile.id, profiles: [profile], tokenHash: 'hash' };
    store.incrementKeyUsage = async () => false;
    const response = await handleGateway(request(false), context, store); expect(response.status).toBe(429); expect(logs).toHaveLength(1); expect(logs[0].apiKeyId).toBe('client-key'); expect(logs[0].id).toBe(response.headers.get('x-pulsegate-request-id')); expect(logs[0].attempts).toBe(0); expect(attempts).toHaveLength(0);
  });
  it('streams real mock output and records token usage after completion', async () => {
    const { context, store, logs, attempts } = setup(); const response = await handleGateway(request(), context, store);
    expect(response.status).toBe(200); expect(response.headers.get('x-pulsegate-channel-id')).toBe('a');
    const text = await response.text(); expect(text).toContain('[DONE]'); expect(text).toContain('content');
    expect(attempts).toHaveLength(1); expect(attempts[0].ttft).not.toBeNull(); expect(logs[0].tokens).toBeGreaterThan(0);
  });
  it('detects empty SSE and retries another channel before sending any content', async () => {
    const { context, store, logs, attempts } = setup([channel('a', 'empty'), channel('b')]);
    const response = await handleGateway(request(), context, store); await response.text();
    expect(response.headers.get('x-pulsegate-channel-id')).toBe('b'); expect(attempts.map(a => a.result)).toEqual(['empty', 'success']); expect(logs[0].result).toBe('failover');
  });
  it('does not retry any failure when retryEnabled is false', async () => {
    const { context, store, attempts } = setup([channel('a', 'error'), channel('b')]); context.settings.retryEnabled = false; context.settings.maxSameChannelRetries = 5;
    const response = await handleGateway(request(), context, store); expect(response.status).toBe(503); expect(attempts).toHaveLength(1);
  });
  it('same-channel count means retries in addition to the initial attempt', async () => {
    const { context, store, attempts } = setup([channel('a', 'transient')]); context.settings.maxSameChannelRetries = 1;
    const response = await handleGateway(request(false), context, store); expect(response.status).toBe(200); expect(attempts).toHaveLength(2);
  });
  it('records a switch event for non-streaming failover as well as the successful request log', async () => {
    const { context, store, attempts, logs } = setup([channel('a', 'error'), channel('b')]); const event = vi.fn(); store.recordEvent = event;
    const response = await handleGateway(request(false), context, store);
    expect(response.status).toBe(200); expect(attempts.map(a => a.channelId)).toEqual(['a', 'b']); expect(logs[0].result).toBe('failover');
    expect(event).toHaveBeenCalledTimes(1); expect(event.mock.calls[0][0]).toMatchObject({ type: 'switch', channelId: 'b', title: '已切换备用渠道' });
  });
  it('stops retrying a channel immediately after an atomic auto-disable write', async () => {
    const { context, store, attempts } = setup([channel('a', 'error'), channel('b')]); context.settings.maxSameChannelRetries = 2;
    let disabled = false;
    store.getChannel = async id => { const c = structuredClone(context.channels.find(c => c.id === id)!); if (id === 'a' && disabled) { c.health.autoDisabled = true; c.status = 'offline'; } return c; };
    store.recordAttempt = async attempt => { attempts.push(attempt); if (attempt.channelId === 'a') disabled = true; };
    const response = await handleGateway(request(false), context, store); expect(response.status).toBe(200); expect(attempts.map(a => a.channelId)).toEqual(['a', 'b']);
  });
  it('bounds SSE TTFT independently of non-stream completion', async () => {
    const slow = channel('a', 'slow'); slow.config.mock.delayMs = 80;
    const { context, store, attempts } = setup([slow, channel('b')]); context.settings.streamFirstTokenTimeout = 0.02;
    const response = await handleGateway(request(), context, store); await response.text(); expect(response.headers.get('x-pulsegate-channel-id')).toBe('b'); expect(attempts[0].status).toBe(504);
    const json = await handleGateway(request(false), context, store); expect(json.headers.get('x-pulsegate-channel-id')).toBe('a');
  });
  it('does not splice a second channel into a stream disconnected after valid output', async () => {
    const { context, store, attempts, logs } = setup([channel('a', 'disconnect'), channel('b')]);
    const response = await handleGateway(request(), context, store); const text = await response.text();
    expect(text).toContain('upstream_stream_error'); expect(attempts).toHaveLength(1); expect(logs[0].result).toBe('error');
  });
  it('cancels retry backoff promptly when the client aborts', async () => {
    const { context, store, attempts } = setup([channel('a', 'error'), channel('b')]); context.settings.retryDelayMs = 1000;
    const controller = new AbortController(); const promise = handleGateway(request(false, controller.signal), context, store);
    setTimeout(() => controller.abort(), 20); const response = await promise; expect(response.status).toBe(499); expect(attempts).toHaveLength(1);
  });
  it('cancels an established stream without recording the cancellation as upstream failure', async () => {
    const { context, store, attempts } = setup(); const response = await handleGateway(request(), context, store);
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); expect(attempts).toHaveLength(1); expect(attempts[0].result).toBe('cancelled'); expect(attempts[0].status).toBe(499);
  });
  it('cancels while an established upstream read is pending', async () => {
    const { context, store, attempts } = setup(); const response = await handleGateway(request(), context, store); const reader = response.body!.getReader();
    await reader.read(); await reader.read(); const pendingRead = reader.read(); await reader.cancel(); await pendingRead;
    expect(attempts).toHaveLength(1); expect(attempts[0].result).toBe('cancelled');
  });
  it('does not dispatch upstream work after cancellation during a rate reservation', async () => {
    const { context, store, attempts } = setup(); const controller = new AbortController();
    store.reserveChannel = async () => { controller.abort(); return true; };
    const response = await handleGateway(request(false, controller.signal), context, store); expect(response.status).toBe(499); expect(attempts).toHaveLength(0);
  });
  it('rotates multiple upstream credentials between requests', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts } = setup([c]); let offset = 0;
    store.nextRoundRobin = async () => offset++;
    store.getCredentials = async () => [{ id: 'first', label: 'first', secret: 'first-secret', enabled: true, failureCount: 0, disabledAt: null }, { id: 'second', label: 'second', secret: 'second-secret', enabled: true, failureCount: 0, disabledAt: null }];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'hello' } }] })));
    await handleGateway(request(false), context, store); await handleGateway(request(false), context, store);
    expect(attempts.map(a => a.credentialId)).toEqual(['first', 'second']);
  });
  it('round-robin routing remains shared across different trace scopes', async () => {
    const { context, store } = setup([channel('a'), channel('b')]); context.settings.strategy = 'round-robin'; let index = 0;
    store.nextRoundRobin = async key => { expect(key).toBe('profile-identity'); return index++; };
    const candidates = gatewayCandidates(context, 'test');
    const first = await orderedCandidates(candidates, context, store, 'trace-one', 'profile-identity');
    const second = await orderedCandidates(candidates, context, store, 'trace-two', 'profile-identity');
    expect(first[0].channel.id).toBe('a'); expect(second[0].channel.id).toBe('b');
  });
  it('redacts upstream credentials even in raw error mode', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts } = setup([c]); context.settings.errorMode = 'raw'; context.settings.retryEnabled = false;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'credential secret-super-important failed' } }, { status: 401 })));
    const response = await handleGateway(request(false), context, store); const text = await response.text(); expect(text).not.toContain('secret-super-important'); expect(attempts[0].error).toContain('[REDACTED]');
  });
  it('redacts a newly rotated upstream credential fetched during backoff', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts } = setup([c]); context.settings.errorMode = 'raw'; context.settings.maxSameChannelRetries = 1;
    let calls = 0;
    store.getCredentials = async () => [{ id: 'key', label: 'key', secret: calls++ ? 'newly-rotated-secret' : 'old-secret', enabled: true, failureCount: 0, disabledAt: null }];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'newly-rotated-secret unavailable' } }, { status: 503 })));
    const response = await handleGateway(request(false), context, store); expect(await response.text()).not.toContain('newly-rotated-secret'); expect(attempts[1].error).toContain('[REDACTED]');
  });
  it('includes body overrides and tool schemas in token-rate reservations', async () => {
    const c = channel(); c.config.bodyOverrides.max_tokens = 5000; const { context, store } = setup([c]); let reserved = 0;
    store.reserveChannel = async (_channel, tokens) => { reserved = tokens; return false; };
    const response = await handleGateway(new Request('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'tool', description: 'schema '.repeat(100) } }] }) }), context, store);
    expect(response.status).toBe(429); expect(reserved).toBeGreaterThan(5200);
  });
  it('rejects malformed success JSON even when empty-response detection is disabled', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store } = setup([c]); context.settings.emptyResponseDetection = false; context.settings.retryEnabled = false;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ unexpected: 'not a chat completion' })));
    const response = await handleGateway(request(false), context, store); expect(response.status).toBe(502);
  });
  it('rejects unsupported native input without upstream dispatch, rate reservation or health attempts', async () => {
    const c = channel(); c.config.protocol = 'anthropic'; const { context, store, attempts, logs } = setup([c]);
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); const reserve = vi.fn(async () => true); store.reserveChannel = reserve;
    for (let index = 0; index < 10; index++) {
      const response = await handleGateway(new Request('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_schema' } }) }), context, store);
      expect(response.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled(); expect(attempts).toHaveLength(0);
    expect(logs).toHaveLength(10); expect(logs.every(log => log.attempts === 0 && log.status === 400)).toBe(true);
  });
  it('can skip an unsupported native protocol and use an authorized compatible channel within the retry budget', async () => {
    const native = channel('a'); native.config.protocol = 'anthropic'; const compatible = channel('b'); compatible.config.protocol = 'openai';
    const { context, store, attempts, logs } = setup([native, compatible]); context.settings.maxSameChannelRetries = 5;
    const reserve = vi.fn(async () => true); store.reserveChannel = reserve;
    const fetchSpy = vi.fn(async () => Response.json({ choices: [{ message: { content: 'compatible reply' } }] })); vi.stubGlobal('fetch', fetchSpy);
    const response = await handleGateway(new Request('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_schema' } }) }), context, store);
    expect(response.status).toBe(200); expect(response.headers.get('x-pulsegate-channel-id')).toBe('b'); expect(response.headers.get('x-pulsegate-attempts')).toBe('1');
    expect(fetchSpy).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1); expect(reserve.mock.calls[0][0].id).toBe('b');
    expect(attempts.map(a => a.channelId)).toEqual(['b']); expect(logs[0]).toMatchObject({ result: 'failover', attempts: 1 });
  });
  it('does not bypass a disabled cross-channel retry budget for native protocol incompatibility', async () => {
    const native = channel('a'); native.config.protocol = 'anthropic'; const compatible = channel('b'); compatible.config.protocol = 'openai';
    const { context, store, attempts } = setup([native, compatible]); context.settings.maxChannelRetries = 0;
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const response = await handleGateway(new Request('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_schema' } }) }), context, store);
    expect(response.status).toBe(400); expect(fetchSpy).not.toHaveBeenCalled(); expect(attempts).toHaveLength(0);
  });
  it('treats malformed message and tool structures as client input errors rather than upstream failures', async () => {
    const cases = [
      { messages: [{ role: 'user', content: [null] }] },
      { messages: [{ role: 'assistant', tool_calls: {} }] },
      { messages: [{ role: 'assistant', tool_calls: [null] }] },
      { tools: {} }, { tools: [null] }, { tools: [{ type: 'function' }] }, { tool_choice: null },
    ];
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    for (const malformed of cases) {
      const c = channel(); c.config.protocol = 'anthropic'; const { context, store, attempts } = setup([c]); const reserve = vi.fn(async () => true); store.reserveChannel = reserve;
      const response = await handleGateway(new Request('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], ...malformed }) }), context, store);
      expect(response.status).toBe(400); expect(reserve).not.toHaveBeenCalled(); expect(attempts).toHaveLength(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not count locally rejected headers, body overrides or gateway URLs as health attempts', async () => {
    const cases = [
      { headers: { Authorization: 'invalid' } }, { bodyOverrides: { model: 'outside' } }, { gatewayMode: 'ai-gateway' as const },
    ];
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    for (const invalid of cases) {
      const c = channel(); c.config.protocol = 'openai'; Object.assign(c.config, invalid); const { context, store, attempts, logs } = setup([c]); const reserve = vi.fn(async () => true); store.reserveChannel = reserve;
      const response = await handleGateway(request(false), context, store);
      expect(response.status).toBe('gatewayMode' in invalid ? 503 : 400); expect(reserve).not.toHaveBeenCalled(); expect(attempts).toHaveLength(0); expect(logs[0].attempts).toBe(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('still records actual upstream HTTP 400 responses but does not retry unconfigured statuses', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts } = setup([c, channel('b')]);
    const fetchSpy = vi.fn(async () => Response.json({ error: { message: 'invalid upstream parameter' } }, { status: 400 })); vi.stubGlobal('fetch', fetchSpy);
    const response = await handleGateway(request(false), context, store);
    expect(response.status).toBe(400); expect(fetchSpy).toHaveBeenCalledTimes(1); expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ result: 'error', status: 400, channelId: 'a' });
  });
  it('does not allow Mock channels in production', async () => {
    const { context, store } = setup(); context.env.DEV_MODE = 'false'; const response = await handleGateway(request(false), context, store); expect(response.status).toBe(403);
  });
  it('probe bypasses user scope and can select disabled upstream credentials', async () => {
    const c = channel(); c.enabled = false; const { context, store, logs } = setup([c]); context.profile = { ...profile, tags: ['other'] };
    const response = await probeChannel(c, context, store); await response.text(); expect(response.status).toBe(200); expect(logs[0].source).toBe('probe');
  });
  it('bounds a probe that emits a token but never completes and records a real timeout', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts, logs } = setup([c]); context.settings.nonStreamTimeout = 0.03;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(output) { output.enqueue(sseBytes({ choices: [{ delta: { content: 'first' } }] })); } }), { headers: { 'Content-Type': 'text/event-stream' } })));
    const response = await probeChannel(c, context, store); await response.text(); expect(attempts[0].status).toBe(504); expect(attempts[0].result).toBe('error'); expect(logs[0].status).toBe(504);
  });
});

describe('protocol conversions and safety', () => {
  it.each([
    ['openai', '/v1/chat/completions'],
    ['anthropic', '/v1/messages'],
    ['gemini', '/v1beta/models/test:generateContent'],
  ] as const)('infers the %s API version for a bare origin with or without a trailing slash', (protocol, path) => {
    const c = channel(); c.config.protocol = protocol;
    for (const endpoint of ['https://upstream.example', 'https://upstream.example/']) {
      c.endpoint = endpoint;
      expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example' + path);
    }
  });
  it('uses the inferred Gemini API version for streaming and escapes the model name', () => {
    const c = channel(); c.config.protocol = 'gemini'; c.endpoint = 'https://upstream.example';
    expect(upstreamUrl(c, defaultSettings, 'model/name', true)).toBe('https://upstream.example/v1beta/models/model%2Fname:streamGenerateContent?alt=sse');
  });
  it.each(['/v1', '/v1beta', '/v2', '/deployment', '/deployment/v1/', '/json'])('preserves an explicitly supplied API base path %s', prefix => {
    const c = channel(); c.config.protocol = 'openai'; c.endpoint = 'https://upstream.example' + prefix;
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example' + prefix.replace(/\/$/, '') + '/chat/completions');
  });
  it('preserves an explicit Gemini /v1 base instead of replacing it with /v1beta', () => {
    const c = channel(); c.config.protocol = 'gemini';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/v1/models/test:generateContent');
  });
  it('keeps versioned endpoint overrides and complete base prefixes exactly once', () => {
    const c = channel(); c.config.protocol = 'openai'; c.endpoint = 'https://upstream.example';
    c.config.endpoints.chat = '/v2/chat/completions';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/v2/chat/completions');
    c.endpoint += '/deployment/v1'; c.config.endpoints.chat = '/deployment/v1/custom/chat';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/deployment/v1/custom/chat');
  });
  it('preserves custom unversioned endpoint overrides under a bare origin', () => {
    const c = channel(); c.endpoint = 'https://upstream.example'; c.config.protocol = 'anthropic';
    c.config.endpoints.messages = '/api/messages';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/api/messages');
    c.config.protocol = 'openai'; c.config.endpoints.chat = '/custom/chat';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/custom/chat');
  });
  it('resolves a relay API base independently from the direct upstream base', () => {
    const c = channel(); c.config.protocol = 'anthropic'; c.endpoint = 'https://upstream.example/custom';
    c.config.relayUrl = 'https://relay.example/';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://relay.example/v1/messages');
    c.config.relayUrl = 'https://relay.example/deployment';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://relay.example/deployment/messages');
    c.config.relayUrl = 'https://relay.example'; c.config.endpoints.messages = '/v2/messages';
    expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://relay.example/v2/messages');
  });
  it.each([
    ['openai', '/v1/chat/completions'],
    ['gemini', '/v1beta/models/test:generateContent'],
  ] as const)('uses the resolved %s version in Cloudflare AI Gateway URLs', (protocol, path) => {
    const c = channel(); c.config.protocol = protocol; c.endpoint = 'https://upstream.example';
    c.config.gatewayMode = 'ai-gateway'; c.config.customProviderSlug = 'custom-example';
    expect(upstreamUrl(c, { ...defaultSettings, aiGatewayEnabled: true, account: 'a', gateway: 'g' }, 'test', false)).toBe('https://gateway.ai.cloudflare.com/v1/a/g/custom-example' + path);
  });
  it('keeps version prefixes exactly once for direct and custom provider URLs', () => {
    const c = channel(); c.config.protocol = 'openai'; expect(upstreamUrl(c, defaultSettings, 'test', false)).toBe('https://upstream.example/v1/chat/completions');
    c.config.gatewayMode = 'ai-gateway'; c.config.customProviderSlug = 'custom-example';
    expect(upstreamUrl(c, { ...defaultSettings, aiGatewayEnabled: true, account: 'a', gateway: 'g' }, 'test', false)).toBe('https://gateway.ai.cloudflare.com/v1/a/g/custom-example/v1/chat/completions');
    expect(upstreamHeaders(c, 'upstream', 'cloudflare').get('Authorization')).toBe('Bearer upstream'); expect(upstreamHeaders(c, 'upstream', 'cloudflare').get('cf-aig-authorization')).toBe('Bearer cloudflare');
  });
  it('rejects attempts to override scope-sensitive model/headers', () => {
    const c = channel(); c.config.bodyOverrides = { model: 'forbidden' }; expect(() => prepareBody(c, { model: 'test', messages: [] }, 'test')).toThrow('model');
    c.config.headers = { Authorization: 'secret' }; expect(() => upstreamHeaders(c, 'upstream', null)).toThrow('Authorization');
  });
  it('converts tool and image histories to native provider requests', () => {
    const c = channel(); c.config.protocol = 'anthropic';
    const body = { model: 'test', messages: [{ role: 'system', content: 'be helpful' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] }, { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'weather', arguments: '{"city":"Shanghai"}' } }] }, { role: 'tool', tool_call_id: 'call1', content: '{"temperature":20}' }] };
    const anthropic = toAnthropic(body, c); expect(anthropic.system[0].text).toBe('be helpful'); expect(anthropic.messages[1].content[0].type).toBe('tool_use');
    c.config.protocol = 'gemini'; const gemini = toGemini(body, c); expect(gemini.contents[2].parts[0].functionResponse.name).toBe('weather');
  });
  it('rejects unsupported native parameters instead of silently dropping them', () => {
    const c = channel(); c.config.protocol = 'anthropic'; expect(() => toAnthropic({ model: 'test', messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_schema' } }, c)).toThrow('response_format');
  });
  it('validates native-only history and tool selection shapes with client errors', () => {
    const c = channel(); c.config.protocol = 'anthropic';
    expect(() => toAnthropic({ model: 'test', messages: [{ role: 'assistant', content: 'hi', extra_content: { anthropic: { thinking: [null] } } }] }, c)).toThrow(RequestFailure);
    expect(() => toAnthropic({ model: 'test', messages: [{ role: 'user', content: 'hi' }], tool_choice: { type: 'function', function: null } }, c)).toThrow(RequestFailure);
    c.config.protocol = 'gemini'; expect(() => toGemini({ model: 'test', messages: [{ role: 'user', content: [null] }] }, c)).toThrow(RequestFailure);
  });
  it('normalizes JSON text/tools/reasoning and usage', () => {
    const c = channel(); c.config.protocol = 'anthropic'; const result = normalizeJSON({ id: 'msg', content: [{ type: 'text', text: 'hi' }, { type: 'thinking', thinking: 'thought' }, { type: 'tool_use', id: 't', name: 'fn', input: { a: 1 } }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 4 } }, c, 'public');
    expect(result.choices[0].message.reasoning_content).toBe('thought'); expect(result.choices[0].finish_reason).toBe('tool_calls'); expect(result.usage.total_tokens).toBe(7);
  });
  it('preserves provider thought signatures for tool-call follow-up requests', () => {
    const c = channel(); c.config.protocol = 'gemini';
    const normalized = normalizeJSON({ candidates: [{ content: { parts: [{ functionCall: { name: 'weather', args: { city: 'Shanghai' } }, thoughtSignature: 'encrypted-sig' }] }, finishReason: 'STOP' }] }, c, 'test');
    const native = toGemini({ model: 'test', messages: [normalized.choices[0].message] }, c);
    expect(native.contents[0].parts[0].thoughtSignature).toBe('encrypted-sig');
    c.config.protocol = 'anthropic';
    const anthropic = normalizeJSON({ content: [{ type: 'thinking', thinking: 'thought', signature: 'encrypted-anthropic' }, { type: 'text', text: 'answer' }] }, c, 'test');
    expect(toAnthropic({ model: 'test', messages: [anthropic.choices[0].message] }, c).messages[0].content[0].signature).toBe('encrypted-anthropic');
  });
  it('only counts valid text after role and heartbeat events toward TTFT', async () => {
    const c = channel(); c.config.protocol = 'openai'; const { context, store, attempts } = setup([c]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ async start(output) {
      output.enqueue(new TextEncoder().encode(':heartbeat\n\n')); output.enqueue(sseBytes({ choices: [{ delta: { role: 'assistant' } }] }));
      await new Promise(resolve => setTimeout(resolve, 40)); output.enqueue(sseBytes({ choices: [{ delta: { content: 'hi' }, finish_reason: null }] })); output.enqueue(sseBytes('[DONE]')); output.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } })));
    const response = await handleGateway(request(), context, store); await response.text(); expect(attempts[0].ttft).toBeGreaterThanOrEqual(0.03);
  });
});

describe('quality health', () => {
  function sample(stream: boolean, ttft: number, duration = 1): AttemptRecord { return { id: crypto.randomUUID(), requestId: 'r', channelId: 'a', channelName: 'a', credentialId: null, model: 'test', stream, startedAt: new Date().toISOString(), ttft: stream ? ttft : null, duration, status: 200, result: 'success', error: null, inputTokens: 0, outputTokens: 0, attempt: 1 }; }
  it('evaluates streaming and non-streaming independently with minimum sample count', () => {
    const c = channel(), latest = sample(true, 12); const settings = { ...defaultSettings, samples: 2 };
    expect(evaluateHealth(c, settings, [latest, sample(false, 0, 100)], latest).status).toBe('healthy');
    expect(evaluateHealth(c, settings, [latest, sample(true, 13)], latest).status).toBe('degraded');
    const json = sample(false, 0, 30); expect(evaluateHealth(c, settings, [json, sample(false, 0, 30)], json).status).toBe('degraded');
  });
  it('recovers through consecutive fresh probes after cooldown despite stale slow samples', () => {
    const c = channel(); c.status = 'degraded'; c.health.recoveryCount = 1; c.health.cooldownUntil = new Date(Date.now() - 1).toISOString();
    const latest = sample(true, 1); expect(evaluateHealth(c, { ...defaultSettings, recovery: 2, samples: 1 }, [latest, sample(true, 100)], latest).status).toBe('healthy');
  });
  it('auto-disables only after consecutive configured HTTP failures', () => {
    const c = channel(); const settings = { ...defaultSettings, autoDisableEnabled: true, autoDisableThreshold: 2 };
    expect(autoDisableDecision(c, settings, 401, 1).disable).toBe(true); expect(autoDisableDecision(c, settings, 500, 1).failureCount).toBe(0);
  });
});
