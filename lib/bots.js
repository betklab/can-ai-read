// AI-related crawlers and what blocking each one means.
// kind: "answers" = affects whether the site can appear in AI answers / AI search;
//       "training" = only affects use of the content for model training.
// fetches: false = a robots.txt token only; no bot with this name ever visits.
// Sources: OpenAI https://developers.openai.com/docs/gptbot ·
//          Anthropic https://support.claude.com/en/articles/8896518-anthropic-crawlers

const UA = (token, version, url) =>
  `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ${token}/${version}; +${url}`;

export const BOTS = [
  { company: 'OpenAI', token: 'OAI-SearchBot', kind: 'answers', purpose: 'Shows sites in ChatGPT search answers',
    ua: UA('OAI-SearchBot', '1.4', 'https://openai.com/searchbot'), fetches: true },
  { company: 'OpenAI', token: 'ChatGPT-User', kind: 'answers', purpose: 'Opens a page when a ChatGPT user asks about it',
    ua: UA('ChatGPT-User', '1.0', 'https://openai.com/bot'), fetches: true,
    note: 'User-initiated: OpenAI says robots.txt may not apply' },
  { company: 'OpenAI', token: 'GPTBot', kind: 'training', purpose: 'Collects content for training OpenAI models',
    ua: UA('GPTBot', '1.4', 'https://openai.com/gptbot'), fetches: true },
  { company: 'Anthropic', token: 'Claude-SearchBot', kind: 'answers', purpose: 'Indexes pages for Claude’s search answers',
    ua: UA('Claude-SearchBot', '1.0', 'https://www.anthropic.com'), fetches: true },
  { company: 'Anthropic', token: 'Claude-User', kind: 'answers', purpose: 'Opens a page when a Claude user asks about it',
    ua: UA('Claude-User', '1.0', 'https://www.anthropic.com'), fetches: true },
  { company: 'Anthropic', token: 'ClaudeBot', kind: 'training', purpose: 'Collects content for training Anthropic models',
    ua: UA('ClaudeBot', '1.0', 'https://www.anthropic.com'), fetches: true },
  { company: 'Perplexity', token: 'PerplexityBot', kind: 'answers', purpose: 'Indexes pages for Perplexity answers',
    ua: UA('PerplexityBot', '1.0', 'https://perplexity.ai/perplexitybot'), fetches: true },
  { company: 'Perplexity', token: 'Perplexity-User', kind: 'answers', purpose: 'Opens a page when a Perplexity user asks',
    ua: UA('Perplexity-User', '1.0', 'https://perplexity.ai/perplexity-user'), fetches: true },
  { company: 'Google', token: 'Googlebot', kind: 'answers', purpose: 'Google Search, including AI Overviews and AI Mode',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', fetches: true },
  { company: 'Google', token: 'Google-Extended', kind: 'training', purpose: 'Use of content for Gemini models (not Google Search)',
    fetches: false },
  { company: 'Microsoft', token: 'Bingbot', kind: 'answers', purpose: 'Bing search, which Copilot answers draw on',
    ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', fetches: true },
  { company: 'Apple', token: 'Applebot-Extended', kind: 'training', purpose: 'Use of content for Apple’s AI models',
    fetches: false },
  { company: 'Common Crawl', token: 'CCBot', kind: 'training', purpose: 'Open web archive many AI models train on',
    ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)', fetches: true },
];

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
