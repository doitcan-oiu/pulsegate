<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GatewaySettings, RoutingStrategy } from '../../../shared/types';
import { channelsForScenario, exampleAdaptiveScore, routingScenarios, routingStrategies, runRoutingExample, type RoutingExampleScenario } from './routing-examples';

const props = defineProps<{ settings: GatewaySettings; previewError?: string }>();
const emit = defineEmits<{ 'update:strategy': [value: RoutingStrategy]; 'update:stickyMode': [value: 'prefer' | 'off'] }>();
const scenario = ref<RoutingExampleScenario>('normal');
const requestCount = ref(3);
const selectedStrategy = computed(() => routingStrategies.find(item => item.value === props.settings.strategy)!);
const selectedScenario = computed(() => routingScenarios.find(item => item.value === scenario.value)!);
const channels = computed(() => channelsForScenario(scenario.value));
const requests = computed(() => props.previewError ? [] : runRoutingExample(props.settings, scenario.value, requestCount.value));
watch(() => JSON.stringify([props.settings.strategy, props.settings.stickyMode, props.settings.autoSwitch, props.settings.retryEnabled, props.settings.maxChannelRetries, props.settings.maxSameChannelRetries, props.settings.retryStatuses, props.settings.retryDelayMs, scenario.value]), () => { requestCount.value = 3; });
const decimal = (value: number) => Number(value.toFixed(3));
</script>

<template>
  <v-card variant="flat" border class="routing-strategy-panel">
    <div class="strategy-heading"><div><span class="section-eyebrow">01 · 分配方式</span><h2>请求先交给谁？</h2><p>选一种分配方式，再用下面的示例看看实际效果。</p></div><v-chip color="primary" variant="tonal" size="small">{{ selectedStrategy.title }}</v-chip></div>
    <div class="strategy-options" role="group" aria-label="路由分配方式">
      <button v-for="item in routingStrategies" :key="item.value" type="button" class="strategy-option" :class="{ 'is-selected': settings.strategy === item.value }" :aria-pressed="settings.strategy === item.value" @click="emit('update:strategy', item.value)">
        <span class="strategy-option-top"><v-icon :icon="item.icon" size="21" /><v-icon v-if="settings.strategy === item.value" icon="mdi-check-circle" size="19" /></span><strong>{{ item.title }}</strong><span>{{ item.description }}</span>
      </button>
    </div>
    <div class="strategy-rule"><v-icon icon="mdi-information-outline" size="18" /><p>{{ selectedStrategy.rule }}<template v-if="settings.strategy === 'failover' || settings.strategy === 'circuit-breaker'"> 失败后能否换渠道，还取决于自动重试和跨渠道重试次数。</template></p></div>
    <div class="session-setting"><div><strong>同一会话，尽量沿用上次成功的渠道</strong><p>携带相同 <code>x-trace-id</code> 或 <code>x-thread-id</code> 时生效。健康渠道会优先于上面的分配顺序；异常渠道不会被强行优先。</p></div><v-switch :model-value="settings.stickyMode === 'prefer'" color="primary" hide-details aria-label="同一会话沿用上次成功的渠道" @update:model-value="emit('update:stickyMode', $event ? 'prefer' : 'off')" /></div>
    <div class="routing-demo">
      <div class="demo-heading"><div><span class="section-eyebrow">02 · 试试看</span><h3>这几次请求会怎么走？</h3></div><span class="demo-local"><v-icon icon="mdi-flask-outline" size="16" />本地示例，不消耗额度</span></div>
      <div class="example-channels"><div v-for="channel in channels" :key="channel.id" class="example-channel" :class="{ 'is-cooling': channel.cooling }"><div><strong>渠道 {{ channel.id }}</strong><span v-if="channel.cooling" class="text-warning">降级 · 冷却中</span><span v-else class="text-success">健康</span></div><p>优先级 <b>{{ channel.priority }}</b><span>权重 <b>{{ channel.weight }}</b></span></p><p>首字 <b>{{ channel.ttft }} s</b><span>成功率 <b>{{ channel.successRate }}%</b></span></p><p v-if="settings.strategy === 'adaptive'" class="adaptive-score">综合分 {{ decimal(exampleAdaptiveScore(channel)) }}，越低越优先</p></div></div>
      <div class="demo-controls"><v-select v-model="scenario" :items="routingScenarios" item-title="title" item-value="value" label="选择想演示的情况" density="comfortable" hide-details /><div class="demo-buttons"><v-btn variant="text" prepend-icon="mdi-replay" @click="requestCount = 1">重播</v-btn><v-btn color="primary" variant="tonal" append-icon="mdi-arrow-right" :disabled="requestCount >= 6" @click="requestCount++">下一次请求</v-btn></div></div>
      <p class="scenario-description">{{ selectedScenario.description }}</p>
      <div class="current-conditions"><span :class="settings.retryEnabled ? '' : 'text-warning'">自动重试{{ settings.retryEnabled ? '开' : '关' }}</span><span>跨渠道最多重试 {{ settings.retryEnabled ? settings.maxChannelRetries : 0 }} 次</span><span>同渠道最多重试 {{ settings.retryEnabled ? settings.maxSameChannelRetries : 0 }} 次</span><span>异常自动切换{{ settings.autoSwitch ? '开' : '关' }}</span><span>会话连续性{{ settings.stickyMode === 'prefer' ? '开' : '关' }}</span></div>
      <v-alert v-if="previewError" type="info" variant="tonal" density="compact">演示已暂停：{{ previewError }}</v-alert>
      <div v-else class="demo-requests" aria-live="polite" aria-atomic="false"><article v-for="request in requests" :key="request.number" class="example-request"><div class="request-title"><strong>请求 {{ request.number }}</strong><span :class="request.success ? 'text-success' : 'text-warning'">{{ request.success ? '成功' : '未完成' }}</span></div><div class="request-path"><span class="request-origin">请求</span><template v-for="(attempt, index) in request.attempts" :key="index"><v-icon icon="mdi-arrow-right" size="17" class="path-arrow" /><span class="attempt-node" :class="`attempt-${attempt.result}`"><b>{{ attempt.channel }}</b><span>{{ attempt.result === 'success' ? '成功' : attempt.result === 'interrupted' ? '输出后断开' : attempt.status }}</span></span></template><span v-if="!request.attempts.length" class="text-warning">没有可用渠道</span></div><p class="request-summary">{{ request.summary }}</p><details class="request-details"><summary>查看分配原因与跳过的渠道</summary><p>本次候选顺序：{{ request.order.join(' → ') || '无' }}<template v-if="settings.strategy === 'weighted'">（固定随机样本，真实请求会重新抽取）</template></p><p v-for="skipped in request.skipped" :key="skipped.channel" class="skipped-channel"><v-icon icon="mdi-skip-next-outline" size="16" />跳过 {{ skipped.channel }}：{{ skipped.reason }}</p><p v-for="(attempt, index) in request.attempts" :key="index">第 {{ index + 1 }} 次尝试 · {{ attempt.channel }}：{{ attempt.reason }}</p></details></article></div>
      <p class="demo-note">使用当前未保存的设置演示流式请求。示例渠道均已授权、支持相同模型，健康状态在演示中保持不变；实际还会受密钥可用性、限流和健康判定影响。重试次数可在「重试与响应」中调整。</p>
    </div>
  </v-card>
