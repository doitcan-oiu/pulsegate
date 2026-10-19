<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { GatewaySettings } from '../../../shared/types';
import { api } from '../../api';
import { useConsole } from '../../composables/useConsole';
import { routingSettingKeys, routingSettingsPatch } from '../../settings-patch';
import { clone } from '../access/policy';
import { disableNumberKeys, healthNumberKeys, numberKeys, numericFields, retryNumberKeys, strategyItems, type NumericKey } from './routing-fields';

type RoutingSection = 'routing' | 'retry' | 'health' | 'disable';
const props = withDefaults(defineProps<{ compact?: boolean; activeSection?: RoutingSection }>(), { compact: false });
const emit = defineEmits<{ dirty: [value: boolean]; busy: [value: boolean]; section: [value: RoutingSection] }>();
const { settings, refresh, notify, registerEditor, loading } = useConsole();
const prefix = useId();
const draft = ref(clone(settings.value));
const baseline = ref(clone(settings.value));
const numeric = ref(Object.fromEntries(numberKeys.map(key => [key, String(draft.value[key])])) as Record<NumericKey, string>);
const statuses = ref(draft.value.retryStatuses.join(', '));
const disableStatuses = ref(draft.value.autoDisableStatuses.join(', '));
const busy = ref(false);
const error = ref('');
const savedAt = ref('');
const localSection = ref<RoutingSection>('routing');
const section = computed(() => props.activeSection ?? localSection.value);
const sections = [{ id: 'routing', title: '路由分配' }, { id: 'retry', title: '重试与响应' }, { id: 'health', title: '健康检查' }, { id: 'disable', title: '自动禁用' }];
const signature = (value: GatewaySettings) => JSON.stringify(Object.fromEntries(routingSettingKeys.map(key => [key, value[key]])));
const dirty = computed(() => signature(draft.value) !== signature(baseline.value) || statuses.value !== baseline.value.retryStatuses.join(', ') || disableStatuses.value !== baseline.value.autoDisableStatuses.join(', ') || numberKeys.some(key => String(numeric.value[key] ?? '') !== String(baseline.value[key])));
const serverChanged = computed(() => dirty.value && signature(settings.value) !== signature(baseline.value));
watch(dirty, value => emit('dirty', value), { immediate: true });
watch(busy, value => emit('busy', value), { immediate: true });
watch([() => signature(settings.value), dirty, busy], () => { if (!dirty.value && !busy.value) reset(); });
const unregisterEditor = registerEditor(`settings-routing-${prefix}`, () => ({ dirty: dirty.value, busy: busy.value }));
const guard = (event: BeforeUnloadEvent) => { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } };
window.addEventListener('beforeunload', guard);
onBeforeUnmount(() => { unregisterEditor(); window.removeEventListener('beforeunload', guard); emit('dirty', false); emit('busy', false); });
function load(value: GatewaySettings) { draft.value = clone(value); baseline.value = clone(value); numeric.value = Object.fromEntries(numberKeys.map(key => [key, String(value[key])])) as Record<NumericKey, string>; statuses.value = value.retryStatuses.join(', '); disableStatuses.value = value.autoDisableStatuses.join(', '); error.value = ''; }
function reset() { if (!busy.value) load(settings.value); }
function selectSection(value: unknown) { const id = value as RoutingSection; if (!sections.some(item => item.id === id)) return; localSection.value = id; emit('section', id); }
const spec = (key: NumericKey) => numericFields[key] as { title: string; hint: string; min: number; max: number; unit?: string; step?: number; integer?: boolean };
function parseStatuses(text: string) { const values = text.split(/[,，\s]+/).filter(Boolean).map(Number); if (values.some(value => !Number.isInteger(value) || value < 400 || value > 599)) throw new Error('错误状态码须为 400–599，使用逗号分隔'); return [...new Set(values)]; }
async function save() {
  if (busy.value || !dirty.value || serverChanged.value) return;
  error.value = '';
  try {
    const value = clone(draft.value);
    for (const key of numberKeys) {
      const field = spec(key), text = String(numeric.value[key] ?? ''), number = Number(text);
      const invalid = (message: string): never => { selectSection(retryNumberKeys.includes(key) ? 'retry' : healthNumberKeys.includes(key) ? 'health' : 'disable'); throw new Error(message); };
      if (!text.trim()) invalid(`请填写${field.title}`);
      if (!Number.isFinite(number) || number < field.min || number > field.max) invalid(`${field.title}须在 ${field.min}–${field.max}${field.unit ?? ''} 之间`);
      if (field.integer && !Number.isInteger(number)) invalid(`${field.title}须为整数`);
      value[key] = number;
    }
    try { value.retryStatuses = parseStatuses(statuses.value); } catch (reason) { selectSection('retry'); throw reason; }
    try { value.autoDisableStatuses = parseStatuses(disableStatuses.value); } catch (reason) { selectSection('disable'); throw reason; }
    if (value.errorMode === 'custom' && !value.customErrorMessage.trim()) { selectSection('retry'); throw new Error('请填写自定义错误消息'); }
    if (value.samples > value.window) { selectSection('health'); throw new Error('最少样本数不能大于最近请求窗口'); }
    const patch = routingSettingsPatch(baseline.value, value);
    busy.value = true;
    const result = await api<{ settings: GatewaySettings }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    load(result.settings); settings.value = result.settings;
    savedAt.value = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
    notify('调度与健康策略已保存', 'success');
    await refresh(true);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '保存失败'; notify(error.value, 'error'); }
  finally { busy.value = false; }
}
defineExpose({ dirty, busy, reset, save });
</script>

