import type { GatewayBalance } from '../shared/types';

export function balanceAmount(balance: GatewayBalance | undefined, pending = '待更新'): string {
  if (balance?.amount == null) return balance?.status === 'error' ? '更新失败' : pending;
  const amount = balance.amount.toLocaleString('zh-CN', { maximumFractionDigits: 5 });
  return `${amount}${balance.unit && balance.unit !== '余额' ? ` ${balance.unit}` : ''}`;
}
