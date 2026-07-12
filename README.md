# Cloudflare Error Code Explainer (AI-Powered)

**Live tool:** https://cf-error-explainer.burningbros.workers.dev

A free tool that answers: *"I'm seeing Cloudflare error 522/523/1101/etc — what does it actually mean for my setup?"*

Pick your error code (or paste the raw error text — the code is auto-detected), optionally describe what's actually happening, and an AI model gives a short, prioritized diagnosis tailored to your context.

## Why this exists

Cloudflare's own error pages and most troubleshooting blog posts are static — the same generic explanation for every visitor. This tool is grounded (RAG-style) in a curated set of Cloudflare's own official Support docs, and the model is explicitly instructed to only elaborate on the *documented* causes/fixes for the matched code — not invent new ones. It then tailors that official guidance to what you actually describe (e.g. "only on our AWS origin, started after a VPC change").

No existing free tool combines (a) accurate per-code Cloudflare documentation with (b) an interactive AI diagnosis personalized to your specific symptoms.

## How it works

- A hardcoded table of ~17 common Cloudflare error codes (500-504, 520-526, 1000-1002, 1006, 1101), each with the official meaning/causes/fixes and a link to the source doc.
- User input is matched against this table first (exact code, or a code number found in pasted text). If nothing matches, the tool returns a plain message and **does not call the AI model** — no ungrounded guessing.
- On a match, [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) (`@cf/meta/llama-3.1-8b-instruct-fp8-fast`) is called with a system prompt that restricts it to the documented causes/fixes, personalizing the explanation to the user's optional context.
- A small daily quota (tracked in Workers KV) caps total AI calls per day so the tool stays inside Cloudflare Workers AI's free Neuron allowance even under heavy or abusive traffic.

## Stack

- Single [Cloudflare Worker](https://developers.cloudflare.com/workers/) (`worker.js`), no framework, no build step.
- Bindings: Workers AI (`env.AI`) + one Workers KV namespace for the daily quota counter.
- Deploy with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npx wrangler kv namespace create QUOTA   # then put the returned id in wrangler.toml
npx wrangler deploy
```

## Keeping the error data current

Cloudflare occasionally adds or updates error codes. To refresh:

1. Check https://developers.cloudflare.com/support/troubleshooting/http-status-codes/
2. Update the `ERROR_DB` array in `worker.js` (keep entries sourced only from official docs).
3. Redeploy.

PRs that add more official-doc-sourced error codes or fix bugs are welcome.

## Traffic

The Cloudflare GraphQL Analytics API isn't reachable from this project's deploy token (no `Account Analytics:Read` scope), so the Worker counts its own aggregate page views in KV: see `/stats` for the live numbers. It's a same-origin request counter only — no cookies, no per-visitor identifiers. Requests sending an `X-Skip-Analytics: 1` header or a common bot/test User-Agent (curl, Playwright, etc.) aren't counted.

## License

MIT — see [LICENSE](LICENSE).

---

Built by an AI-run micro-tool project ([BURNING AUTONOMY](https://github.com/Richend0913)). Independent, unofficial — not affiliated with or endorsed by Cloudflare, Inc. No signup, no per-visitor tracking — aggregate page-view counts only, published live at `/stats`.
