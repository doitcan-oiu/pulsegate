import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../worker/index';
import { decryptSecret } from '../worker/crypto';
import { refreshAccountBalance, refreshDueAccounts } from '../worker/accounts';
import { Store } from '../worker/store';
import type { Env } from '../worker/env';
import type { GatewayChannel } from '../shared/types';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
async function call(path: string, method = 'GET', data?: unknown, authenticated = true, customEnv: Env = testEnv) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://127.0.0.1:8787' + path, { method, headers: { ...(authenticated ? { authorization: 'Bearer ' + testEnv.ADMIN_TOKEN } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }), customEnv, ctx);
  const content = await response.text(); await waitOnExecutionContext(ctx);
  return { status: response.status, content, json: JSON.parse(content) };
}
beforeAll(async () => { await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS); });
beforeEach(async () => {
  await testEnv.DB.batch(['channel_accounts','credentials','channels','settings','tags','gateway_state'].map(table => testEnv.DB.prepare('DELETE FROM ' + table)));
});
afterEach(() => vi.unstubAllGlobals());
function mockAccount(balance = 12.5) {
  return vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/login')) return Response.json({ success: true, data: { access_token: 'private-session-token', user: { id: 42 }, expires_in: 3600 } });
    if (path === '/api/status') return Response.json({ success: true, data: { quota_per_unit: 500000 } });
    return Response.json({ success: true, data: { quota: balance * 500000, balance } });
  }));
}
async function accountChannel(kind: 'newapi' | 'sub2api' = 'newapi') {
  const result = await call('/api/channels', 'POST', { name: 'Account test', endpoint: 'https://account.example/v1', models: ['model-a'], config: { protocol: 'openai', integration: kind }, accountCredentials: { username: 'fake-user@example.com', password: 'fake-account-password' }, apiKeys: ['fake-api-key'] });
  expect(result.status).toBe(201); return result;
}

