# Can AI read your site?

Type in a website and see whether ChatGPT, Claude, Perplexity, Google and Bing can reach and read it.

- **robots.txt, per bot.** It applies the site's rules to each AI bot, using the official rules for robots.txt (RFC 9309). Bots that power AI answers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot…) are kept apart from training-only bots (GPTBot, ClaudeBot, Google-Extended…). Blocking training doesn't hide a site from AI answers.
- **Live visit, per bot.** It loads the page as a normal browser, then under each bot's name. If the browser gets in and a bot doesn't, a firewall is probably blocking that bot.
- **What the bots see.** It checks for readable text without JavaScript, `noindex` tags or headers, sitemaps, and whether an `llms.txt` exists. llms.txt is shown for information only: it's a proposed standard that no major AI engine has confirmed using.

The fetcher only visits public internet addresses. It refuses private networks, follows at most 5 redirects, times out after 8 seconds, and reads at most 600 KB.

## Deploy on Vercel (free)

1. Put these files in a new GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo, keep **Framework: Other**, and click **Deploy**.
3. Open `<project>.vercel.app`. Links like `?url=example.com` run the check straight away, so they're shareable.

## Run locally

```bash
node dev-server.js        # http://localhost:3000
node --test test/*.test.js
```

Needs Node 20+. No packages to install.
