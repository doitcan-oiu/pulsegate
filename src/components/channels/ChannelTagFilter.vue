<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GatewayChannel } from '../../../shared/types';
const props = defineProps<{ tags: string[]; channels: GatewayChannel[]; selected: string[]; untagged: boolean }>();
const emit = defineEmits<{ 'update:selected': [value: string[]]; 'update:untagged': [value: boolean]; manage: [] }>();
const query = ref('');
const collapsed = ref<string[]>([]);
const nodes = computed(() => {
  const paths = new Set<string>();
  for (const tag of props.tags) { const parts = tag.split('/'); for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/')); }
  return [...paths].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })).filter(path => !query.value || path.toLowerCase().includes((query.value ?? '').toLowerCase())).map(path => ({ path, label: path.split('/').at(-1), depth: path.split('/').length - 1, children: [...paths].some(other => other.startsWith(path + '/')), count: props.channels.filter(channel => channel.tags.some(tag => tag === path || tag.startsWith(path + '/'))).length })).filter(node => query.value || !collapsed.value.some(path => node.path.startsWith(path + '/')));
});
function clear(untagged = false) { emit('update:selected', []); emit('update:untagged', untagged); }
function toggle(path: string) { emit('update:untagged', false); emit('update:selected', props.selected.includes(path) ? props.selected.filter(tag => tag !== path) : [...props.selected, path]); }
function collapse(path: string) { collapsed.value = collapsed.value.includes(path) ? collapsed.value.filter(value => value !== path) : [...collapsed.value, path]; }
</script>
<template>
  <v-card width="330" max-width="90vw" border>
    <v-card-title class="text-subtitle-1 d-flex align-center">标签筛选<v-spacer /><v-btn icon="mdi-cog-outline" size="small" variant="text" aria-label="管理标签" @click="emit('manage')" /></v-card-title>
    <v-divider /><v-card-text>
      <v-text-field v-model="query" placeholder="搜索标签" aria-label="搜索标签" prepend-inner-icon="mdi-magnify" variant="solo-filled" flat density="compact" hide-details clearable />
      <v-list density="compact" class="mt-2 tag-list">
        <v-list-item title="全部渠道" :active="!selected.length && !untagged" @click="clear()"><template #append><span class="text-caption">{{ channels.length }}</span></template></v-list-item>
        <v-list-item title="未分组" :active="untagged" @click="clear(true)"><template #append><span class="text-caption">{{ channels.filter(channel => !channel.tags.length).length }}</span></template></v-list-item>
        <v-divider class="my-2" />
        <v-list-item v-for="node in nodes" :key="node.path" :active="selected.includes(node.path) && !untagged" :style="{ paddingLeft: `${8 + node.depth * 14}px` }" @click="toggle(node.path)">
          <template #prepend><v-btn v-if="node.children" :icon="collapsed.includes(node.path) ? 'mdi-chevron-right' : 'mdi-chevron-down'" variant="text" size="x-small" @click.stop="collapse(node.path)" /><v-icon v-else size="small" class="mr-2">mdi-tag-outline</v-icon></template>
          <v-list-item-title>{{ node.label }}</v-list-item-title><template #append><span class="text-caption">{{ node.count }}</span></template>
        </v-list-item>
        <v-list-item v-if="!nodes.length" title="暂无匹配标签" />
      </v-list>
      <p class="text-caption text-medium-emphasis mt-2">可多选，匹配任一标签及其下级。</p>
    </v-card-text>
  </v-card>
</template>
<style scoped>.tag-list { max-height: 320px; overflow: auto; }</style>
