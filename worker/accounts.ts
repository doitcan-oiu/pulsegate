import type { GatewayChannel } from '../shared/types';
import type { Env } from './env';
import { encryptSecret, decryptSecret } from './crypto';
import { HttpError, assert, object, text, url } from './validation';
import { readUpstreamJSON } from './upstream-http';
import { newApiLoginPayload } from './newapi-login';

type PasswordCredentials = { username: string; password: string };
export type AccountCredentials = PasswordCredentials | { accessToken: string; userId?: string };
type Balance = NonNullable<GatewayChannel['accountBalance']>;
type AccountRow = { channel_id: string; credentials: string; auth_secret: string | null; balance: string | null; version: number; channel_data: string };
type Session = { token?: string; cookie?: string; userId?: string; expiresAt: number; base: string };
export const BALANCE_REFRESH_MS = 5 * 60 * 1000;

export function accountIntegration(channel: GatewayChannel): GatewayChannel['accountIntegration'] {
  return channel.accountIntegration ?? (channel.hasAccountCredentials && ['newapi', 'sub2api'].includes(channel.config.integration ?? '') ? channel.config.integration as 'newapi' | 'sub2api' : undefined);
}

export function assertAccountReuse(channel: GatewayChannel, previous: GatewayChannel | null, account?: AccountCredentials): void {
  const integration = channel.config.integration;
  if (!['newapi', 'sub2api'].includes(integration ?? '')) return;
  if (account) {
    assert(!('accessToken' in account) || integration === 'newapi', '后台访问令牌仅支持 NewAPI 渠道');
    return;
  }
  assert(previous?.hasAccountCredentials && accountIntegration(previous) === integration, '开启余额监控或切换后台类型时，请填写对应的后台凭据');
}

export function parseAccountCredentials(value: unknown): AccountCredentials | undefined {
  if (value === undefined) return undefined;
  const b = object(value);
  if (b.accessToken !== undefined) {
    const accessToken = text(b.accessToken, '', 4096).trim();
    assert(accessToken && !/[\s\x00-\x1f\x7f]/.test(accessToken), '后台访问令牌不能为空或包含空白、控制字符');
    assert(!text(b.username, '', 256).trim() && !text(b.password, '', 4096), '后台访问令牌与账号密码不能同时填写');
    const userId = text(b.userId, '', 20).trim();
    assert(!userId || /^\d+$/.test(userId) && Number.isSafeInteger(Number(userId)) && Number(userId) > 0, '用户 ID 须为正整数，且不超过安全整数范围');
    return { accessToken, ...(userId ? { userId: String(Number(userId)) } : {}) };
  }
  assert(b.userId === undefined || !text(b.userId, '', 20).trim(), '用户 ID 仅用于后台访问令牌登录');
  const username = text(b.username, '', 256).trim();
  const password = text(b.password, '', 4096);
  assert(username && password, '账号和密码须同时填写');
  return { username, password };
}

export async function prepareAccountSave(env: Env, channel: GatewayChannel, account?: AccountCredentials): Promise<D1PreparedStatement | null> {
  if (!account) return null;
  assert(['newapi', 'sub2api'].includes(channel.config.integration ?? ''), '仅 NewAPI / Sub2API 渠道使用后台账号');
  assert(!('accessToken' in account) || channel.config.integration === 'newapi', '后台访问令牌仅支持 NewAPI 渠道');
  const encrypted = await encryptSecret(JSON.stringify(account), env);
  return env.DB.prepare('INSERT INTO channel_accounts(channel_id,credentials) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET credentials=excluded.credentials,auth_secret=NULL,balance=NULL,next_refresh_at=0,lease_until=0,version=channel_accounts.version+1').bind(channel.id, encrypted);
}

