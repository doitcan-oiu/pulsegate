import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars', `DEV_MODE=true\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\nENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  console.log('本地开发环境已初始化（凭据保存在被忽略的 .dev.vars 文件中）。');
}