<template>
  <v-form class="routing-settings" :class="{ 'is-compact': compact }" :disabled="busy" novalidate @submit.prevent="save">
    <div class="routing-save-bar"><div><strong v-if="!compact" class="text-subtitle-2 mr-4">调度与健康</strong><span class="text-body-2" :class="dirty ? 'text-warning' : 'text-medium-emphasis'" role="status">{{ dirty ? '有未保存的更改' : savedAt ? `已保存 ${savedAt}` : '配置已同步' }}</span></div><div class="d-flex ga-2"><v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" :disabled="busy" @click="refresh()">刷新</v-btn><v-btn variant="text" :disabled="!dirty || busy" @click="reset">{{ serverChanged ? '重新载入' : '放弃更改' }}</v-btn><v-btn color="primary" variant="flat" type="submit" :disabled="!dirty || serverChanged || busy" :loading="busy">保存更改</v-btn></div></div>
    <v-alert v-if="serverChanged" type="warning" variant="tonal" class="mb-5" role="alert">服务器策略已更新，草稿已保留。请重新载入后继续编辑。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mb-5" role="alert">{{ error }}</v-alert>
    <div class="routing-layout">
      <v-tabs v-if="!activeSection" :model-value="section" color="primary" show-arrows class="mb-5" aria-label="调度配置分区" @update:model-value="selectSection"><v-tab v-for="item in sections" :key="item.id" :value="item.id" :aria-controls="`${prefix}-${item.id}`">{{ item.title }}</v-tab></v-tabs>
      <fieldset class="routing-fields" :disabled="busy">
        <v-card v-show="section === 'routing'" :id="`${prefix}-routing`" variant="flat" border class="routing-section"><v-card-title class="text-subtitle-1 px-6 pt-5">路由分配</v-card-title><v-card-subtitle>决定请求如何分配到授权渠道。</v-card-subtitle><v-card-text><v-row><v-col cols="12" sm="6"><v-select v-model="draft.strategy" label="调度方式" :items="strategyItems" hint="在授权且健康的渠道间调度；自适应策略优先低延迟上游。" persistent-hint /></v-col><v-col cols="12" sm="6"><v-select v-model="draft.stickyMode" label="会话粘性" :items="[{title:'优先最近的健康渠道',value:'prefer'},{title:'关闭',value:'off'}]" hint="通过 trace / thread 关联会话。" persistent-hint /></v-col></v-row></v-card-text></v-card>
        <v-card v-show="section === 'retry'" :id="`${prefix}-retry`" variant="flat" border class="routing-section"><v-card-title class="text-subtitle-1 px-6 pt-5">重试与响应</v-card-title><v-card-subtitle>失败后的重试、超时与错误信息。</v-card-subtitle><v-card-text>
          <div class="setting-switch"><div><strong>自动重试</strong><p>仅在开始输出前重试，已输出内容不会跨渠道拼接。</p></div><v-switch v-model="draft.retryEnabled" color="primary" hide-details aria-label="自动重试" /></div>
          <v-row class="mt-2"><v-col v-for="key in retryNumberKeys" :key="key" cols="12" sm="6"><v-text-field v-model="numeric[key]" type="number" :label="spec(key).title" :min="spec(key).min" :max="spec(key).max" :step="spec(key).step ?? 1" :suffix="spec(key).unit" :hint="spec(key).hint" persistent-hint /></v-col><v-col cols="12" sm="6"><v-text-field v-model="statuses" label="重试状态码" hint="逗号分隔；留空关闭状态码重试。" placeholder="408, 429, 500, 502, 503, 504" persistent-hint /></v-col></v-row>
          <v-alert v-if="Number(numeric.streamFirstTokenTimeout) > 0 && Number(numeric.streamFirstTokenTimeout) <= Number(numeric.threshold)" type="warning" variant="tonal" density="compact" class="my-4">首字超时不高于健康阈值，请求会先超时。需要统计连续慢响应时，请调高首字超时或设为 0。</v-alert>
          <div class="setting-switch"><div><strong>检测空响应</strong><p>文本、推理内容或工具调用视为有效输出。</p></div><v-switch v-model="draft.emptyResponseDetection" color="primary" hide-details aria-label="检测空响应" /></div>
          <v-row class="mt-2"><v-col cols="12" sm="6"><v-select v-model="draft.errorMode" label="错误消息" :items="[{title:'自定义消息',value:'custom'},{title:'通用消息',value:'generic'},{title:'上游原始错误',value:'raw'}]" hint="日志保留脱敏后的错误详情。" persistent-hint /></v-col><v-col v-if="draft.errorMode === 'custom'" cols="12" sm="6"><v-textarea v-model="draft.customErrorMessage" label="自定义错误消息" rows="2" auto-grow maxlength="1000" /></v-col></v-row>
        </v-card-text></v-card>
        <v-card v-show="section === 'health'" :id="`${prefix}-health`" variant="flat" border class="routing-section"><v-card-title class="text-subtitle-1 px-6 pt-5">健康检查</v-card-title><v-card-subtitle>根据响应延迟判断降级、冷却与恢复。</v-card-subtitle><v-card-text><v-row><v-col v-for="key in healthNumberKeys" :key="key" cols="12" sm="6"><v-text-field v-model="numeric[key]" type="number" :label="spec(key).title" :min="spec(key).min" :max="spec(key).max" :step="spec(key).step ?? 1" :suffix="spec(key).unit" :hint="spec(key).hint" persistent-hint /></v-col></v-row><div class="setting-switch"><div><strong>自动切换</strong><p>异常渠道暂不接收新的路由请求。</p></div><v-switch v-model="draft.autoSwitch" color="primary" hide-details aria-label="自动切换" /></div><div class="setting-switch"><div><strong>自动恢复</strong><p>冷却后探测，连续健康达到配置次数后恢复。</p></div><v-switch v-model="draft.autoRecover" color="primary" hide-details aria-label="自动恢复" /></div><v-expansion-panels variant="accordion" class="mt-4"><v-expansion-panel title="健康判定规则"><v-expansion-panel-text>流式首字需连续满窗口且每次均超过阈值；一次快请求会打断连续慢请求。非流式达到最少样本后，按平均完成耗时判定。两种方式分别采样。</v-expansion-panel-text></v-expansion-panel></v-expansion-panels></v-card-text></v-card>
        <v-card v-show="section === 'disable'" :id="`${prefix}-disable`" variant="flat" border class="routing-section"><v-card-title class="text-subtitle-1 px-6 pt-5">自动禁用</v-card-title><v-card-subtitle>连续错误达到阈值时暂停上游。</v-card-subtitle><v-card-text><div class="setting-switch"><div><strong>启用自动禁用</strong><p>仅作用于上游渠道或凭证。</p></div><v-switch v-model="draft.autoDisableEnabled" color="primary" hide-details aria-label="启用自动禁用" /></div><v-row class="mt-2"><v-col cols="12" sm="6"><v-select v-model="draft.autoDisableTarget" label="禁用对象" :items="[{title:'上游密钥',value:'key'},{title:'整个渠道',value:'channel'}]" hide-details /></v-col><v-col cols="12" sm="6"><v-text-field v-model="disableStatuses" label="触发状态码" hint="400–599，使用逗号分隔。" persistent-hint /></v-col><v-col v-for="key in disableNumberKeys" :key="key" cols="12" sm="6"><v-text-field v-model="numeric[key]" type="number" :label="spec(key).title" :min="spec(key).min" :max="spec(key).max" :step="spec(key).step ?? 1" :suffix="spec(key).unit" :hint="spec(key).hint" persistent-hint /></v-col></v-row><div class="setting-switch"><div><strong>自动恢复已禁用项</strong><p>关闭后需手动启用，渠道可单独覆盖。</p></div><v-switch v-model="draft.autoDisableRecover" color="primary" hide-details aria-label="自动恢复已禁用项" /></div></v-card-text></v-card>
      </fieldset>
    </div>
  </v-form>