describe('model discovery management endpoint', () => {
  it.each([
    ['openai', 'https://models.example', '/v1/models', 'authorization', 'Bearer fake-key', { data: [{ id: 'model-a' }] }, 'model-a'],
    ['anthropic', 'https://models.example/', '/v1/models', 'x-api-key', 'fake-key', { data: [{ id: 'claude-a' }], has_more: false }, 'claude-a'],
    ['gemini', 'https://models.example', '/v1beta/models', 'x-goog-api-key', 'fake-key', { models: [{ name: 'models/gemini-a' }] }, 'gemini-a'],
  ] as const)('discovers %s models from a Base URL without a version suffix', async (protocol, endpoint, path, header, headerValue, response, model) => {
    const fetcher = vi.fn(async () => Response.json(response)); vi.stubGlobal('fetch', fetcher);
    const result = await call('/api/channels/discover-models', 'POST', { endpoint, config: { protocol }, apiKey: 'fake-key' });
    expect(result.status).toBe(200); expect(result.json.models).toEqual([model]);
    expect(result.json.endpoint).toBe('https://models.example' + path);
    const [target, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(target).pathname).toBe(path);
    expect(new Headers(options.headers).get(header)).toBe(headerValue);
  });
  it('uses an explicitly versioned models path with a bare Base URL', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'model-a' }] })); vi.stubGlobal('fetch', fetcher);
    const result = await call('/api/channels/discover-models', 'POST', { endpoint: 'https://models.example', config: { protocol: 'openai', endpoints: { models: '/v2/models' } }, apiKey: 'fake-key' });
    expect(result.status).toBe(200); expect(result.json.endpoint).toBe('https://models.example/v2/models');
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toBe(result.json.endpoint);
  });
  it('requires admin access and fetches the configured URL with its API key', async () => {
    const input = { endpoint: 'https://models.example/v1', config: { protocol: 'openai', endpoints: { models: '/v1/models' } }, apiKey: 'fake-discovery-key' };
    expect((await call('/api/channels/discover-models', 'POST', input, false)).status).toBe(401);
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'z' }, { id: 'a' }, { id: 'z' }] })); vi.stubGlobal('fetch', fetcher);
    const result = await call('/api/channels/discover-models', 'POST', input);
    expect(result.status).toBe(200); expect(result.json.models).toEqual(['a','z']);
    const [target, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe('https://models.example/v1/models');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer fake-discovery-key'); expect(options.redirect).toBe('manual');
    expect((await new Store(testEnv).listChannels())).toEqual([]);
  });
  it('uses saved credentials without returning them, and reports safe upstream errors', async () => {
    const channel = await call('/api/channels', 'POST', { name:'Saved', endpoint:'https://models.example/v1', models:['existing'], apiKeys:['saved-private-key'] });
    const fetcher = vi.fn(async () => Response.json({ error: { message:'saved-private-key password-secret' } }, { status:401 })); vi.stubGlobal('fetch', fetcher);
    const result = await call('/api/channels/discover-models', 'POST', { channelId:channel.json.channel.id });
    expect(result.status).toBe(502); expect(result.content).toContain('401'); expect(result.content).not.toContain('saved-private-key'); expect(result.content).not.toContain('password-secret');
    expect(new Headers((fetcher.mock.calls[0] as unknown as [unknown,RequestInit])[1].headers).get('authorization')).toBe('Bearer saved-private-key');
    expect((await new Store(testEnv).getChannel(channel.json.channel.id))?.models).toEqual(['existing']);
  });
  it('paginates native model listings and normalizes Gemini model names', async () => {
    const gemini = vi.fn().mockResolvedValueOnce(Response.json({ models:[{ name:'models/gemini-a',supportedGenerationMethods:['generateContent'] }, { name:'models/embed',supportedGenerationMethods:['embedContent'] }], nextPageToken:'cursor' })).mockResolvedValueOnce(Response.json({ models:[{ name:'models/gemini-b' }] }));
    vi.stubGlobal('fetch', gemini);
    const result = await call('/api/channels/discover-models','POST',{ endpoint:'https://models.example/v1beta', config:{ protocol:'gemini' }, apiKey:'fake-key' });
    expect(result.json.models).toEqual(['gemini-a','gemini-b']); expect(gemini).toHaveBeenCalledTimes(2);
    expect(new URL(String(gemini.mock.calls[1][0])).searchParams.get('pageToken')).toBe('cursor');
    const anthropic = vi.fn().mockResolvedValueOnce(Response.json({ data:[{ id:'claude-a' }],has_more:true,last_id:'a' })).mockResolvedValueOnce(Response.json({ data:[{ id:'claude-b' }],has_more:false })); vi.stubGlobal('fetch', anthropic);
    const claude = await call('/api/channels/discover-models','POST',{ endpoint:'https://models.example/v1',config:{ protocol:'anthropic' },apiKey:'fake-key' });
    expect(claude.json.models).toEqual(['claude-a','claude-b']); expect(new Headers(anthropic.mock.calls[0][1].headers).get('x-api-key')).toBe('fake-key');
  });
  it('rejects missing keys, malformed responses and disallowed addresses', async () => {
    expect((await call('/api/channels/discover-models','POST',{ endpoint:'https://models.example/v1' })).status).toBe(400);
    expect((await call('/api/channels/discover-models','POST',{ endpoint:'http://public.example/v1',apiKey:'fake' })).status).toBe(400);
    vi.stubGlobal('fetch',vi.fn(async () => Response.json({ hello:'world' })));
    expect((await call('/api/channels/discover-models','POST',{ endpoint:'https://models.example/v1',apiKey:'fake' })).status).toBe(502);
  });
});