export function accountBase(channel: GatewayChannel, dev: boolean): string {
  const base = new URL(url(channel.endpoint, dev));
  // Preserve a deployment subdirectory, but remove the API version prefix.
  base.pathname = base.pathname.replace(/\/(?:v1|v1beta)\/?$/, '').replace(/\/$/, '');
  return base.toString().replace(/\/$/, '');
}

function newApiAuthError(json: Record<string, any>): HttpError | undefined {
  // Only recognize documented categories; never place an upstream message in saved metadata.
  const code = typeof json.code === 'string' ? json.code : '';
  const message = typeof json.message === 'string' ? json.message.trim() : '';
  if (message === '无权进行此操作，未提供 New-Api-User') return new HttpError(401, '此 NewAPI 后台需要用户 ID，请在后台访问令牌配置中填写用户 ID');
  if (message === '无权进行此操作，New-Api-User 格式错误' || message === '无权进行此操作，New-Api-User 与登录用户不匹配') return new HttpError(401, '后台用户 ID 无效或与访问令牌不匹配，请检查用户 ID');
  if (['AUTH_UNAUTHORIZED', 'AUTH_TOKEN_EXPIRED', 'AUTH_SESSION_REVOKED', 'AUTH_USER_INVALID', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_LEGACY_RETIRED'].includes(code) || [
    '无权进行此操作，未登录且未提供 access token', '无权进行此操作，access token 无效', '无权进行此操作，用户信息无效',
    'Unauthorized, not logged in and no access token provided', 'Unauthorized, invalid access token', 'Unauthorized, invalid user info', 'Unauthorized, the access token has expired',
  ].includes(message)) return new HttpError(401, '后台会话或访问令牌失效，请重新登录或更新后台访问令牌');
  if (code === 'AUTH_USER_DISABLED' || ['用户已被封禁', 'User has been banned'].includes(message)) return new HttpError(403, '后台账号已被禁用，请联系站点管理员');
  if (['AUTH_INSUFFICIENT_PRIVILEGE', 'ACCESS_TOKEN_SCOPE_DENIED', 'ACCESS_TOKEN_ROUTE_UNDECLARED', 'AUTH_SESSION_REQUIRED'].includes(code) || ['无权进行此操作，权限不足', 'Unauthorized, insufficient privileges'].includes(message)) return new HttpError(403, '后台访问令牌权限不足，请使用可读取个人资料的后台访问令牌');
  return undefined;
}

async function accountRequest(base: string, path: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ json: Record<string, any>; response: Response }> {
  const response = await fetch(base + path, { ...init, redirect: 'manual', signal, headers: { Accept: 'application/json', ...init.headers } });
  const newApi = path.startsWith('/api/user/');
  if (!response.ok) {
    if (newApi && [401, 403].includes(response.status)) {
      let authError: HttpError | undefined;
      try { authError = newApiAuthError(await readUpstreamJSON(response, 512 * 1024)); }
      catch { /* An unrecognized response still retains the original HTTP status. */ }
      if (authError) throw authError;
    } else await response.body?.cancel();
    throw new HttpError(response.status, `后台接口 HTTP ${response.status}`);
  }
  const json = await readUpstreamJSON(response, 512 * 1024);
  if (json.success === false || (json.code !== undefined && ![0, 200].includes(Number(json.code)))) throw (newApi ? newApiAuthError(json) : undefined) ?? new HttpError(502, '后台拒绝请求；请检查账号、密码及后台登录验证要求');
  return { json, response };
}