</template>

<style scoped>
.routing-save-bar { position: sticky; top: calc(var(--workspace-sticky-top, 110px) + 12px); z-index: 4; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; margin-bottom: 16px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 4px; }
.routing-layout { min-width: 0; }
.routing-fields { display: grid; gap: 16px; border: 0; padding: 0; margin: 0; min-width: 0; }
.routing-fields :deep(.v-row) { margin: 0; --v-col-gap-y: 16px; row-gap: 16px; }
.routing-fields :deep(.v-row + .setting-switch) { margin-top: 16px; }
.routing-section :deep(.v-card-title) { padding: 18px 20px 6px !important; font-size: 16px !important; font-weight: 600; }
.routing-section :deep(.v-card-subtitle) { padding-inline: 20px; white-space: normal; line-height: 1.7; }
.routing-section :deep(.v-card-text) { padding: 20px; }
.setting-switch { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; margin-bottom: 8px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 4px; background: rgba(var(--v-theme-on-surface), .025); }
.setting-switch strong { font-size: 13px; font-weight: 500; }
.setting-switch p { margin: 5px 0 0; font-size: 12px; color: rgba(var(--v-theme-on-surface), .65); }
.setting-switch > .v-input { flex: 0 0 auto; }
.is-compact .routing-layout { display: block; }
.is-compact .routing-save-bar { position: static; padding: 0 0 16px; border: 0; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 0; }
@media (max-width: 550px) { .routing-save-bar { flex-wrap: wrap; padding: 14px; } .routing-save-bar > .d-flex { margin-left: auto; } .routing-section :deep(.v-card-title), .routing-section :deep(.v-card-text) { padding: 20px !important; } .routing-section :deep(.v-card-subtitle) { padding-inline: 20px; } .setting-switch { padding: 14px; gap: 14px; } }
</style>