describe('encrypted channel accounts and balance refresh', () => {
  it('encrypts NewAPI dashboard tokens, refreshes without login, and preserves authentication mode on edits', async () => {
    const token = 'private-dashboard-access-token';
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      expect(path).not.toContain('/login');
      if (path === '/api/status') return Response.json({ success:true,data:{ turnstile_check:true,quota_per_unit:500000 } });
      expect(path).toBe('/api/user/self');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + token);
      expect(new Headers(init?.headers).get('New-Api-User')).toBe('42');
      return Response.json({ success:true,data:{ quota:2500000 } });
    });
    vi.stubGlobal('fetch',fetcher);
    const created = await call('/api/channels','POST',{ name:'Token account',endpoint:'https://account.example',models:['a'],config:{ integration:'newapi' },accountCredentials:{ accessToken:token,userId:'42' } });
    expect(created.status).toBe(201); expect(created.json.channel.accountAuthMode).toBe('token');
    const id = created.json.channel.id;
    const store = new Store(testEnv);
    expect((await store.getChannel(id))?.accountBalance).toMatchObject({ status:'ok',amount:5,unit:'USD' });
    const row = await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(id).first<{credentials:string}>();
    expect(row!.credentials.startsWith('v1:')).toBe(true); expect(row!.credentials).not.toContain(token);
    expect(JSON.parse(await decryptSecret(row!.credentials,testEnv))).toEqual({ accessToken:token,userId:'42' });
    const edited = await call(`/api/channels/${id}`,'PATCH',{ name:'Kept token' });
    expect(edited.json.channel.accountAuthMode).toBe('token');
    expect((await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(id).first<{credentials:string}>())?.credentials).toBe(row!.credentials);
    const clone = await call(`/api/channels/${id}/clone`,'POST',{});
    expect(clone.json.channel.hasAccountCredentials).toBe(false); expect(clone.json.channel.accountAuthMode).toBeUndefined();
    expect(created.content+edited.content+clone.content+(await call('/api/bootstrap')).content).not.toContain(token);
    mockAccount();
    const replaced = await call(`/api/channels/${id}`,'PATCH',{ accountCredentials:{ username:'updated-user',password:'updated-password' } });
    expect(replaced.status).toBe(200); expect(replaced.json.channel.accountAuthMode).toBe('password');
    const next = await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(id).first<{credentials:string}>();
    expect(JSON.parse(await decryptSecret(next!.credentials,testEnv))).toEqual({ username:'updated-user',password:'updated-password' });
  });
  it('imports NewAPI token accounts with public mode metadata and encrypted credentials', async () => {
    const token = 'private-imported-dashboard-token';
    const result = await call('/api/channels/import','POST',{ channels:[{ name:'Imported token',endpoint:'https://account.example/v1',models:['a'],config:{ integration:'newapi' },accountCredentials:{ accessToken:token } }] });
    expect(result.status).toBe(201); expect(result.json.channels[0].accountAuthMode).toBe('token');
    expect(result.content).not.toContain(token);
    const saved = await new Store(testEnv).getChannel(result.json.channels[0].id);
    expect(saved?.accountAuthMode).toBe('token'); expect(saved?.hasAccountCredentials).toBe(true);
    const row = await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(saved!.id).first<{credentials:string}>();
    expect(JSON.parse(await decryptSecret(row!.credentials,testEnv))).toEqual({ accessToken:token });
  });
  it('preserves the current authentication mode when an older metadata snapshot is saved', async () => {
    mockAccount();
    const created = await accountChannel();
    const store = new Store(testEnv);
    const stale = (await store.getChannel(created.json.channel.id))!;
    await store.saveChannel(stale,false,[],{ accessToken:'new-dashboard-token',userId:'42' });
    await store.saveChannel({ ...stale,name:'Updated from old snapshot' });
    expect((await store.getChannel(stale.id))?.accountAuthMode).toBe('token');
    const row = await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(stale.id).first<{credentials:string}>();
    expect(JSON.parse(await decryptSecret(row!.credentials,testEnv))).toEqual({ accessToken:'new-dashboard-token',userId:'42' });
    expect((await call(`/api/channels/${stale.id}`,'PATCH',{ config:{ integration:'sub2api' } })).status).toBe(400);
  });
  it('rejects token accounts for Sub2API before writing channels or partial imports', async () => {
    const input = { name:'Unsupported token',endpoint:'https://account.example/v1',models:['a'],config:{ integration:'sub2api' },accountCredentials:{ accessToken:'private-token' } };
    expect((await call('/api/channels','POST',input)).status).toBe(400);
    expect((await call('/api/channels/import','POST',{ channels:[{ ...input,name:'Valid token',config:{ integration:'newapi' } },input] })).status).toBe(400);
    expect(await new Store(testEnv).listChannels()).toEqual([]);
  });
  it('completes a NewAPI encrypted-password handshake after ordinary login is rejected', async () => {
    const pair = await crypto.subtle.generateKey({ name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256' },true,['encrypt','decrypt']);
    const exported = new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey));
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...exported))}\n-----END PUBLIC KEY-----`;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/status') return Response.json({ success:true,data:{ password_login_encryption_enabled:true,quota_per_unit:500000 } });
      if (path === '/api/user/login/encryption-key') return Response.json({ success:true,data:{ enabled:true,kid:'test-kid',public_key:publicKey } });
      if (path === '/api/user/login') {
        const payload = JSON.parse(String(init?.body));
        if (payload.password) return Response.json({ success:false,message:'Encrypted password required' });
        expect(payload.encryption_key_id).toBe('test-kid'); expect(payload.password).toBeUndefined();
        const ciphertext = Uint8Array.from(atob(payload.password_encrypted), c => c.charCodeAt(0));
        expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name:'RSA-OAEP' },pair.privateKey,ciphertext))).toBe('fake-account-password');
        return Response.json({ success:true,data:{ access_token:'fake-session',user:{ id:42 },expires_in:3600 } });
      }
      return Response.json({ success:true,data:{ quota:5000000 } });
    });
    vi.stubGlobal('fetch',fetcher);
    const result = await accountChannel();
    expect((await new Store(testEnv).getChannel(result.json.channel.id))?.accountBalance?.amount).toBe(10);
    expect(fetcher.mock.calls.filter(([target]) => new URL(String(target)).pathname === '/api/user/login')).toHaveLength(2);
  });
  it('encrypts account data and sessions, keeps edits blank, and does not copy accounts', async () => {
    mockAccount(); const created = await accountChannel(); const id = created.json.channel.id;
    const row = await testEnv.DB.prepare('SELECT * FROM channel_accounts WHERE channel_id=?').bind(id).first<{ credentials:string;auth_secret:string;balance:string }>();
    expect(JSON.parse(await decryptSecret(row!.credentials,testEnv))).toEqual({ username:'fake-user@example.com',password:'fake-account-password' });
    expect(row!.credentials).not.toContain('fake-account-password'); expect(row!.auth_secret).not.toContain('private-session-token');
    expect(JSON.parse(row!.balance).amount).toBe(12.5);
    const patched = await call(`/api/channels/${id}`,'PATCH',{ name:'Edited' });
    expect(patched.json.channel.hasAccountCredentials).toBe(true); expect(patched.json.channel.accountBalance.amount).toBe(12.5);
    const clone = await call(`/api/channels/${id}/clone`,'POST',{}); expect(clone.json.channel.hasAccountCredentials).toBe(false);
    expect(await testEnv.DB.prepare('SELECT channel_id FROM channel_accounts WHERE channel_id=?').bind(clone.json.channel.id).first()).toBeNull();
    for (const secret of ['fake-user@example.com','fake-account-password','private-session-token']) { expect(created.content+patched.content+(await call('/api/bootstrap')).content).not.toContain(secret); }
    expect((await testEnv.DB.prepare('SELECT credentials FROM channel_accounts WHERE channel_id=?').bind(id).first<{ credentials:string }>())?.credentials).toBe(row!.credentials);
  });
  it('requires a complete account and validates before modifying metadata', async () => {
    expect((await call('/api/channels','POST',{ name:'Missing account',endpoint:'https://account.example/v1',models:['a'],config:{ integration:'newapi' } })).status).toBe(400);
    mockAccount(); const created = await accountChannel('sub2api');
    expect((await call(`/api/channels/${created.json.channel.id}`,'PATCH',{ name:'Should not change',accountCredentials:{ username:'incomplete' } })).status).toBe(400);
    expect((await new Store(testEnv).getChannel(created.json.channel.id))?.name).toBe('Account test');
  });
  it('validates every imported account before creating any channel', async () => {
    const result = await call('/api/channels/import','POST',{ channels:[{ name:'Valid first',endpoint:'https://models.example/v1',models:['a'] },{ name:'Incomplete second',endpoint:'https://account.example/v1',models:['a'],config:{ integration:'newapi' },accountCredentials:{ username:'incomplete' } }] });
    expect(result.status).toBe(400); expect(await new Store(testEnv).listChannels()).toEqual([]);
  });
  it('pre-encrypts the entire import and leaves no channels or tags after a later encryption failure', async () => {
    const result = await call('/api/channels/import','POST',{ channels:[
      { name:'First no keys',endpoint:'https://models.example/v1',models:['a'],tags:['must-not-remain'] },
      { name:'Later key',endpoint:'https://models.example/v1',models:['a'],apiKeys:['private-imported-key'] },
    ] },true,{ ...testEnv,ENCRYPTION_KEY:undefined });
    expect(result.status).toBe(500); expect(await new Store(testEnv).listChannels()).toEqual([]); expect(await new Store(testEnv).listTags()).toEqual([]);
  });
  it('imports credentials and management accounts atomically without exposing secrets', async () => {
    const result = await call('/api/channels/import','POST',{ channels:[
      { name:'Plain',endpoint:'https://models.example/v1',models:['a'],tags:['shared'],apiKeys:['imported-private-key'] },
      { name:'Managed',endpoint:'https://account.example/v1',models:['a'],tags:['shared'],config:{ integration:'sub2api' },accountCredentials:{ username:'private-user@example.com',password:'private-password' } },
    ] });
    expect(result.status).toBe(201); expect(result.json.channels).toHaveLength(2); expect(await new Store(testEnv).listTags()).toEqual(['shared']);
    const plain = result.json.channels.find((c:GatewayChannel) => c.name === 'Plain'); const managed = result.json.channels.find((c:GatewayChannel) => c.name === 'Managed');
    expect((await new Store(testEnv).getCredentials(plain.id))[0].secret).toBe('imported-private-key');
    expect(managed.hasAccountCredentials).toBe(true); expect(managed.accountBalance.status).toBe('pending');
    for (const secret of ['imported-private-key','private-user@example.com','private-password']) expect(result.content).not.toContain(secret);
  });
  it('rolls back every imported channel, tag and key if the final D1 write is rejected', async () => {
    await testEnv.DB.exec("CREATE TRIGGER reject_imported_key BEFORE INSERT ON credentials WHEN NEW.label='reject-import' BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
    try {
      const result = await call('/api/channels/import','POST',{ channels:[
        { name:'First',endpoint:'https://models.example/v1',models:['a'],tags:['rolled-back'] },
        { name:'Second',endpoint:'https://models.example/v1',models:['a'],apiKeys:[{ label:'reject-import',secret:'private-key' }] },
      ] });
      expect(result.status).toBe(500); const store = new Store(testEnv); expect(await store.listChannels()).toEqual([]); expect(await store.listTags()).toEqual([]);
      expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM credentials').first<{count:number}>())?.count).toBe(0);
    } finally { await testEnv.DB.exec('DROP TRIGGER reject_imported_key'); }
  });
  it('invalidates cached sessions and balances when the configured site changes', async () => {
    mockAccount(); const created = await accountChannel(); const store = new Store(testEnv); const id = created.json.channel.id;
    const before = await testEnv.DB.prepare('SELECT credentials,version FROM channel_accounts WHERE channel_id=?').bind(id).first<{ credentials:string;version:number }>();
    await store.saveChannel({ ...(await store.getChannel(id))!,endpoint:'https://another-site.example/v1' });
    const row = await testEnv.DB.prepare('SELECT * FROM channel_accounts WHERE channel_id=?').bind(id).first<{ credentials:string;auth_secret:string|null;balance:string|null;version:number;next_refresh_at:number }>();
    expect(row?.credentials).toBe(before?.credentials); expect(row?.auth_secret).toBeNull(); expect(row?.balance).toBeNull(); expect(row?.version).toBe(before!.version+1); expect(row?.next_refresh_at).toBe(0);
    expect((await store.getChannel(id))?.accountBalance?.status).toBe('pending');
  });
  it('pairs fresh credentials with their current site even when Cron supplies an older channel snapshot', async () => {
    mockAccount(); const created = await accountChannel(); const store = new Store(testEnv);
    const stale = (await store.getChannel(created.json.channel.id))!;
    await store.saveChannel({ ...stale,endpoint:'https://new-account-site.example/v1' },false,[],{ username:'new-user@example.com',password:'new-account-password' });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).hostname).toBe('new-account-site.example');
      if (new URL(String(input)).pathname.endsWith('/login')) {
        expect(JSON.parse(String(init?.body))).toEqual({ username:'new-user@example.com',password:'new-account-password' });
        return Response.json({ success:true,data:{ access_token:'new-session',user:{ id:55 } } });
      }
      return Response.json({ success:true,data:{ quota:1500000,quota_per_unit:500000 } });
    });
    vi.stubGlobal('fetch',fetcher);
    await refreshAccountBalance(testEnv,stale,true,true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await store.getChannel(stale.id))?.accountBalance?.amount).toBe(3);
  });
  it('throttles automatic refresh, allows forced refresh, and preserves last known balance on failure', async () => {
    mockAccount(); const created = await accountChannel(); const store = new Store(testEnv); const channel = (await store.getChannel(created.json.channel.id))!;
    const fetcher = vi.fn(async () => Response.json({ success:true,data:{ quota:1000000,quota_per_unit:500000 } })); vi.stubGlobal('fetch',fetcher);
    await refreshAccountBalance(testEnv,channel,true); expect(fetcher).not.toHaveBeenCalled();
    await refreshAccountBalance(testEnv,channel,true,true); expect((await store.getChannel(channel.id))?.accountBalance?.amount).toBe(2);
    vi.stubGlobal('fetch',vi.fn(async () => Response.json({ message:'fake-account-password private-session-token' },{ status:503 })));
    await refreshAccountBalance(testEnv,channel,true,true);
    const result = (await store.getChannel(channel.id))?.accountBalance;
    expect(result?.status).toBe('error'); expect(result?.amount).toBe(2); expect(result?.updatedAt).not.toBeNull(); expect(JSON.stringify(result)).not.toContain('fake-account-password');
  });
  it('does not let archived accounts consume scheduled refresh slots', async () => {
    mockAccount(); const created = await accountChannel(); const store = new Store(testEnv); const channel = (await store.getChannel(created.json.channel.id))!;
    await store.saveChannel({ ...channel,archived:true });
    await testEnv.DB.prepare('UPDATE channel_accounts SET next_refresh_at=0').run();
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    await refreshDueAccounts(testEnv,await store.listChannels(),true); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds scheduled account work to five and bootstrap work to one three-account batch', async () => {
    mockAccount();
    for (let i=0;i<7;i++) await accountChannel();
    await testEnv.DB.prepare('UPDATE channel_accounts SET next_refresh_at=0').run();
    await refreshDueAccounts(testEnv,await new Store(testEnv).listChannels(),true);
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM channel_accounts WHERE next_refresh_at>0').first<{count:number}>())?.count).toBe(5);
    await testEnv.DB.prepare('UPDATE channel_accounts SET next_refresh_at=0').run();
    await call('/api/bootstrap');
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM channel_accounts WHERE next_refresh_at>0').first<{count:number}>())?.count).toBe(3);
  });
});