</template>

<style scoped>
.routing-strategy-panel { min-width: 0; overflow: hidden; padding: 24px; }
.strategy-heading, .demo-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.section-eyebrow { color: rgb(var(--v-theme-primary)); font-size: 11px; font-weight: 650; letter-spacing: .06em; }
h2, h3 { margin: 5px 0 0; font-size: 19px; font-weight: 650; line-height: 1.5; }
h3 { font-size: 17px; }
.strategy-heading p { margin: 7px 0 0; color: rgba(var(--v-theme-on-surface), .65); font-size: 13px; }
.strategy-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 10px; margin-top: 22px; }
.strategy-option { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 15px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; text-align: left; color: rgb(var(--v-theme-on-surface)); background: rgba(var(--v-theme-on-surface), .015); cursor: pointer; }
.strategy-option:hover { background: rgba(var(--v-theme-primary), .055); border-color: rgba(var(--v-theme-primary), .45); }
.strategy-option:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.strategy-option.is-selected { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), .09); box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), .25); }
.strategy-option-top { display: flex; justify-content: space-between; color: rgb(var(--v-theme-primary)); margin-bottom: 3px; }
.strategy-option strong { font-size: 14px; font-weight: 650; }
.strategy-option > span:last-child { color: rgba(var(--v-theme-on-surface), .65); font-size: 12px; line-height: 1.7; }
.strategy-rule { display: flex; gap: 8px; align-items: start; margin: 15px 0 20px; color: rgba(var(--v-theme-on-surface), .65); }
.strategy-rule .v-icon { flex-shrink: 0; margin-top: 2px; }
.strategy-rule p { margin: 0; font-size: 12px; line-height: 1.8; }
.session-setting { display: flex; align-items: center; gap: 20px; padding: 16px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; }
.session-setting > div { flex: 1; min-width: 0; }
.session-setting strong { font-size: 13px; }
.session-setting p { color: rgba(var(--v-theme-on-surface), .65); margin: 5px 0 0; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.session-setting > .v-input { flex: 0 0 auto; }
.routing-demo { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); margin-top: 24px; padding-top: 22px; }
.demo-local { display: inline-flex; gap: 5px; align-items: center; color: rgba(var(--v-theme-on-surface), .6); font-size: 11px; }
.example-channels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
.example-channel { min-width: 0; background: rgba(var(--v-theme-on-surface), .025); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; padding: 13px 14px; }
.example-channel.is-cooling { border-color: rgba(var(--v-theme-warning), .35); background: rgba(var(--v-theme-warning), .04); }
.example-channel > div { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.example-channel strong { font-size: 13px; }
.example-channel > div > span { font-size: 11px; }
.example-channel p { display: flex; flex-wrap: wrap; gap: 5px 16px; margin: 4px 0 0; font-size: 12px; color: rgba(var(--v-theme-on-surface), .65); }
.example-channel b { color: rgb(var(--v-theme-on-surface)); font-weight: 550; }
.example-channel .adaptive-score { color: rgb(var(--v-theme-primary)); margin-top: 8px; font-size: 11px; }
.demo-controls { display: flex; align-items: center; gap: 12px; }
.demo-controls > .v-input { min-width: 0; flex: 1; }
.demo-buttons { display: flex; gap: 3px; flex-shrink: 0; }
.scenario-description { color: rgba(var(--v-theme-on-surface), .7); font-size: 12px; line-height: 1.8; margin-top: 10px; }
.current-conditions { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 16px; }
.current-conditions span { background: rgba(var(--v-theme-on-surface), .045); border-radius: 4px; padding: 4px 7px; color: rgba(var(--v-theme-on-surface), .65); font-size: 10px; }
.demo-requests { display: grid; gap: 10px; }
.example-request { min-width: 0; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; padding: 13px 15px; }
.request-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.request-title strong { font-size: 12px; font-weight: 600; }
.request-title > span { font-size: 11px; }
.request-path { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
.request-origin { font-size: 11px; color: rgba(var(--v-theme-on-surface), .6); }
.path-arrow { color: rgba(var(--v-theme-on-surface), .35); flex-shrink: 0; }
.attempt-node { display: inline-flex; gap: 7px; align-items: center; border: 1px solid; border-radius: 5px; padding: 4px 8px; font-size: 11px; }
.attempt-node b { font-size: 13px; }
.attempt-success { border-color: rgba(var(--v-theme-success), .35); background: rgba(var(--v-theme-success), .06); color: rgb(var(--v-theme-success)); }
.attempt-error, .attempt-interrupted { border-color: rgba(var(--v-theme-warning), .35); background: rgba(var(--v-theme-warning), .06); color: rgb(var(--v-theme-warning)); }
.request-summary { margin: 9px 0 0; font-size: 12px; line-height: 1.8; color: rgba(var(--v-theme-on-surface), .75); }
.request-details { font-size: 11px; color: rgba(var(--v-theme-on-surface), .6); margin-top: 7px; }
.request-details summary { width: fit-content; cursor: pointer; padding: 4px 0; }
.request-details p { margin: 5px 0 0; line-height: 1.8; }
.skipped-channel { color: rgb(var(--v-theme-warning)); }
.demo-note { font-size: 11px; line-height: 1.9; color: rgba(var(--v-theme-on-surface), .5); margin: 15px 0 0; }
@media (max-width: 700px) { .routing-strategy-panel { padding: 18px; } .strategy-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } .strategy-option { padding: 13px; } .demo-controls { align-items: stretch; flex-direction: column; } .demo-buttons { justify-content: flex-end; } .example-channels { gap: 7px; } .example-channel { padding: 10px; } .example-channel p { gap: 3px 6px; font-size: 11px; } }
@media (max-width: 420px) { .routing-strategy-panel { padding: 15px; } .strategy-heading h2 { font-size: 18px; } .strategy-option { padding: 12px; } .strategy-option strong { font-size: 13px; } .strategy-option > span:last-child { font-size: 11px; } .session-setting { padding: 12px; gap: 8px; } .example-channels { grid-template-columns: minmax(0, 1fr); } .example-channel > div { margin-bottom: 5px; } .example-channel p { display: inline-flex; margin-right: 12px; } .request-path { gap: 5px; } .example-request { padding: 12px; } }
</style>
