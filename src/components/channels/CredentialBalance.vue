<script setup lang="ts">
import type { GatewayBalance } from '../../../shared/types';
import { balanceAmount } from '../../channel-balance';
import { dateTime } from '../../format';
defineProps<{ balance?: GatewayBalance }>();
</script>
<template>
  <div class="credential-balance">
    <span class="text-body-2">余额 {{ balanceAmount(balance) }}</span>
    <span v-if="balance?.updatedAt" class="text-caption text-medium-emphasis">更新于 {{ dateTime(balance.updatedAt) }}</span>
    <span v-if="balance?.status === 'error'" class="text-caption text-warning text-break">{{ balance.error || '余额查询失败' }}<template v-if="balance.checkedAt"> · 检查于 {{ dateTime(balance.checkedAt) }}</template></span>
  </div>
</template>
<style scoped>
.credential-balance { display: flex; flex-direction: column; gap: 3px; min-width: 120px; font-variant-numeric: tabular-nums; }
</style>
