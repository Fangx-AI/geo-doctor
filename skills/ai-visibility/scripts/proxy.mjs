// proxy.mjs · geo-doctor
// Node's built-in fetch ignores HTTPS_PROXY / HTTP_PROXY. Users behind a proxy
// (China, corporate networks, VPNs) would see every page fail with ECONNREFUSED
// and blame their site instead of the network. Re-launch once with
// --use-env-proxy so fetch honours the usual environment variables.
//
// Node's fetch 默认不读 HTTPS_PROXY / HTTP_PROXY。有代理的用户（国内网络、
// 企业内网、VPN）会看到所有页面 ECONNREFUSED，误以为是网站的问题。
// 这里用 --use-env-proxy 重新启动一次，让 fetch 遵循标准代理环境变量。
//
// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/** Which proxy variable is set, if any. */
export function proxyVar(env = process.env) {
  return PROXY_VARS.find((k) => env[k]) || null;
}

/**
 * Re-exec this process with --use-env-proxy when a proxy is configured.
 * Returns only when no re-launch was needed; otherwise exits with the child's code.
 */
export function useEnvProxy(argv = process.argv, env = process.env) {
  if (!proxyVar(env)) return false;
  if (env.GEO_DOCTOR_PROXY_REEXEC === '1') return false;
  if (String(env.NODE_USE_ENV_PROXY || '') === '1') return false;
  if (process.execArgv.includes('--use-env-proxy')) return false;
  // Older Node has no such flag; fall back to a clear error instead of a crash.
  if (!process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) return false;

  const r = spawnSync(
    process.execPath,
    ['--use-env-proxy', ...process.execArgv, ...argv.slice(1)],
    { stdio: 'inherit', env: { ...env, GEO_DOCTOR_PROXY_REEXEC: '1' } },
  );
  if (r.error) return false;
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

/** Extra hint appended to network errors when a proxy is configured. */
export function proxyHint(env = process.env) {
  const k = proxyVar(env);
  return k ? ` [proxy ${k}=${env[k]}]` : '';
}
