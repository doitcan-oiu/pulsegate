<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{ modelValue: string; title: string; hint?: string; min: number; max: number; step?: number; unit?: string; sliderMax?: number }>(), { step: 1, unit: '' });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const id = useId();
const number = computed(() => Number(props.modelValue));
const invalid = computed(() => !props.modelValue.trim() ? '请填写数值' : !Number.isFinite(number.value) ? '请输入有效数字' : number.value < props.min || number.value > props.max ? `范围 ${props.min}–${props.max}${props.unit}` : '');
const sliderLimit = computed(() => Math.min(props.max, Math.max(props.min, props.sliderMax ?? props.max, Number.isFinite(number.value) ? number.value : props.min)));
const sliderValue = computed(() => Number.isFinite(number.value) ? Math.max(props.min, Math.min(sliderLimit.value, number.value)) : props.min);
const fill = computed(() => sliderLimit.value === props.min ? 0 : (sliderValue.value - props.min) / (sliderLimit.value - props.min) * 100);
function updateText(value: unknown) { emit('update:modelValue', value === null ? '' : String(value)); }
function updateRange(event: Event) { emit('update:modelValue', (event.target as HTMLInputElement).value); }
</script>

<template>
  <div class="range-setting" :class="{ 'has-error': invalid }">
    <div class="range-heading"><label :for="`${id}-range`">{{ title }}</label><v-text-field :id="`${id}-precise`" :model-value="modelValue" type="number" :min="min" :max="max" :step="step" :suffix="unit" :aria-label="`${title}，精确数值`" density="compact" variant="outlined" hide-details :error="!!invalid" @update:model-value="updateText" /></div>
    <p v-if="hint" :id="`${id}-hint`" class="range-hint">{{ hint }}</p>
    <input :id="`${id}-range`" class="range-input" type="range" :value="sliderValue" :min="min" :max="sliderLimit" :step="step" :style="{ '--range-fill': `${fill}%` }" :aria-describedby="hint ? `${id}-hint` : undefined" @input="updateRange">
    <div class="range-scale"><span>{{ min }}{{ unit }}</span><span>{{ sliderLimit }}{{ unit }}</span></div>
    <p v-if="invalid" class="range-error" role="alert">{{ invalid }}</p>
    <p v-else-if="sliderMax && sliderLimit < max" class="range-precision">也可输入精确值，最高 {{ max }}{{ unit }}</p>
  </div>
</template>

<style scoped>
.range-setting { min-width: 0; padding: 18px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; background: rgb(var(--v-theme-surface)); }
.range-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.range-heading > label { font-size: 14px; line-height: 1.6; font-weight: 600; }
.range-heading > .v-input { flex: 0 0 108px; min-width: 0; font-variant-numeric: tabular-nums; }
.range-hint { margin: 10px 0 16px; min-height: 38px; font-size: 12px; line-height: 1.65; color: rgba(var(--v-theme-on-surface), .65); }
.range-input { display: block; width: 100%; height: 24px; margin: 5px 0; border: 0; border-radius: 20px; cursor: pointer; accent-color: rgb(var(--v-theme-primary)); background: transparent; }
.range-input::-webkit-slider-runnable-track { height: 5px; border-radius: 8px; background: linear-gradient(to right, rgb(var(--v-theme-primary)) var(--range-fill), rgba(var(--v-theme-on-surface), .13) var(--range-fill)); }
.range-input::-webkit-slider-thumb { margin-top: -5px; }
.range-input:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 4px; }
.range-scale { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: rgba(var(--v-theme-on-surface), .5); font-variant-numeric: tabular-nums; }
.range-precision, .range-error { margin: 9px 0 0; font-size: 11px; line-height: 1.6; color: rgba(var(--v-theme-on-surface), .55); }
.range-error { color: rgb(var(--v-theme-error)); }
.has-error { border-color: rgba(var(--v-theme-error), .65); }
@media (max-width: 450px) { .range-setting { padding: 15px; } .range-heading > .v-input { flex-basis: 112px; } .range-hint { min-height: 0; } }
</style>
