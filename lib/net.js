// Fetching arbitrary user-supplied sites from a server is an SSRF risk, so every hop
// is checked: http(s) only, default ports only, public IP addresses only, a small
// number of redirects, a timeout and a size cap.

import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 600_000;
const MAX_REDIRECTS = 5;

function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateV6(ip) {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(x)) return true; // link-local
  if (x.startsWith('ff')) return true; // multicast
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return !isPrivateV4(ip);
  if (net.isIPv6(ip)) return !isPrivateV6(ip);
  return false;
}

export class BlockedTarget extends Error {}

export async function assertPublicUrl(u, resolve = lookup) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedTarget('Only http and https addresses can be checked.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new BlockedTarget('Only standard web ports can be checked.');
  if (u.username || u.password) throw new BlockedTarget('Addresses with logins are not supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new BlockedTarget('That address is not on the public internet.');
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) {
    throw new BlockedTarget('That address is not on the public internet.');
  }
}

// Returns { status, headers, body, finalUrl, error }. Never throws for network errors.
export async function safeFetch(url, { userAgent, timeoutMs = 8000, resolve = lookup, fetchImpl = fetch } = {}) {
  let current = new URL(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current, resolve);
      const res = await fetchImpl(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current);
        try { await res.body?.cancel(); } catch {}
        continue;
      }
      const body = await readCapped(res);
      return { status: res.status, headers: res.headers, body, finalUrl: current.href };
    }
    return { status: 0, error: 'Too many redirects', finalUrl: current.href };
  } catch (e) {
    if (e instanceof BlockedTarget) throw e;
    return { status: 0, error: e.name === 'AbortError' ? 'Timed out' : 'Could not connect', finalUrl: current.href };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try { await reader.cancel(); } catch {}
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES));
}
