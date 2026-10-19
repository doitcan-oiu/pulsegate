import { ref, shallowRef, watch, type WatchStopHandle } from 'vue';
import type { BootstrapData, DashboardData, GatewayApiKey, GatewayChannel, GatewaySettings } from '../../shared/types';
import { defaultSettings } from '../../shared/types';
import { api, ApiError } from '../api';
import { consoleRouteHash, readConsoleRoute, type ConsolePage } from '../navigation';
import { errorText } from '../format';

export type Session = { authenticated: boolean; devMode: boolean; configured: boolean };
const route = readConsoleRoute();
const page = ref<ConsolePage>(route.page);
const settingsTab = ref<'connection' | 'routing'>(route.settingsTab);
const session = ref<Session | null>(null);
const channels = ref<GatewayChannel[]>([]), keys = ref<GatewayApiKey[]>([]), tags = ref<string[]>([]);
const settings = ref<GatewaySettings>(structuredClone(defaultSettings));
const dashboard = ref<DashboardData>({ totals: { requests: 0, successRate: 0, averageTtft: 0, failovers: 0, inputTokens: 0, outputTokens: 0, cost: 0 }, latency: [], channels: [], events: [] });
const range = ref<'1h' | '24h' | '7d'>('24h');
const loading = ref(false), ready = ref(false), connectionError = ref(''), metricsError = ref('');
const lastUpdated = ref<Date | null>(null), channelToEdit = shallowRef<GatewayChannel | 'new' | null>(null);
const playChannel = ref<string>(), playVersion = ref(0);
const snackbar = ref({ show: false, text: '', color: 'success' });
const logoutOpen = ref(false), logoutBusy = ref(false), logoutHasDrafts = ref(false);
const editors = new Map<string, () => { dirty: boolean; busy: boolean }>();
function registerEditor(id: string, state: () => { dirty: boolean; busy: boolean }) { editors.set(id, state); return () => { editors.delete(id); }; }
function requestLogout() {
  const states = [...editors.values()].map(state => state());
  if (states.some(state => state.busy)) { notify('设置正在保存，请稍后退出', 'warning'); return; }
  logoutHasDrafts.value = states.some(state => state.dirty); logoutOpen.value = true;
}
let refreshVersion = 0, eventId: string | null = null, interval: ReturnType<typeof setInterval> | undefined;
let stopRouteWatch: WatchStopHandle | undefined, initialized = false;
const pageNames: Record<ConsolePage, string> = { overview: '网关概览', channels: '渠道管理', keys: 'API Keys', playground: '测试场', requests: '请求日志', analytics: '用量分析', settings: '网关设置', routing: '网关设置' };
const hasDashboard = (value: { events: DashboardData['events'] }): value is DashboardData => 'totals' in value && 'latency' in value && 'channels' in value;

