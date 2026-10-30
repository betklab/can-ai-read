// robots.txt parsing and matching per RFC 9309 (the Robots Exclusion Protocol).
// Groups start with one or more User-agent lines; a bot uses the groups naming its
// product token (merged), else the "*" groups; the longest matching rule wins and
// Allow wins a tie.

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current) continue; // rules before any user-agent are ignored
      if (field === 'disallow' && value === '') continue; // empty disallow = no rule
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'sitemap') {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function ruleRegex(pattern) {
  let p = pattern;
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const body = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function normalisePath(path) {
  if (!path) return '/';
  try {
    // percent-decode unreserved chars the way crawlers compare paths
    return decodeURI(path);
  } catch {
    return path;
  }
}

// Which groups apply to a bot: exact product-token match (case-insensitive), else "*".
export function groupsFor(parsed, token) {
  const t = token.toLowerCase();
  const named = parsed.groups.filter((g) => g.agents.includes(t));
  if (named.length) return { matchedAgent: token, groups: named };
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  if (star.length) return { matchedAgent: '*', groups: star };
  return { matchedAgent: null, groups: [] };
}

export function isAllowed(parsed, token, path = '/') {
  const { matchedAgent, groups } = groupsFor(parsed, token);
  const target = normalisePath(path);
  let best = null;
  for (const g of groups) {
    for (const r of g.rules) {
      const pat = normalisePath(r.pattern);
      if (!ruleRegex(pat).test(target)) continue;
      const len = pat.length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) {
        best = { len, allow: r.allow, rule: (r.allow ? 'Allow: ' : 'Disallow: ') + r.pattern };
      }
    }
  }
  return {
    allowed: best ? best.allow : true,
    matchedAgent,
    rule: best ? best.rule : null,
  };
}