async function loginAccount(channel: GatewayChannel, credentials: PasswordCredentials, base: string, signal: AbortSignal): Promise<Session> {
  const sub = channel.config.integration === 'sub2api';
  const sendLogin = (payload: unknown) => accountRequest(base, sub ? '/api/v1/auth/login' : '/api/user/login', signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let login;
  try { login = await sendLogin(sub ? { email:credentials.username,password:credentials.password } : credentials); }
  catch (error) {
    if (sub || !(error instanceof HttpError) || ![400,401,403,502].includes(error.status)) throw error;
    const encrypted = await newApiLoginPayload(base,credentials,signal);
    if (!encrypted.password_encrypted) throw error;
    login = await sendLogin(encrypted);
  }
  const { json, response } = login;
  const data = json.data ?? json;
  if (data.requires_2fa || data.require_2fa || data.verification_required || data.require_verification || data.challenge_id || data.flow_token) throw new HttpError(409, sub ? '后台要求二次验证，暂时无法自动刷新余额' : '后台要求二次验证，请改用后台访问令牌刷新余额');
  const token = typeof data.access_token === 'string' ? data.access_token : typeof data.token === 'string' ? data.token : undefined;
  const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => c && !c.endsWith('=')).join('; ');
  if (!token && !cookies) throw new HttpError(502, '后台登录未返回会话；请检查账号及验证码/二次验证要求');
  const userId = data.user?.id ?? data.id;
  const expiry = Number(data.access_expires_at) * 1000;
  const expiresAt = Number.isFinite(expiry) && expiry > Date.now() ? Math.min(expiry, Date.now() + 86400000) : Date.now() + Math.min(86400, Math.max(60, Number(data.expires_in) || 3600)) * 1000;
  return { token, cookie: cookies || undefined, ...(Number.isSafeInteger(Number(userId)) && Number(userId) > 0 ? { userId: String(userId) } : {}), expiresAt, base };
}

