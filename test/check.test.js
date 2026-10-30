import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed } from '../lib/robots.js';
import { isPublicAddress, assertPublicUrl } from '../lib/net.js';
import { runCheck, analyseHtml } from '../lib/check.js';

test('robots: named group beats *, longest match wins, allow wins ties', () => {
  const p = parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/ok

User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
User-agent: ChatGPT-User
Allow: /
Disallow: /admin   # comment

Sitemap: https://ex.com/sitemap.xml`);
  assert.equal(isAllowed(p, 'GPTBot', '/').allowed, false);
  assert.equal(isAllowed(p, 'gptbot', '/x').allowed, false, 'tokens are case-insensitive');
  assert.equal(isAllowed(p, 'OAI-SearchBot', '/').allowed, true);
  assert.equal(isAllowed(p, 'ChatGPT-User', '/admin/x').allowed, false);
  assert.equal(isAllowed(p, 'ClaudeBot', '/').allowed, true, 'falls back to *');
  assert.equal(isAllowed(p, 'ClaudeBot', '/private/a').allowed, false);
  assert.equal(isAllowed(p, 'ClaudeBot', '/private/ok/a').allowed, true, 'longer allow wins');
  assert.deepEqual(p.sitemaps, ['https://ex.com/sitemap.xml']);
});

test('robots: wildcards, $ anchors, empty disallow, no robots', () => {
  const p = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow:\n');
  assert.equal(isAllowed(p, 'X', '/a.pdf').allowed, false);
  assert.equal(isAllowed(p, 'X', '/a.pdf?x=1').allowed, true);
  assert.equal(isAllowed(p, 'X', '/').allowed, true);
  assert.equal(isAllowed(parseRobots(''), 'GPTBot', '/').allowed, true);
  const tie = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
  assert.equal(isAllowed(tie, 'X', '/a').allowed, true);
});

test('SSRF guard rejects private and local targets', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  const resolvePrivate = async () => [{ address: '10.0.0.5' }];
  await assert.rejects(assertPublicUrl(new URL('https://evil.example'), resolvePrivate));
  await assert.rejects(assertPublicUrl(new URL('http://localhost/')));
  await assert.rejects(assertPublicUrl(new URL('https://example.com:8443/'), async () => [{ address: '93.184.216.34' }]));
  await assert.rejects(assertPublicUrl(new URL('file:///etc/passwd')));
});

test('HTML analysis spots noindex and JavaScript-only pages', () => {
  const spa = analyseHtml('<html><head><title>App</title><script src=a.js></script><script src=b.js></script></head><body><div id="root"></div></body></html>');
  assert.equal(spa.jsRendered, true);
  const words = Array.from({ length: 300 }, (_, i) => 'word' + i).join(' ');
  const ok = analyseHtml(`<title>Hi</title><meta name="robots" content="index,follow"><p>${words}</p><script></script>`);
  assert.equal(ok.jsRendered, false);
  assert.equal(ok.noindex, false);
  const ni = analyseHtml('<meta name="robots" content="noindex, nofollow"><p>x</p>');
  assert.equal(ni.noindex, true);
});

// A fake web: robots blocks GPTBot, the firewall blocks ClaudeBot, a redirect to a private IP is refused.
function fakeWeb() {
  const words = Array.from({ length: 200 }, () => 'content').join(' ');
  return async (url, init) => {
    const u = new URL(url);
    const ua = init.headers['user-agent'];
    if (u.pathname === '/robots.txt') return new Response('User-agent: GPTBot\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (u.pathname === '/llms.txt') return new Response('# Acme\n> Tools', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (/ClaudeBot/.test(ua)) return new Response('Forbidden', { status: 403 });
    return new Response(`<html><title>Acme</title><p>${words}</p></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  };
}
const publicDns = async () => [{ address: '93.184.216.34' }];

test('runCheck: per-bot robots + live results and a verdict', async () => {
  const r = await runCheck('acme.example', { fetchImpl: fakeWeb(), resolve: publicDns });
  const by = Object.fromEntries(r.bots.map((b) => [b.token, b]));
  assert.equal(by.GPTBot.robots.allowed, false);
  assert.equal(by.GPTBot.blocked, true);
  assert.equal(by.ClaudeBot.robots.allowed, true);
  assert.equal(by.ClaudeBot.live.state, 'blocked');
  assert.equal(by['OAI-SearchBot'].blocked, false);
  assert.equal(by['Google-Extended'].live.state, 'not-applicable');
  assert.deepEqual(r.answerBlocked, []);
  assert.deepEqual(r.trainingBlocked.sort(), ['ClaudeBot', 'GPTBot']);
  assert.equal(r.verdict.level, 'good');
  assert.equal(r.llms.present, true);
  assert.equal(r.llms.title, 'Acme');
  assert.equal(r.page.title, 'Acme');
});

test('runCheck: blocked answer bot gives a warning; unreachable robots.txt counts as blocked', async () => {
  const web = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response('User-agent: OAI-SearchBot\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    return new Response('<title>x</title>' + '<p>a b c</p>'.repeat(100), { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const r = await runCheck('https://shop.example/products', { fetchImpl: web, resolve: publicDns });
  assert.deepEqual(r.answerBlocked, ['OAI-SearchBot']);
  assert.equal(r.verdict.level, 'warn');

  const down = async (url) => new URL(url).pathname === '/robots.txt'
    ? new Response('oops', { status: 503 })
    : new Response('<title>x</title>' + '<p>a b c</p>'.repeat(100), { status: 200, headers: { 'content-type': 'text/html' } });
  const r2 = await runCheck('shop.example', { fetchImpl: down, resolve: publicDns });
  assert.equal(r2.robots.state, 'unreachable');
  assert.ok(r2.answerBlocked.length > 0);
});

test('runCheck: refuses redirects into private networks', async () => {
  const web = async (url) => new Response('', { status: 302, headers: { location: 'http://internal.example/' } });
  const dns = async (host) => (host === 'internal.example' ? [{ address: '10.0.0.7' }] : [{ address: '93.184.216.34' }]);
  await assert.rejects(runCheck('public.example', { fetchImpl: web, resolve: dns }));
});