function notify(message: string, color: 'success' | 'error' | 'warning' | 'info' = 'success') { snackbar.value = { show: true, text: message, color }; }
async function copy(value: string) { try { await navigator.clipboard.writeText(value); notify('已复制到剪贴板'); } catch { notify('复制失败，请手动选择文本', 'error'); } }
function restoreRoute() { const next = readConsoleRoute(); page.value = next.page; settingsTab.value = next.settingsTab; }
function navigate(destination: ConsolePage, tab?: 'connection' | 'routing') {
  const nextPage = destination === 'routing' ? 'settings' : destination;
  const nextTab = tab ?? (destination === 'routing' ? 'routing' : 'connection');
  const hash = consoleRouteHash(nextPage, nextTab);
  if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  page.value = nextPage;
  if (nextPage === 'settings') settingsTab.value = nextTab;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => {
    if (!document.querySelector('.v-overlay--active.v-dialog')) document.getElementById('main-content')?.focus({ preventScroll: true });
  });
}
function openPlayground(id?: string) { playChannel.value = id; playVersion.value++; navigate('playground'); }
function editChannel(channel: GatewayChannel | 'new') { channelToEdit.value = channel; navigate('channels'); }
async function refresh(quiet = false) {
  const version = ++refreshVersion;
  if (!quiet) loading.value = true;
  try {
    const metrics = page.value === 'overview' || page.value === 'analytics';
    const [configuration, activity] = await Promise.allSettled([
      api<BootstrapData>('/api/bootstrap'),
      metrics ? api<DashboardData>('/api/dashboard?range=' + range.value) : api<{ events: DashboardData['events'] }>('/api/events'),
    ]);
    if (version !== refreshVersion) return;
    if (configuration.status === 'rejected') throw configuration.reason;
    const data = configuration.value;
    channels.value = data.channels; keys.value = data.keys; tags.value = data.tags; settings.value = data.settings;
    ready.value = true; connectionError.value = ''; lastUpdated.value = new Date();
    if (activity.status === 'rejected') { if (metrics) metricsError.value = errorText(activity.reason); return; }
    if (hasDashboard(activity.value)) { dashboard.value = activity.value; metricsError.value = ''; }
    else dashboard.value.events = activity.value.events;
    const latest = activity.value.events[0];
    if (latest && eventId && latest.id !== eventId && data.settings.notifications) notify(`${latest.title}：${latest.description}`, 'info');
    if (latest) eventId = latest.id;
  } catch (error) {
    if (version !== refreshVersion) return;
    if (error instanceof ApiError && error.status === 401) { if (session.value) session.value.authenticated = false; ready.value = false; }
    else { connectionError.value = errorText(error); if (!quiet) notify(errorText(error), 'error'); }
  } finally { if (version === refreshVersion) loading.value = false; }
}
async function startSession() {
  connectionError.value = '';
  try {
    let next = await api<Session>('/api/session');
    if (!next.authenticated && next.devMode) { await api('/api/session', { method: 'POST', body: JSON.stringify({ dev: true }) }); next = await api<Session>('/api/session'); }
    session.value = next;
    if (next.authenticated) await refresh();
  } catch (error) { connectionError.value = errorText(error); }
}
async function login(token: string) { await api('/api/session', { method: 'POST', body: JSON.stringify({ token }) }); await startSession(); }
async function performLogout() {
  ++refreshVersion;
  loading.value = false;
  await api('/api/session', { method: 'DELETE' });
  session.value = session.value ? { ...session.value, authenticated: false } : null;
  ready.value = false; channels.value = []; keys.value = []; channelToEdit.value = null;
}
async function confirmLogout() {
  if (logoutBusy.value) return;
  if ([...editors.values()].some(state => state().busy)) { notify('设置正在保存，请稍后退出', 'warning'); return; }
  logoutBusy.value = true;
  try { await performLogout(); logoutOpen.value = false; } catch (error) { notify(errorText(error), 'error'); } finally { logoutBusy.value = false; }
}
async function initialize() {
  if (initialized) return;
  initialized = true;
  if (!window.location.hash) window.history.replaceState(null, '', consoleRouteHash(page.value, settingsTab.value));
  window.addEventListener('popstate', restoreRoute); window.addEventListener('hashchange', restoreRoute);
  stopRouteWatch = watch([page, range], () => { document.title = `${pageNames[page.value]} · PulseGate`; if (session.value?.authenticated) void refresh(); });
  document.title = `${pageNames[page.value]} · PulseGate`;
  interval = setInterval(() => { if (document.visibilityState === 'visible' && session.value?.authenticated) void refresh(true); }, 15000);
  await startSession();
}
function dispose() { ++refreshVersion; if (interval) clearInterval(interval); stopRouteWatch?.(); window.removeEventListener('popstate', restoreRoute); window.removeEventListener('hashchange', restoreRoute); initialized = false; }
export function useConsole() { return { page, settingsTab, session, channels, keys, tags, settings, dashboard, range, loading, ready, connectionError, metricsError, lastUpdated, channelToEdit, playChannel, playVersion, snackbar, refresh, notify, copy, navigate, openPlayground, editChannel, login, logout: requestLogout, requestLogout, logoutOpen, logoutBusy, logoutHasDrafts, confirmLogout, registerEditor, initialize, dispose, startSession }; }
