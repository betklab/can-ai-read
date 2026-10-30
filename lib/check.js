import { BOTS, BROWSER_UA } from './bots.js';
import { parseRobots, isAllowed } from './robots.js';
import { safeFetch, BlockedTarget } from './net.js';

const BLOCK_CODES = new Set([0, 401, 403, 406, 429, 451, 503]);

export function normaliseInput(input) {
  let s = String(input || '').trim();
  if (!s) throw new BlockedTarget('Enter a website, for example example.com');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new BlockedTarget('That doesn’t look like a web address.'); }
  if (!u.hostname.includes('.') ) throw new BlockedTarget('That doesn’t look like a web address.');
  u.hash = '';
  return u;
}

const isHtml = (r) => /html/i.test(r.headers?.get?.('content-type') || '') || /^\s*</.test(r.body || '');

export function analyseHtml(body = '', headers) {
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const metaRobots = [...body.matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /name\s*=\s*["']?(robots|googlebot|gptbot|oai-searchbot)["'\s>]/i.test(tag))
    .map((tag) => (tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || '').toLowerCase());
  const xRobots = (headers?.get?.('x-robots-tag') || '').toLowerCase();
  const noindex = metaRobots.some((c) => /noindex|\bnone\b/.test(c)) || /noindex|\bnone\b/.test(xRobots);
  const scripts = (body.match(/<script\b/gi) || []).length;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(' ').length : 0;
  const jsRendered = words < 120 && scripts >= 2;
  return { title, noindex, noindexSource: noindex ? (xRobots.includes('noindex') ? 'X-Robots-Tag header' : 'robots meta tag') : null,
           words, scripts, jsRendered, sample: text.slice(0, 280) };
}

export async function runCheck(input, deps = {}) {
  const target = normaliseInput(input);
  const origin = target.origin;
  const opts = (ua) => ({ userAgent: ua, ...deps });

  const fetchingBots = BOTS.filter((b) => b.fetches);
  const [robotsRes, pageRes, llmsRes, ...botRes] = await Promise.all([
    safeFetch(origin + '/robots.txt', opts(BROWSER_UA)),
    safeFetch(target.href, opts(BROWSER_UA)),
    safeFetch(origin + '/llms.txt', opts(BROWSER_UA)),
    ...fetchingBots.map((b) => safeFetch(target.href, opts(b.ua))),
  ]);

  // robots.txt status handling per RFC 9309: 4xx = no restrictions, 5xx/unreachable = assume blocked
  let robots;
  if (robotsRes.status >= 200 && robotsRes.status < 300 && !/^\s*<(!doctype|html)/i.test(robotsRes.body || '')) {
    robots = { state: 'found', parsed: parseRobots(robotsRes.body), url: robotsRes.finalUrl };
  } else if (robotsRes.status >= 400 && robotsRes.status < 500) {
    robots = { state: 'missing', parsed: parseRobots(''), url: origin + '/robots.txt' };
  } else if (robotsRes.status >= 200 && robotsRes.status < 300) {
    robots = { state: 'missing', parsed: parseRobots(''), url: origin + '/robots.txt', note: 'served a web page, not a robots file' };
  } else {
    robots = { state: 'unreachable', parsed: null, url: origin + '/robots.txt', status: robotsRes.status };
  }

  const browserOk = pageRes.status >= 200 && pageRes.status < 300;
  const path = target.pathname + target.search;
  const liveByToken = Object.fromEntries(fetchingBots.map((b, i) => [b.token, botRes[i]]));

  const bots = BOTS.map((b) => {
    let robotsVerdict;
    if (robots.state === 'unreachable') robotsVerdict = { allowed: false, rule: 'robots.txt could not be loaded, so careful crawlers stay away', matchedAgent: null };
    else robotsVerdict = isAllowed(robots.parsed, b.token, path);
    let live = { state: 'not-applicable' };
    if (b.fetches) {
      const r = liveByToken[b.token];
      if (r.status >= 200 && r.status < 300) live = { state: 'ok', status: r.status };
      else if (browserOk && BLOCK_CODES.has(r.status)) live = { state: 'blocked', status: r.status, error: r.error };
      else live = { state: 'error', status: r.status, error: r.error };
    }
    const blocked = !robotsVerdict.allowed || live.state === 'blocked';
    return { company: b.company, token: b.token, kind: b.kind, purpose: b.purpose, note: b.note || null,
             robots: robotsVerdict, live, blocked };
  });

  const page = browserOk && isHtml(pageRes) ? analyseHtml(pageRes.body, pageRes.headers) : null;

  let llms = { present: false, status: llmsRes.status };
  if (llmsRes.status >= 200 && llmsRes.status < 300 && !/html/i.test(llmsRes.headers?.get?.('content-type') || '') && !/^\s*</.test(llmsRes.body || '')) {
    const firstHeading = (llmsRes.body.match(/^#\s+(.+)$/m)?.[1] || '').trim();
    llms = { present: true, status: llmsRes.status, title: firstHeading, bytes: llmsRes.body.length, url: llmsRes.finalUrl };
  }

  const answerBlocked = bots.filter((b) => b.kind === 'answers' && b.blocked).map((b) => b.token);
  const trainingBlocked = bots.filter((b) => b.kind === 'training' && b.blocked).map((b) => b.token);

  let verdict;
  if (!browserOk) verdict = { level: 'bad', text: `We couldn’t load ${target.href} (${pageRes.status || pageRes.error || 'no response'}).` };
  else if (page?.noindex) verdict = { level: 'bad', text: 'The page asks not to be indexed (noindex), so search engines and AI search may leave it out.' };
  else if (answerBlocked.length) verdict = { level: 'warn', text: `${answerBlocked.length} AI answer ${answerBlocked.length === 1 ? 'bot is' : 'bots are'} blocked, so this site can be left out of those answers.` };
  else if (page?.jsRendered) verdict = { level: 'warn', text: 'AI bots are allowed in, but the page seems to need JavaScript, and AI crawlers mostly read plain HTML.' };
  else verdict = { level: 'good', text: 'AI answer engines can reach and read this page.' };

  return {
    checked: target.href,
    finalUrl: pageRes.finalUrl,
    checkedAt: new Date().toISOString(),
    verdict,
    answerBlocked,
    trainingBlocked,
    robots: { state: robots.state, url: robots.url, note: robots.note || null, sitemaps: robots.parsed?.sitemaps || [] },
    page,
    pageStatus: pageRes.status,
    llms,
    bots,
  };
}