function sessionHeaders(session: Session): Record<string, string> {
  return { ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(session.cookie && !session.token ? { Cookie: session.cookie } : {}), ...(session.userId ? { 'New-Api-User': session.userId } : {}) };
}
function finiteAmount(value: unknown): number {
  if (value === null || value === undefined || value === '' || !['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value))) throw new HttpError(502, '后台未返回有效余额');
  return Number(value);
}

export async function fetchAccountBalance(channel: GatewayChannel, credentials: AccountCredentials, dev: boolean, cached?: Session): Promise<{ amount: number; unit: string; session: Session }> {
  const base = accountBase(channel, dev); const signal = AbortSignal.timeout(20000);
  const sub = channel.config.integration === 'sub2api';
  const tokenMode = 'accessToken' in credentials;
  assert(!tokenMode || channel.config.integration === 'newapi', '后台访问令牌仅支持 NewAPI 渠道');
  const reusedSession = !tokenMode && !!cached && cached.base === base && cached.expiresAt > Date.now() + 10000;
  let session: Session = tokenMode ? { token: credentials.accessToken, userId: credentials.userId, expiresAt: Date.now() + 3600000, base } : reusedSession ? cached! : await loginAccount(channel, credentials, base, signal);
  const profile = async () => (await accountRequest(base, sub ? '/api/v1/user/profile' : '/api/user/self', signal, { headers: sessionHeaders(session) })).json;
  let payload: Record<string, any>;
  try { payload = await profile(); }
  catch (error) {
    if (tokenMode || !reusedSession || !(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
    session = await loginAccount(channel, credentials, base, signal); payload = await profile();
  }
  const data = payload.data ?? payload;
  if (sub) return { amount: finiteAmount(data.balance), unit: 'USD', session };
  const quota = finiteAmount(data.quota);
  // A custom site may use a different quota scale; never assume 500000.
  let scale: number | null = null;
  try {
    const status = (await accountRequest(base, '/api/status', signal)).json;
    const value = Number((status.data ?? status).quota_per_unit);
    if (Number.isFinite(value) && value > 0) scale = value;
  } catch { /* Raw quota is still a valid balance when currency metadata is unavailable. */ }
  return { amount: scale ? quota / scale : quota, unit: scale ? 'USD' : '额度', session };
}

export async function refreshAccountBalance(env: Env, channel: GatewayChannel, dev: boolean, force = false): Promise<void> {
  if (!['newapi', 'sub2api'].includes(channel.config.integration ?? '')) return;
  const now = Date.now();
  // Capture the destination and credentials in one atomic read. A Cron snapshot can
  // outlive a channel edit; never pair a new password with that snapshot's old URL.
  const claimed = await env.DB.prepare("UPDATE channel_accounts SET lease_until=? WHERE channel_id=? AND lease_until<=? AND (?=1 OR next_refresh_at<=?) AND EXISTS (SELECT 1 FROM channels c WHERE c.id=channel_accounts.channel_id AND COALESCE(json_extract(c.data,'$.archived'),0)=0 AND json_extract(c.data,'$.config.integration') IN ('newapi','sub2api')) RETURNING *, (SELECT data FROM channels WHERE id=channel_accounts.channel_id) AS channel_data").bind(now + 45000, channel.id, now, force ? 1 : 0, now).first<AccountRow>();
  if (!claimed) return;
  const old = claimed.balance ? JSON.parse(claimed.balance) as Balance : null;
  try {
    const credentials = JSON.parse(await decryptSecret(claimed.credentials, env)) as AccountCredentials;
    const session = claimed.auth_secret ? JSON.parse(await decryptSecret(claimed.auth_secret, env)) as Session : undefined;
    const currentChannel = JSON.parse(claimed.channel_data) as GatewayChannel;
    const result = await fetchAccountBalance(currentChannel, credentials, dev, session);
    const balance: Balance = { status: 'ok', amount: result.amount, unit: result.unit, updatedAt: new Date().toISOString(), checkedAt: new Date().toISOString() };
    const auth = await encryptSecret(JSON.stringify(result.session), env);
    await env.DB.prepare('UPDATE channel_accounts SET balance=?,auth_secret=?,next_refresh_at=?,lease_until=0 WHERE channel_id=? AND version=?').bind(JSON.stringify(balance), auth, now + BALANCE_REFRESH_MS, channel.id, claimed.version).run();
  } catch (error) {
    // Do not copy provider error bodies, account IDs or session tokens into metadata.
    const message = error instanceof HttpError ? error.message : '余额刷新失败，请检查后台连接与加密配置';
    const balance: Balance = { status: 'error', amount: old?.amount ?? null, unit: old?.unit ?? '', updatedAt: old?.updatedAt ?? null, checkedAt: new Date().toISOString(), error: message };
    await env.DB.prepare('UPDATE channel_accounts SET balance=?,next_refresh_at=?,lease_until=0 WHERE channel_id=? AND version=?').bind(JSON.stringify(balance), now + BALANCE_REFRESH_MS, channel.id, claimed.version).run();
  }
}

export async function refreshDueAccounts(env: Env, channels: GatewayChannel[], dev: boolean, limit = 5): Promise<void> {
  // A rejected cached session plus encrypted NewAPI login can require seven fetches.
  // Five accounts plus eight recovery probes stay below the Free plan's 50 external fetches.
  const boundedLimit = Math.min(5, Math.max(0, Math.floor(limit)));
  const due = await env.DB.prepare("SELECT a.channel_id FROM channel_accounts a JOIN channels c ON c.id=a.channel_id WHERE a.next_refresh_at<=? AND a.lease_until<=? AND COALESCE(json_extract(c.data,'$.archived'),0)=0 AND json_extract(c.data,'$.config.integration') IN ('newapi','sub2api') ORDER BY a.next_refresh_at LIMIT ?").bind(Date.now(), Date.now(), boundedLimit).all<{ channel_id: string }>();
  // Bounded batches leave headroom for normal gateway traffic and Cron subrequest limits.
  for (let i = 0; i < due.results.length; i += 3) {
    await Promise.allSettled(due.results.slice(i, i + 3).map(({ channel_id }) => {
      const channel = channels.find(c => c.id === channel_id);
      return channel ? refreshAccountBalance(env, channel, dev) : Promise.resolve();
    }));
  }
}
