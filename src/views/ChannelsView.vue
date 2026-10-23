<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import type { GatewayChannel } from '../../shared/types';
import { api } from '../api';
import { channelHealthView, matchesChannelHealthStatus } from '../channel-health';
import { count, dateTime, download, errorText, seconds } from '../format';
import { useConsole } from '../composables/useConsole';
import AppDialog from '../components/AppDialog.vue';
import ChannelEditor from '../components/channels/ChannelEditor.vue';
import ChannelOperations from '../components/channels/ChannelOperations.vue';
import ChannelManagement from '../components/channels/ChannelManagement.vue';
import ChannelHealth from '../components/channels/ChannelHealth.vue';
import ChannelTagFilter from '../components/channels/ChannelTagFilter.vue';
const { channels, tags, session, channelToEdit, editChannel, openPlayground, navigate, refresh, loading, notify } = useConsole();
const { mdAndUp } = useDisplay();
const columns = [{ key: 'priority', title: '优先级' }, { key: 'enabled', title: '启用' }, { key: 'health', title: '健康 / 首字' }, { key: 'models', title: '支持的模型' }, { key: 'provider', title: '服务商' }, { key: 'weight', title: '权重' }, { key: 'createdAt', title: '创建时间' }];
const defaults = ['enabled', 'health', 'models'];
function savedView() {
  try {
    const current = localStorage.getItem('pulsegate.channel-view.v4');
    const value = JSON.parse(current ?? localStorage.getItem('pulsegate.channel-view.v3') ?? '{}');
    const savedColumns = Array.isArray(value.columns) ? value.columns.filter((key: string) => columns.some(column => column.key === key)) as string[] : [...defaults];
    // Retire the old all-column default while retaining deliberately customized views.
    const migratedColumns = !current && columns.every(column => savedColumns.includes(column.key)) ? [...defaults] : savedColumns;
    return { size: [10, 20, 50, 100].includes(value.size) ? value.size as number : 20, columns: migratedColumns };
  } catch { return { size: 20, columns: [...defaults] }; }
}
const saved = savedView(); const visibleColumns = ref<string[]>(saved.columns); const pageSize = ref(saved.size); const page = ref(1);
const query = ref(''); const providers = ref<string[]>([]); const statuses = ref<string[]>([]); const filterModels = ref<string[]>([]); const filterTags = ref<string[]>([]); const untagged = ref(false); const archive = ref(false);
const selected = ref<string[]>([]); const expanded = ref<string[]>([]); const expandedModels = ref<string[]>([]); const tagOpen = ref(false); const columnDialog = ref(false); const busy = ref(false); const balanceBusy = ref<string[]>([]);
const filtersOpen = ref(false);
const sortKey = ref<'name' | 'provider' | 'priority' | 'weight' | 'createdAt'>('createdAt'); const ascending = ref(false);
const now = ref(Date.now()); const timer = window.setInterval(() => { now.value = Date.now(); }, 1000); onBeforeUnmount(() => window.clearInterval(timer));
const editor = ref<GatewayChannel | 'new' | null>(null); const operation = ref<{ channel: GatewayChannel; panel: string } | null>(null); const management = ref<string | null>(null);
watch(channelToEdit, value => { if (value) { editor.value = value; channelToEdit.value = null; } }, { immediate: true });
const activeChannels = computed(() => channels.value.filter(channel => !channel.archived));
const scopedChannels = computed(() => channels.value.filter(channel => channel.archived === archive.value));
const healthy = computed(() => activeChannels.value.filter(channel => channelHealthView(channel, now.value).color === 'success').length);
const cooling = computed(() => activeChannels.value.filter(channel => channel.enabled && Date.parse(channel.health.cooldownUntil ?? '') > now.value).length);
const modelCount = computed(() => new Set(activeChannels.value.flatMap(channel => channel.models)).size);
const allTags = computed(() => [...new Set([...tags.value, ...channels.value.flatMap(channel => channel.tags)])].sort());
const allModels = computed(() => [...new Set(channels.value.flatMap(channel => channel.models))].sort());
const allProviders = computed(() => [...new Set(channels.value.map(channel => channel.provider))].sort());
const stateItems = ['健康', '待检测', '待配置密钥', '延迟异常', '不可用', '自动停用', '冷却中', '等待恢复', '已停用', '已归档'];
const activeFilters = computed(() => !!query.value?.trim() || providers.value.length > 0 || statuses.value.length > 0 || filterModels.value.length > 0 || filterTags.value.length > 0 || untagged.value);
const filterCount = computed(() => providers.value.length + statuses.value.length + filterModels.value.length + filterTags.value.length + Number(untagged.value));
function healthFilter(status?: string) { archive.value = false; statuses.value = status ? [status] : []; }
const filtered = computed(() => scopedChannels.value.filter(channel => {
  const text = (query.value ?? '').trim().toLowerCase();
  return (!text || [channel.name, channel.provider, channel.endpoint, ...channel.models, ...channel.tags].some(value => value.toLowerCase().includes(text))) && (!providers.value.length || providers.value.includes(channel.provider)) && matchesChannelHealthStatus(channel, statuses.value, now.value) && (!filterModels.value.length || filterModels.value.some(model => channel.models.includes(model))) && (!filterTags.value.length || filterTags.value.some(tag => channel.tags.some(value => value === tag || value.startsWith(tag + '/')))) && (!untagged.value || !channel.tags.length);
}).sort((a, b) => { const key = sortKey.value; const comparison = key === 'priority' || key === 'weight' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), 'zh-CN'); return (ascending.value ? comparison : -comparison) || a.name.localeCompare(b.name); }));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const shown = computed(() => filtered.value.slice((Math.min(page.value, pageCount.value) - 1) * pageSize.value, Math.min(page.value, pageCount.value) * pageSize.value));
const displayedColumns = computed(() => columns.filter(column => visibleColumns.value.includes(column.key)));
const pageSelected = computed(() => !!shown.value.length && shown.value.every(channel => selected.value.includes(channel.id)));
watch([query, providers, statuses, filterModels, filterTags, untagged, archive, pageSize], () => { page.value = 1; }, { deep: true });
watch(pageCount, value => { if (page.value > value) page.value = value; });
watch([visibleColumns, pageSize], () => { try { localStorage.setItem('pulsegate.channel-view.v4', JSON.stringify({ size: pageSize.value, columns: visibleColumns.value })); } catch { /* Optional browser preferences. */ } }, { deep: true, immediate: true });
watch([channels, archive], () => { selected.value = selected.value.filter(id => scopedChannels.value.some(channel => channel.id === id)); }, { deep: true });
const show = (column: string) => visibleColumns.value.includes(column);
function channelWebsite(channel: GatewayChannel) {
  const website = channel.website?.trim() ?? '';
  if (!/^https?:\/\//i.test(website) || /[\\\x00-\x20\x7f]/.test(website) || website.length > 2048) return '';
  try {
    const parsed = new URL(website);
    const authority = website.slice(website.indexOf('://') + 3).split(/[/?#]/, 1)[0];
    return ['http:', 'https:'].includes(parsed.protocol) && authority && !authority.includes('@') && !parsed.username && !parsed.password ? parsed.href : '';
  } catch { return ''; }
}
function sort(column: string) { if (!['name', 'provider', 'priority', 'weight', 'createdAt'].includes(column)) return; if (sortKey.value === column) ascending.value = !ascending.value; else { sortKey.value = column as typeof sortKey.value; ascending.value = true; } }
function clearFilters() { query.value = ''; providers.value = []; statuses.value = []; filterModels.value = []; filterTags.value = []; untagged.value = false; }
function syncTagFilters(change: { from?: string; to?: string; tags: string[] }) { filterTags.value = [...new Set(filterTags.value.map(tag => change.from === tag && change.to ? change.to : tag))].filter(prefix => change.tags.some(tag => tag === prefix || tag.startsWith(prefix + '/'))); }
function select(id: string) { if (selected.value.includes(id)) selected.value = selected.value.filter(value => value !== id); else if (selected.value.length >= 200) notify('每次最多选择 200 个渠道', 'warning'); else selected.value.push(id); }
function selectPage() { if (pageSelected.value) selected.value = selected.value.filter(id => !shown.value.some(channel => channel.id === id)); else { const next = [...new Set([...selected.value, ...shown.value.map(channel => channel.id)])]; if (next.length > 200) notify('每次最多选择 200 个渠道', 'warning'); else selected.value = next; } }
function toggleExpanded(id: string) { expanded.value = expanded.value.includes(id) ? expanded.value.filter(value => value !== id) : [...expanded.value, id]; }
async function mutate(task: () => Promise<unknown>, message: string) { if (busy.value) return false; busy.value = true; try { await task(); notify(message, 'success'); await refresh(true); return true; } catch (error) { notify(errorText(error), 'error'); return false; } finally { busy.value = false; } }
async function toggleEnabled(channel: GatewayChannel) { await mutate(() => api(`/api/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !channel.enabled }) }), channel.enabled ? '渠道已停用' : '渠道已启用'); }
async function resetHealth(channel: GatewayChannel) { await mutate(async () => { const data = await api<{ channel: GatewayChannel }>(`/api/channels/${encodeURIComponent(channel.id)}/reset-health`, { method: 'POST' }); channels.value = channels.value.map(item => item.id === channel.id ? data.channel : item); }, '冷却和健康异常已清除，等待重新检测'); }
async function refreshBalance(channel: GatewayChannel) {
  if (balanceBusy.value.includes(channel.id) || !channel.hasAccountCredentials) return; balanceBusy.value.push(channel.id);
  try { const data = await api<{ channel: GatewayChannel }>(`/api/channels/${encodeURIComponent(channel.id)}/balance`, { method: 'POST' }); channels.value = channels.value.map(item => item.id === channel.id ? data.channel : item); if (data.channel.accountBalance?.status === 'error') notify(data.channel.accountBalance.error ?? '余额刷新失败', 'error'); }
  catch (error) { notify(errorText(error), 'error'); } finally { balanceBusy.value = balanceBusy.value.filter(id => id !== channel.id); }
}
const balanceBackendNames: Record<string, string> = { newapi: 'NewAPI', sub2api: 'Sub2API', bbdevlab: 'BBDevLab' };
function balanceLabel(channel: GatewayChannel) {
  const balance = channel.accountBalance;
  if (balance?.amount == null) return balance?.status === 'error' ? '更新失败' : channel.hasAccountCredentials ? '待更新' : '未配置账户';
  if (channel.config.integration === 'bbdevlab') return `${Math.trunc(balance.amount).toLocaleString('zh-CN')}${balance.unit && balance.unit !== '余额' ? ` ${balance.unit}` : ''}`;
  return `${balance.unit === 'USD' ? '$' : ''}${balance.amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}${balance.unit && balance.unit !== 'USD' ? ` ${balance.unit}` : ''}`;
}
function balanceRefreshTitle(channel: GatewayChannel) { return [channel.accountBalance?.error, channel.accountBalance?.updatedAt ? `更新于 ${dateTime(channel.accountBalance.updatedAt)}` : '', 'Worker 定时刷新'].filter(Boolean).join(' · '); }
const confirm = ref<{ title: string; description: string; execute: () => Promise<void> } | null>(null);
async function confirmAction() { const action = confirm.value; if (!action || busy.value) return; await action.execute(); confirm.value = null; }
async function bulk(action: string) { if (!selected.value.length || selected.value.length > 200) { notify('请选择 1–200 个渠道', 'error'); return; } if (archive.value && ['enable', 'disable'].includes(action)) { notify('请先恢复归档渠道', 'warning'); return; } if (await mutate(() => api('/api/channels/bulk', { method: 'POST', body: JSON.stringify({ ids: selected.value, action }) }), `已更新 ${selected.value.length} 个渠道`)) selected.value = []; }
function confirmBulkArchive() { confirm.value = { title: archive.value ? '恢复所选渠道' : '归档所选渠道', description: `将${archive.value ? '恢复' : '归档'} ${selected.value.length} 个渠道。归档渠道不会参与路由，恢复后需要手动启用。`, execute: () => bulk(archive.value ? 'restore' : 'archive') }; }
const menuItems = [{ panel: 'test', title: '渠道测试', icon: 'mdi-play-circle-outline' }, { panel: 'history', title: '测试历史', icon: 'mdi-history' }, { panel: 'clone', title: '复制渠道', icon: 'mdi-content-copy' }, { panel: 'aliases', title: '模型别名', icon: 'mdi-tag-outline' }, { panel: 'prices', title: '模型价格', icon: 'mdi-currency-usd' }, { panel: 'overrides', title: '覆盖设置', icon: 'mdi-code-json' }, { panel: 'relay', title: '代理配置', icon: 'mdi-lan-connect' }, { panel: 'rateLimit', title: '速率限制', icon: 'mdi-speedometer' }, { panel: 'endpoints', title: '端点配置', icon: 'mdi-api' }, { panel: 'credentials', title: '密钥管理', icon: 'mdi-key-outline' }, { panel: 'autoDisable', title: '健康与冷却', icon: 'mdi-shield-check-outline' }, { panel: 'export', title: '导出配置', icon: 'mdi-download-outline' }, { panel: 'archive', title: '归档 / 恢复', icon: 'mdi-archive-outline' }, { panel: 'delete', title: '删除渠道', icon: 'mdi-delete-outline' }];
function exportChannels(list?: GatewayChannel[]) { const output = list ?? (selected.value.length ? channels.value.filter(channel => selected.value.includes(channel.id)) : filtered.value); download(`pulsegate-channels-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ channels: output.map(channel => ({ name: channel.name, provider: channel.provider, endpoint: channel.endpoint, website: channel.website ?? '', model: channel.model, models: channel.models, tags: channel.tags, displayMultiplier: channel.displayMultiplier ?? 1, weight: channel.weight, priority: channel.priority, enabled: channel.enabled, archived: channel.archived, config: channel.config })) }, null, 2), 'application/json'); notify('已导出渠道配置（不含密钥和账户凭据）', 'info'); }
async function act(channel: GatewayChannel, panel: string) {
  if (busy.value) return;
  if (panel === 'clone') { await mutate(() => api(`/api/channels/${encodeURIComponent(channel.id)}/clone`, { method: 'POST' }), '已复制为停用渠道，请添加上游密钥'); return; }
  if (panel === 'export') { exportChannels([channel]); return; }
  if (panel === 'archive') { confirm.value = { title: channel.archived ? '恢复渠道' : '归档渠道', description: `${channel.name}：${channel.archived ? '恢复后仍需手动启用。' : '归档后退出路由，保留全部配置。'}`, execute: async () => { await mutate(() => api(`/api/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: JSON.stringify({ archived: !channel.archived, ...(!channel.archived ? { enabled: false } : {}) }) }), channel.archived ? '渠道已恢复' : '渠道已归档'); } }; return; }
  operation.value = { channel, panel };
}
async function editorSaved() { editor.value = null; await refresh(true); }
function openManagement(mode: string) { if (['weights', 'assign'].includes(mode) && !selected.value.length) { notify('请先选择渠道', 'warning'); return; } management.value = mode; }
</script>

<template>
  <div>
    <div class="channels-layout">
      <aside v-if="mdAndUp" class="channel-tag-sidebar" aria-label="渠道标签筛选">
        <ChannelTagFilter :tags="allTags" :channels="scopedChannels" v-model:selected="filterTags" v-model:untagged="untagged" @manage="openManagement('tags')" />
      </aside>
    <v-card border variant="flat" class="channel-workspace">
      <div class="channel-list-summary" aria-label="渠道列表概况">
        <h2>渠道列表</h2>
        <v-btn variant="text" size="small" class="summary-total" :aria-pressed="!archive && !statuses.length" @click="healthFilter()">{{ count(activeChannels.length) }} 个使用中</v-btn>
        <div class="summary-health">
          <v-btn size="small" :variant="!archive && statuses.length === 1 && statuses[0] === '健康' ? 'tonal' : 'text'" :color="!archive && statuses.length === 1 && statuses[0] === '健康' ? 'primary' : undefined" :aria-pressed="!archive && statuses.length === 1 && statuses[0] === '健康'" @click="healthFilter('健康')"><i class="status-dot bg-success" />健康 {{ count(healthy) }}</v-btn>
          <v-btn size="small" :variant="!archive && statuses.length === 1 && statuses[0] === '冷却中' ? 'tonal' : 'text'" :color="!archive && statuses.length === 1 && statuses[0] === '冷却中' ? 'primary' : cooling > 0 ? 'warning' : undefined" :aria-pressed="!archive && statuses.length === 1 && statuses[0] === '冷却中'" @click="healthFilter('冷却中')"><i class="status-dot bg-warning" />冷却 {{ count(cooling) }}</v-btn>
        </div>
        <span class="summary-models">覆盖 {{ count(modelCount) }} 个模型</span>
        <v-btn color="primary" prepend-icon="mdi-plus" class="summary-create" @click="editChannel('new')">创建渠道</v-btn>
      </div>
      <div class="channel-toolbar">
        <v-tabs v-model="archive" color="primary" density="compact" class="channel-view-tabs"><v-tab :value="false">使用中 <span class="view-count">{{ activeChannels.length }}</span></v-tab><v-tab :value="true">已归档 <span class="view-count">{{ channels.length - activeChannels.length }}</span></v-tab></v-tabs>
        <v-text-field v-model="query" placeholder="搜索渠道、模型或端点" aria-label="搜索渠道" prepend-inner-icon="mdi-magnify" variant="solo-filled" density="compact" hide-details clearable flat class="channel-search" />
        <v-menu v-if="!mdAndUp" v-model="tagOpen" :close-on-content-click="false" :max-width="'calc(100vw - 32px)'">
          <template #activator="{ props: tagProps }"><v-btn v-bind="tagProps" :variant="filterTags.length || untagged ? 'tonal' : 'text'" :color="filterTags.length || untagged ? 'primary' : undefined" prepend-icon="mdi-file-tree-outline">标签树<span v-if="filterTags.length || untagged" class="filter-count">{{ untagged ? '未分组' : filterTags.length }}</span></v-btn></template>
          <div class="mobile-tag-panel"><ChannelTagFilter :tags="allTags" :channels="scopedChannels" v-model:selected="filterTags" v-model:untagged="untagged" @manage="tagOpen = false; openManagement('tags')" /></div>
        </v-menu>
        <v-btn :variant="filtersOpen || filterCount ? 'tonal' : 'text'" :color="filtersOpen || filterCount ? 'primary' : undefined" prepend-icon="mdi-filter-variant" :append-icon="filtersOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">筛选<span v-if="filterCount" class="filter-count">{{ filterCount }}</span></v-btn>
        <v-btn icon="mdi-table-column" variant="text" size="small" aria-label="显示列与分页设置" title="显示列" @click="columnDialog = true" />
        <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" :disabled="busy" aria-label="刷新渠道列表" title="刷新渠道列表" @click="refresh()" />
        <v-menu><template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" variant="text" append-icon="mdi-chevron-down" :disabled="busy">管理</v-btn></template><v-list density="compact"><v-list-item title="批量导入" prepend-icon="mdi-upload-outline" @click="openManagement('import')" /><v-list-item title="导出渠道配置" prepend-icon="mdi-download-outline" @click="exportChannels()" /><v-list-item title="标签管理" prepend-icon="mdi-tag-outline" @click="openManagement('tags')" /><v-list-item title="批量调整权重" prepend-icon="mdi-scale-balance" @click="openManagement('weights')" /><v-list-item title="负载均衡策略" prepend-icon="mdi-tune" @click="openManagement('strategy')" /><v-list-item title="API Key 权限" prepend-icon="mdi-key-outline" @click="navigate('keys')" /></v-list></v-menu>
      </div>
      <v-expand-transition>
        <div v-if="filtersOpen" class="channel-filter-panel">
          <v-select v-model="providers" :items="allProviders" label="服务商" multiple density="compact" hide-details clearable />
          <v-select v-model="statuses" :items="stateItems" label="健康状态" multiple density="compact" hide-details clearable />
          <v-autocomplete v-model="filterModels" :items="allModels" label="模型" multiple density="compact" hide-details clearable />
        </div>
      </v-expand-transition>
      <div v-if="filterCount" class="applied-filters">
        <span class="text-caption text-medium-emphasis">已筛选</span>
        <v-chip v-for="provider in providers" :key="`provider-${provider}`" size="small" variant="tonal" closable @click:close="providers = providers.filter(value => value !== provider)">{{ provider }}</v-chip>
        <v-chip v-for="status in statuses" :key="`status-${status}`" size="small" variant="tonal" closable @click:close="statuses = statuses.filter(value => value !== status)">{{ status }}</v-chip>
        <v-chip v-for="model in filterModels" :key="`model-${model}`" size="small" variant="tonal" closable @click:close="filterModels = filterModels.filter(value => value !== model)">{{ model }}</v-chip>
        <v-chip v-for="tag in filterTags" :key="`tag-${tag}`" size="small" variant="tonal" closable @click:close="filterTags = filterTags.filter(value => value !== tag)">{{ tag }}</v-chip>
        <v-chip v-if="untagged" size="small" closable @click:close="untagged = false">未分组</v-chip>
        <v-spacer /><v-btn variant="text" size="small" @click="clearFilters">清除全部</v-btn>
      </div>
      <v-expand-transition><div v-if="selected.length" class="channel-bulk"><strong class="text-body-2 mr-2">已选择 {{ selected.length }} 个</strong><v-btn size="small" variant="tonal" :disabled="busy || archive" @click="bulk('enable')">启用</v-btn><v-btn size="small" variant="tonal" :disabled="busy || archive" @click="bulk('disable')">停用</v-btn><v-btn size="small" variant="tonal" :disabled="busy" @click="openManagement('assign')">调整标签</v-btn><v-btn size="small" variant="tonal" :disabled="busy" @click="openManagement('weights')">调整权重</v-btn><v-btn size="small" variant="tonal" :disabled="busy" @click="confirmBulkArchive">{{ archive ? '恢复' : '归档' }}</v-btn><v-spacer /><v-btn size="small" variant="text" :disabled="busy" @click="selected = []">取消选择</v-btn></div></v-expand-transition>
      <v-progress-linear v-if="busy" indeterminate color="primary" />
      <v-table class="channel-table" hover>
        <thead><tr><th class="expand-column" /><th class="check-column"><v-checkbox-btn :model-value="pageSelected" :indeterminate="!pageSelected && shown.some(channel => selected.includes(channel.id))" aria-label="选择本页全部渠道" @update:model-value="selectPage" /></th><th><v-btn variant="text" size="small" @click="sort('name')">渠道名称<v-icon v-if="sortKey === 'name'" :icon="ascending ? 'mdi-arrow-up' : 'mdi-arrow-down'" size="small" /></v-btn></th><th v-for="column in displayedColumns" :key="column.key"><v-btn v-if="['provider', 'priority', 'weight', 'createdAt'].includes(column.key)" variant="text" size="small" @click="sort(column.key)">{{ column.title }}<v-icon v-if="sortKey === column.key" :icon="ascending ? 'mdi-arrow-up' : 'mdi-arrow-down'" size="small" /></v-btn><span v-else>{{ column.title }}</span></th><th class="action-column">操作</th></tr></thead>
        <tbody><template v-for="channel in shown" :key="channel.id"><tr :class="{ 'selected-row': selected.includes(channel.id) }"><td><v-btn :icon="expanded.includes(channel.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'" variant="text" size="x-small" :aria-label="`展开 ${channel.name}`" @click="toggleExpanded(channel.id)" /></td><td><v-checkbox-btn :model-value="selected.includes(channel.id)" :aria-label="`选择 ${channel.name}`" @update:model-value="select(channel.id)" /></td><td class="identity-column">
            <div class="channel-name-line"><strong>{{ channel.name }}</strong><span class="channel-multiplier" :aria-label="'倍率 ' + (channel.displayMultiplier ?? 1)" :title="'倍率 ' + (channel.displayMultiplier ?? 1) + ' · 仅用于列表展示'">×{{ channel.displayMultiplier ?? 1 }}</span><v-btn v-if="channelWebsite(channel)" :href="channelWebsite(channel)" target="_blank" rel="noopener noreferrer" icon="mdi-open-in-new" size="x-small" variant="text" class="channel-website-link" :aria-label="'打开 ' + channel.name + ' 官网'" :title="'打开官网 · ' + channelWebsite(channel)" /></div>
            <div v-if="!show('provider') || channel.tags.length" class="channel-metadata">
              <span v-if="!show('provider')" class="channel-provider">{{ channel.provider }}</span>
              <span v-if="!show('provider') && channel.tags.length" class="channel-meta-dot" aria-hidden="true">·</span>
              <v-chip v-for="tag in channel.tags.slice(0, 2)" :key="tag" size="x-small" variant="tonal" class="channel-inline-tag" :title="tag"><span>{{ tag }}</span></v-chip>
              <v-menu v-if="channel.tags.length > 2"><template #activator="{ props: tagProps }"><v-btn v-bind="tagProps" variant="text" size="x-small" class="channel-more-tags" :aria-label="'查看 ' + channel.name + ' 的全部 ' + channel.tags.length + ' 个标签'">+{{ channel.tags.length - 2 }}</v-btn></template><v-card border class="channel-tags-popover"><v-card-text><span class="text-caption text-medium-emphasis">全部标签 · {{ channel.tags.length }}</span><div class="channel-all-tags"><v-chip v-for="tag in channel.tags" :key="tag" size="small" variant="tonal">{{ tag }}</v-chip></div></v-card-text></v-card></v-menu>
            </div>
            <ChannelHealth v-if="!show('health')" :channel="channel" :busy="busy" compact class="mt-2" @reset="resetHealth(channel)" />
            <div v-if="['newapi', 'sub2api', 'bbdevlab'].includes(channel.config.integration ?? '')" class="d-flex align-center ga-1 mt-1"><span class="text-caption text-medium-emphasis">{{ balanceBackendNames[channel.config.integration ?? ''] }} · 余额 {{ balanceLabel(channel) }}</span><v-btn icon="mdi-refresh" size="x-small" variant="text" :loading="balanceBusy.includes(channel.id)" :disabled="!channel.hasAccountCredentials" :aria-label="'刷新 ' + channel.name + ' 余额'" :title="balanceRefreshTitle(channel)" @click="refreshBalance(channel)" /></div>
          </td>
          <td v-if="show('priority')">{{ channel.priority }}</td><td v-if="show('enabled')"><v-switch :model-value="channel.enabled" color="primary" hide-details density="compact" :disabled="busy || channel.archived" :aria-label="`${channel.enabled ? '停用' : '启用'} ${channel.name}`" @update:model-value="toggleEnabled(channel)" /></td><td v-if="show('health')"><ChannelHealth :channel="channel" :busy="busy" @reset="resetHealth(channel)" /></td>
          <td v-if="show('models')"><div class="d-flex flex-column align-start ga-1"><code v-for="model in expandedModels.includes(channel.id) ? channel.models : channel.models.slice(0, 2)" :key="model" class="model-name" :title="model">{{ model }}</code><v-btn v-if="channel.models.length > 2" variant="text" size="x-small" color="primary" @click="expandedModels = expandedModels.includes(channel.id) ? expandedModels.filter(id => id !== channel.id) : [...expandedModels, channel.id]">{{ expandedModels.includes(channel.id) ? '收起' : `+${channel.models.length - 2}` }}</v-btn></div></td>
          <td v-if="show('provider')">{{ channel.provider }}</td><td v-if="show('weight')">{{ channel.weight }}</td><td v-if="show('createdAt')" class="text-caption">{{ dateTime(channel.createdAt).split(' ')[0] }}</td>
          <td class="action-column"><div class="d-flex justify-end"><v-btn icon="mdi-pencil-outline" variant="text" size="small" :disabled="busy" :aria-label="`编辑 ${channel.name}`" @click="editChannel(channel)" /><v-btn icon="mdi-play-outline" variant="text" size="small" :disabled="busy" :aria-label="`测试 ${channel.name}`" @click="openPlayground(channel.id)" /><v-menu><template #activator="{ props: actionProps }"><v-btn v-bind="actionProps" icon="mdi-dots-vertical" variant="text" size="small" :disabled="busy" :aria-label="`${channel.name} 更多操作`" /></template><v-list density="compact"><v-list-item v-for="item in menuItems" :key="item.panel" :title="item.panel === 'archive' ? channel.archived ? '恢复渠道' : '归档渠道' : item.title" :prepend-icon="item.icon" :base-color="item.panel === 'delete' ? 'error' : undefined" @click="act(channel, item.panel)" /></v-list></v-menu></div></td></tr>
          <tr v-if="expanded.includes(channel.id)"><td :colspan="4 + displayedColumns.length" class="detail-cell"><v-row class="py-3"><v-col cols="12" md="3"><span class="text-caption text-medium-emphasis">上游端点</span><code class="d-block text-break">{{ channel.endpoint }}</code><p class="text-caption mt-2">{{ channel.config.protocol }} · {{ channel.config.gatewayMode === 'ai-gateway' ? 'Cloudflare AI Gateway' : channel.config.relayUrl ? 'HTTPS 中继' : '直连' }}</p></v-col><v-col cols="12" md="3"><span class="text-caption text-medium-emphasis">模型别名</span><div v-for="alias in channel.config.aliases" :key="alias.from" class="text-body-2">{{ alias.from }} → {{ alias.to }}</div><div v-if="!channel.config.aliases.length" class="text-body-2">未配置</div><p class="text-caption mt-2">{{ channel.credentialCount }} 个密钥 · 优先级 {{ channel.priority }}</p></v-col><v-col cols="12" md="3"><span class="text-caption text-medium-emphasis">健康判定</span><p class="text-body-2">{{ channelHealthView(channel, now).reason }}</p><p class="text-caption mt-2">样本 {{ channel.health.samples }} · 失败 {{ channel.health.failureCount }} · 恢复 {{ channel.health.recoveryCount }}</p></v-col><v-col cols="12" md="3"><span class="text-caption text-medium-emphasis">请求统计</span><p>{{ count(channel.requests) }} 次 · 成功率 {{ channel.successRate.toFixed(1) }}%</p><p class="text-caption mt-2">平均完成 {{ seconds(channel.health.averageDuration) }}</p></v-col></v-row></td></tr>
        </template><tr v-if="!shown.length"><td :colspan="4 + displayedColumns.length" class="text-center py-8"><v-icon size="24" color="secondary">{{ archive ? 'mdi-archive-outline' : 'mdi-server-outline' }}</v-icon><p class="text-body-2 mt-2">{{ activeFilters ? '没有符合条件的渠道' : archive ? '暂无归档渠道' : '还没有渠道' }}</p><v-btn v-if="activeFilters" variant="text" color="primary" @click="clearFilters">清除筛选</v-btn><v-btn v-else-if="!archive" color="primary" class="mt-4" @click="editChannel('new')">添加第一个渠道</v-btn></td></tr></tbody>
      </v-table>
      <v-divider /><div class="d-flex align-center flex-wrap ga-3 pa-3"><span class="text-caption text-medium-emphasis">共 {{ filtered.length }} 个渠道{{ selected.length ? ` · 已选 ${selected.length}` : '' }}</span><v-spacer /><v-select v-model="pageSize" :items="[10, 20, 50, 100]" label="每页" density="compact" hide-details class="page-size" /><v-pagination v-model="page" :length="pageCount" :total-visible="5" density="compact" show-first-last-page /></div>
    </v-card>
    </div>
    <ChannelEditor v-if="editor" :key="editor === 'new' ? 'new' : editor.id" :channel="editor === 'new' ? undefined : editor" :tags="allTags" :dev-mode="session?.devMode" @close="editor = null" @saved="editorSaved" />
    <ChannelOperations v-if="operation" :key="`${operation.channel.id}-${operation.panel}`" :channel="operation.channel" :panel="operation.panel" @close="operation = null" />
    <ChannelManagement v-if="management" :key="management" :mode="management" :selected="selected" @close="management = null" @applied="selected = []" @tags-changed="syncTagFilters" />
    <AppDialog v-model="columnDialog" title="渠道列表设置" :max-width="500"><v-select v-model="pageSize" :items="[10, 20, 50, 100]" label="每页行数" /><v-checkbox v-for="column in columns" :key="column.key" v-model="visibleColumns" :value="column.key" :label="column.title" hide-details density="compact" /><template #actions><v-btn variant="text" @click="visibleColumns = [...defaults]">恢复默认列</v-btn><v-spacer /><v-btn color="primary" @click="columnDialog = false">完成</v-btn></template></AppDialog>
    <AppDialog :model-value="!!confirm" :title="confirm?.title || '确认操作'" :max-width="500" :busy="busy" @update:model-value="confirm = null"><p>{{ confirm?.description }}</p><template #actions><v-btn :disabled="busy" @click="confirm = null">取消</v-btn><v-btn color="primary" :loading="busy" @click="confirmAction">确认</v-btn></template></AppDialog>
  </div>
</template>

<style scoped>
.channels-layout { display: grid; grid-template-columns: 224px minmax(0, 1fr); align-items: start; gap: 16px; }
.channel-tag-sidebar { position: sticky; top: calc(var(--workspace-sticky-top) + 24px); min-width: 0; }
.channel-workspace { min-width: 0; overflow: hidden; }
.mobile-tag-panel { width: 330px; max-width: calc(100vw - 32px); }
.channel-list-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding: 8px 16px 2px; }
.channel-list-summary h2 { margin-right: 4px; font-size: 14px; font-weight: 600; }
.summary-total { color: rgba(var(--v-theme-on-surface), .68); font-variant-numeric: tabular-nums; }
.summary-health { display: flex; align-items: center; gap: 4px; }
.summary-health .v-btn { font-variant-numeric: tabular-nums; }
.status-dot { display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; }
.summary-models { margin-left: auto; color: rgba(var(--v-theme-on-surface), .5); font-size: 12px; white-space: nowrap; }
.summary-create { margin-left: 8px; }
.channel-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); }
.channel-view-tabs { flex: 0 0 auto; }
.view-count { margin-left: 8px; opacity: .6; font-size: 12px; }
.channel-search { flex: 1 1 280px; min-width: 160px; max-width: 400px; margin-left: auto; }
.filter-count { margin-left: 7px; font-size: 12px; }
.channel-filter-panel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 12px 16px; background: rgba(var(--v-theme-on-surface), .025); border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); }
.applied-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); }
.channel-bulk { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 16px; background: rgba(var(--v-theme-primary), .1); border-bottom: 1px solid rgba(var(--v-theme-primary), .2); }
.channel-table :deep(table) { min-width: 820px; }
.channel-table th { padding: 8px 10px; }
.channel-table td { padding: 12px 10px; }
.channel-table :deep(th) { background: rgba(var(--v-theme-on-surface), .035); white-space: nowrap; }
.identity-column { min-width: 220px; max-width: 310px; }
.channel-name-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
.channel-name-line > strong { min-width: 0; overflow-wrap: anywhere; }
.channel-multiplier { flex: 0 0 auto; padding: 0 5px; border: 1px solid rgba(var(--v-theme-on-surface), .12); border-radius: 4px; color: rgba(var(--v-theme-on-surface), .65); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.channel-website-link { flex: 0 0 auto; align-self: center; margin-block: -4px; color: rgba(var(--v-theme-on-surface), .55); }
.channel-website-link:hover, .channel-website-link:focus-visible { color: rgb(var(--v-theme-primary)); }
.channel-metadata { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; margin-top: 5px; }
.channel-provider, .channel-meta-dot { color: rgba(var(--v-theme-on-surface), .55); font-size: 12px; }
.channel-inline-tag { max-width: 120px; font-size: 11px; }
.channel-inline-tag span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-more-tags { min-width: 26px; padding-inline: 4px; color: rgba(var(--v-theme-on-surface), .65); }
.channel-tags-popover { width: 320px; max-width: calc(100vw - 32px); }
.channel-all-tags { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px; max-height: 260px; overflow-y: auto; margin-top: 10px; }
.channel-all-tags .v-chip { max-width: 100%; height: auto; min-height: 22px; }
.channel-all-tags :deep(.v-chip__content) { white-space: normal; overflow-wrap: anywhere; }
.action-column { position: sticky; right: 0; background: rgb(var(--v-theme-surface)); min-width: 120px; z-index: 1; text-align: right; border-left: 1px solid rgba(var(--v-theme-on-surface), .08); }
.expand-column, .check-column { width: 32px; }
.model-name { display: block; max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.detail-cell { background: rgba(var(--v-theme-on-surface), .03); }
.selected-row { background: rgba(var(--v-theme-primary), .05); }
.page-size { max-width: 90px; min-width: 80px; }
@media (max-width: 1280px) { .channel-toolbar { flex-wrap: wrap; padding-left: 12px; } .channel-view-tabs { flex: 1 1 100%; } .channel-search { margin-left: 0; max-width: none; } }
@media (max-width: 959px) { .channels-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .channel-list-summary { gap: 4px; padding: 8px 12px 2px; } .channel-list-summary h2 { font-size: 14px; } .summary-create { order: 1; margin-left: auto; } .summary-health { order: 2; } .summary-models { order: 3; margin-left: auto; } .channel-search { flex-basis: 100%; max-width: none; } .channel-toolbar { gap: 6px; padding: 6px 12px 8px; } .channel-filter-panel { grid-template-columns: 1fr; padding: 12px; } }
</style>
