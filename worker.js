// Free tool: paste a Cloudflare/Workers error code (or pick one) + optional context,
// get an AI-personalized diagnosis grounded in Cloudflare's own official docs (RAG-lite:
// the model is only allowed to elaborate on the matched official entry, not invent new causes).
// Built by BURNING AUTONOMY (Richend Digital / NEXT GROWTH).
// Data source: official Cloudflare Support docs (developers.cloudflare.com/support/...), checked 2026-07-12.
// Positioning: CF's own error pages are static and generic. General troubleshooting blogs are also
// static and not specific to your symptoms. This tool asks the model to tailor the *official* causes/
// fixes to what you actually describe (e.g. "only on AWS", "only at night") without inventing new facts.
// Unofficial, independent project — not affiliated with or endorsed by Cloudflare.

const SITE_URL = "https://cf-error-explainer.burningbros.workers.dev";
const REPO_URL = "https://github.com/Richend0913/cf-error-explainer";
const INDEXNOW_KEY = "a93f7c1e2b4d4f8e9a0c6e5d3b2a1f70";
const DATA_CHECKED = "2026-07-12";
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DAILY_AI_CALLS_CAP = 300;
const MAX_OUTPUT_TOKENS = 320;

// Sibling free tools from the same project (BURNING AUTONOMY Track C). Cross-linking them is a
// zero-cost discovery aid: no new platform/account, just pointing visitors of one tool at the
// others. Filtered so each site never lists itself.
const RELATED_TOOLS = [
  { url: "https://workers-ai-cost-calculator.burningbros.workers.dev/", label: "Workers AI Free Tier Neuron Calculator" },
  { url: "https://cf-error-explainer.burningbros.workers.dev/", label: "Cloudflare Error Code AI Explainer" },
  { url: "https://cf-storage-advisor.burningbros.workers.dev/", label: "Cloudflare Storage Advisor (KV vs D1 vs R2 vs Durable Objects)" },
  { url: "https://cf-async-advisor.burningbros.workers.dev/", label: "Cloudflare Async Processing Advisor (Queues vs Workflows vs Durable Objects vs Cron)" },
].filter((t) => t.url !== SITE_URL + "/");
const RELATED_TOOLS_HTML = RELATED_TOOLS.map(
  (t) => `<a href="${t.url}" target="_blank" rel="noopener">${t.label}</a>`
).join(" &middot; ");

// Self-hosted traffic counter (same pattern across all Track C tools). Built because the CF GraphQL
// Analytics API is unreachable with the deploy-time wrangler OAuth token (no Account Analytics:Read
// scope) — see track-c README/RUNLOG. Best-effort only: not deduped by visitor, no bot-detection beyond
// a common-crawler/self-test User-Agent filter, and concurrent KV writes can undercount slightly
// (eventual consistency). /stats is left public on purpose: publishing real measured numbers, even
// small ones, is the point (STRATEGY.md — verifiable measured data is how an anonymous AI-run tool
// earns trust).
const ANALYTICS_SITE = "cf-error-explainer";
const SELF_TEST_UA = /curl|Playwright|HeadlessChrome|python-requests|wrangler/i;
// Link-preview/unfurl bots (fire once whenever this URL is pasted into a chat app) and search/AI
// crawlers (fire once per crawl, e.g. after an IndexNow submission). Neither represents a human
// visitor; excluding them keeps /stats honest per CHARTER's no-fabrication rule. Not exhaustive —
// best-effort based on well-known UA substrings, revisit if new bot traffic shows up unexplained.
const KNOWN_BOT_UA = /discordbot|slackbot|telegrambot|whatsapp|facebookexternalhit|twitterbot|linkedinbot|skypeuripreview|redditbot|pinterest|iframely|googlebot|google-inspectiontool|bingbot|duckduckbot|yandexbot|baiduspider|applebot|petalbot|sogou|bytespider|ahrefsbot|semrushbot|mj12bot|dotbot|gptbot|chatgpt-user|ccbot|claudebot|anthropic-ai|perplexitybot|slurp|ia_archiver/i;

async function recordHit(env, request) {
  if (!env.ANALYTICS) return;
  if (request.headers.get("X-Skip-Analytics") === "1") return;
  const ua = request.headers.get("User-Agent") || "";
  if (SELF_TEST_UA.test(ua) || KNOWN_BOT_UA.test(ua)) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `hits:${ANALYTICS_SITE}:${day}`;
  const cur = await env.ANALYTICS.get(key);
  const n = (cur ? parseInt(cur, 10) || 0 : 0) + 1;
  await env.ANALYTICS.put(key, String(n), { expirationTtl: 60 * 60 * 24 * 400 });
}

async function statsResponse(env) {
  if (!env.ANALYTICS) {
    return new Response(JSON.stringify({ error: "analytics not configured" }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const list = await env.ANALYTICS.list({ prefix: `hits:${ANALYTICS_SITE}:` });
  const by_day = {};
  for (const k of list.keys) {
    const day = k.name.split(":")[2];
    const v = await env.ANALYTICS.get(k.name);
    by_day[day] = parseInt(v, 10) || 0;
  }
  const total = Object.values(by_day).reduce((a, b) => a + b, 0);
  const body = JSON.stringify({
    site: ANALYTICS_SITE,
    method: "self-hosted KV request counter on the '/' route only. Excludes requests sending an X-Skip-Analytics header, a self-test User-Agent (curl/Playwright/etc), or a known link-preview/search-crawler bot (Discordbot, Googlebot, Bingbot, GPTBot, etc). Not deduped by visitor. Not exact — measured trend only.",
    by_day,
    total,
  }, null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// [code, title, meaning, causes[], fixes[], sourceUrl]
const ERROR_DB = [
  ["500", "Internal Server Error", "A generic server-side error was returned (by the origin or Cloudflare itself), with no more specific code available.",
    ["The origin application threw an unhandled error.", "A Cloudflare-side issue occurred with no more specific 5xx code to report."],
    ["Check your origin server's application/error logs for the exact stack trace.", "If logs show nothing on the origin side, contact Cloudflare support with the Ray ID and timestamp."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["501", "Not Implemented", "The origin server does not support the functionality required to fulfill the request (e.g. an unsupported HTTP method).",
    ["The origin web server or application doesn't implement the requested method/feature."],
    ["Check which HTTP method/path the client requested and confirm the origin actually supports it.", "Update the origin app or add a compatible route/handler."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["502", "Bad Gateway", "Cloudflare received an invalid or malformed response from the origin web server.",
    ["Origin server crashed mid-response or returned corrupted data.", "A misconfigured reverse proxy/load balancer in front of the origin."],
    ["Check origin server logs around the timestamp of the error.", "Test the origin directly (bypass Cloudflare, e.g. via /etc/hosts) to confirm it responds correctly on its own."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["503", "Service Temporarily Unavailable", "The origin server is temporarily unable to handle the request — often overloaded or down for maintenance.",
    ["Origin server is overloaded (traffic spike, resource exhaustion).", "Origin is intentionally down for deploy/maintenance."],
    ["Check origin CPU/memory/connection limits during the incident window.", "If it's a traffic spike, consider Cloudflare caching or rate limiting to reduce origin load."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["504", "Gateway Timeout", "Cloudflare didn't receive a timely response from the origin server for this specific request.",
    ["Origin request handler is slow (heavy DB query, external API call, etc).", "Origin is unresponsive or hung."],
    ["Profile the slow endpoint on the origin and speed it up or make it async.", "If it's inherently slow, consider caching the response or restructuring the request flow."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["520", "Web Server Returns An Unknown Error", "The origin server returned an empty, unknown, or otherwise malformed HTTP response that Cloudflare couldn't interpret.",
    ["Origin crashed mid-response.", "Origin returned oversized headers or a response Cloudflare's parser rejected.", "A firewall/WAF on the origin silently dropped the connection."],
    ["Check origin web server error logs (nginx/Apache/app server) around the failure time.", "Test hitting the origin directly, bypassing Cloudflare, to see the raw response."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-520/"],
  ["521", "Web Server Is Down", "The origin server refused the connection from Cloudflare outright — it never even started to respond.",
    ["Origin web server process is stopped or crashed.", "A firewall on the origin is blocking Cloudflare's IP ranges."],
    ["Confirm the web server process (nginx/Apache/etc) is actually running on the origin.", "Verify the origin's firewall allows Cloudflare's published IP ranges on the relevant port."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-521/"],
  ["522", "Connection Timed Out", "Cloudflare couldn't establish a TCP connection to the origin server before its timeout fired.",
    ["Origin server is overloaded and not accepting new connections.", "A network/firewall device between Cloudflare and the origin is silently dropping packets."],
    ["Check origin server load and open connection counts at the time of the error.", "Ask your host to trace the network path from Cloudflare's IPs to confirm packets are actually arriving."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["523", "Origin Is Unreachable", "Cloudflare couldn't route to the origin's IP address at all — this is a DNS/routing problem, not a server-load problem.",
    ["The DNS A/AAAA record points to the wrong or an unreachable IP.", "On AWS, an overly broad VPC route (e.g. 172.0.0.0/8) can accidentally swallow Cloudflare's 172.64.0.0/13 range."],
    ["Double-check the origin IP in your DNS records is correct and reachable.", "If hosted on AWS, review VPC route tables so 172.64.0.0/13 correctly routes to the internet gateway, not internally."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-523/"],
  ["524", "A Timeout Occurred", "Cloudflare successfully connected to the origin, but the origin didn't send a full HTTP response within the timeout (default 120s, or 30s for writes).",
    ["A single request is doing heavy work (large DB query, big export, etc) that legitimately takes longer than the timeout.", "Origin is overloaded and queuing requests."],
    ["Make the slow operation asynchronous (return quickly, poll for status) instead of blocking the request.", "On Enterprise plans, a Cache Rule can raise the timeout up to 6,000s if the long wait is unavoidable."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/"],
  ["525", "SSL Handshake Failed", "The SSL/TLS negotiation between Cloudflare and the origin server failed.",
    ["Origin has no valid SSL certificate installed.", "Port 443 (or the configured secure port) is closed on the origin.", "Origin doesn't support SNI, or its cipher suites are incompatible with Cloudflare's."],
    ["From a shell, run curl -v to the origin's HTTPS port and check the certificate/handshake details.", "Install a valid certificate (Cloudflare's free Origin CA certificate is a common fix) and confirm port 443 is open."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-525/"],
  ["526", "Invalid SSL Certificate", "Cloudflare (in Full Strict SSL mode) rejected the origin's SSL certificate as invalid.",
    ["Origin certificate is expired, self-signed, or doesn't match the hostname.", "SSL mode is set to Full (Strict) but the origin cert isn't from a trusted CA."],
    ["Renew/replace the origin certificate with one from a trusted CA (or Cloudflare's free Origin CA cert).", "If you intentionally use a self-signed cert, switch SSL mode from Full (Strict) to Full instead."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/"],
  ["1000", "DNS Points To Prohibited IP", "A DNS record for this hostname resolves to an IP address that Cloudflare doesn't allow proxying to (e.g. a reserved/private IP).",
    ["The A/AAAA record accidentally points to a private, reserved, or otherwise disallowed IP range."],
    ["Check the DNS record's target IP in the Cloudflare dashboard and correct it to your real public origin IP."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1000/"],
  ["1001", "DNS Resolution Error", "Cloudflare could not resolve the DNS for the requested hostname.",
    ["The DNS record is missing, misconfigured, or was recently changed and hasn't propagated."],
    ["Verify an A/AAAA/CNAME record exists for the exact hostname being requested.", "Wait for DNS propagation if the record was just changed."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1001/"],
  ["1002", "DNS Points To Prohibited IP", "Same underlying cause as error 1000 — the DNS record resolves to a prohibited IP address.",
    ["The A/AAAA record points to a disallowed IP range."],
    ["Correct the DNS record to point at your actual public origin IP address."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1002/"],
  ["1006", "Access Denied — IP Banned", "The site owner's own Cloudflare security settings (e.g. Zone Lockdown / firewall rules) have blocked your specific IP address. This isn't a Cloudflare-wide block.",
    ["The website owner configured a firewall rule, Zone Lockdown, or IP Access Rule that blocks your IP.", "Automated/bot-like traffic from your IP triggered a security rule."],
    ["If you own the site: check Security > WAF > Tools for IP Access Rules or Zone Lockdown entries blocking that IP.", "If you're a visitor: contact the site owner — Cloudflare support cannot override another site's security settings."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1006/"],
  ["1101", "Worker Threw An Exception (Rendering Error)", "A Cloudflare Worker running on this route threw an uncaught JavaScript runtime exception while handling the request.",
    ["Unhandled exception in Worker code: undefined variable/function reference, type error, rejected Promise, or a failed sub-request that wasn't caught."],
    ["Open Workers & Pages > your Worker > Logs (or run `wrangler tail`) to see the exact stack trace.", "Wrap risky code (fetches, JSON.parse, external calls) in try/catch and handle failures explicitly.", "Reproduce locally with `wrangler dev` using the same input that triggered the error."],
    "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1101/"],
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const dbOptions = ERROR_DB.map((e) => `<option value="${esc(e[0])}">${esc(e[0])} — ${esc(e[1])}</option>`).join("");

function findEntry(codeOrText) {
  const raw = String(codeOrText || "").trim();
  const direct = ERROR_DB.find((e) => e[0] === raw);
  if (direct) return direct;
  const m = raw.match(/\b(50[0-4]|5[23][0-9]|100[0-2]|1006|1101)\b/);
  if (m) return ERROR_DB.find((e) => e[0] === m[1]);
  return null;
}

const PAGE_TITLE = "Cloudflare Error Code Explainer (AI-Powered) — Diagnose 5xx & 1xxx Errors";
const PAGE_DESC = "Free tool: pick your Cloudflare/Workers error code (520, 521, 522, 523, 524, 1101, etc), add what's actually happening, and get an AI-personalized diagnosis grounded in Cloudflare's own official docs.";

const SCHEMA_JSON = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "name": "Cloudflare Error Code Explainer",
      "url": SITE_URL,
      "description": PAGE_DESC,
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Any (browser-based)",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "browserRequirements": "Requires JavaScript",
      "isAccessibleForFree": true,
      "sameAs": [REPO_URL],
    },
    {
      "@type": "WebPage",
      "@id": SITE_URL + "/",
      "url": SITE_URL + "/",
      "name": PAGE_TITLE,
      "description": PAGE_DESC,
      "isPartOf": { "@type": "WebSite", "url": SITE_URL, "name": "Cloudflare Error Code Explainer" },
    },
  ],
});

const UI = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${PAGE_TITLE}</title>
<meta name="description" content="${PAGE_DESC}">
<link rel="canonical" href="${SITE_URL}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${PAGE_TITLE}">
<meta property="og:description" content="${PAGE_DESC}">
<meta property="og:url" content="${SITE_URL}/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${PAGE_TITLE}">
<meta name="twitter:description" content="${PAGE_DESC}">
<script type="application/ld+json">${SCHEMA_JSON}</script>
<style>
:root{--ac:#f6821f;--ac2:#f38020}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#0c0f16;color:#e6e8ee;line-height:1.6}
.wrap{max-width:820px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:1.4rem;margin:.2em 0 .1em}
.sub{color:#9aa3b2;font-size:.92rem;margin-bottom:10px}
.badge{display:inline-block;background:rgba(246,130,31,.15);color:#ffb066;border:1px solid rgba(246,130,31,.4);font-size:.72rem;padding:3px 10px;border-radius:999px;margin:2px 4px 2px 0}
.card{background:#121722;border:1px solid #202838;border-radius:14px;padding:20px;margin:18px 0}
label{display:block;font-size:.82rem;color:#9aa3b2;margin:14px 0 4px}
select,input,textarea{width:100%;background:#0c0f16;color:#e6e8ee;border:1px solid #2a3346;border-radius:8px;padding:10px;font:inherit;font-size:.95rem}
textarea{resize:vertical;min-height:70px}
button{margin-top:18px;background:linear-gradient(135deg,var(--ac),var(--ac2));color:#0c0f16;font-weight:800;border:0;border-radius:10px;padding:12px 18px;font-size:.95rem;cursor:pointer;width:100%}
button:disabled{opacity:.6;cursor:wait}
.result{margin-top:18px;padding:16px;border-radius:10px;font-size:.92rem;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.35);white-space:pre-wrap}
.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)}
.hint{font-size:.78rem;color:#6b7385;margin-top:6px}
.foot{margin-top:26px;font-size:.8rem;color:#7b8496;border-top:1px solid #1c2432;padding-top:16px}
.foot a{color:#5eead4}
.src{font-size:.78rem;color:#6b7385;margin-top:10px}
.src a{color:#93c5fd}
</style></head><body>
<div class="wrap">
<h1>Cloudflare Error Code Explainer</h1>
<p class="sub">Pick your error code, describe what's actually happening (optional), and an AI model explains the likely cause and fix — grounded in Cloudflare's own official docs, not guesses.</p>
<span class="badge">Free</span><span class="badge">No login</span><span class="badge">Real AI inference</span><span class="badge">Grounded in official docs</span>

<div class="card">
<label for="code">Error code</label>
<select id="code"><option value="">— Select an error code —</option>${dbOptions}</select>

<label for="paste">Or paste the exact error text (we'll try to detect the code)</label>
<textarea id="paste" placeholder="e.g. Error 522: Connection timed out, Ray ID: 8a1b2c3d..."></textarea>

<label for="ctx">What's actually happening? (optional — helps the AI tailor the fix)</label>
<textarea id="ctx" placeholder="e.g. Only happens on our AWS origin, started after we changed VPC routes last week"></textarea>

<button id="go">Diagnose</button>
<div id="out"></div>
</div>

<div class="foot">
This tool matches your input against a curated set of official Cloudflare error documentation, then asks an AI model
(running on <a href="https://developers.cloudflare.com/workers-ai/" target="_blank" rel="noopener">Cloudflare Workers AI</a>)
to explain the <em>official</em> causes/fixes in plain language, tailored to what you describe. The model is instructed to
only elaborate on the documented causes — not invent new ones. Error data checked ${DATA_CHECKED} from
<a href="https://developers.cloudflare.com/support/troubleshooting/http-status-codes/" target="_blank" rel="noopener">Cloudflare's official Support docs</a>.
This is an independent, unofficial tool — not affiliated with or endorsed by Cloudflare, Inc. No login, no tracking, no data stored.
Source code: <a href="${REPO_URL}" target="_blank" rel="noopener">open on GitHub</a>.
<br>More free Cloudflare tools from the same project: ${RELATED_TOOLS_HTML}
</div>
</div>
<script>
const codeSel = document.getElementById('code');
const pasteEl = document.getElementById('paste');
const ctxEl = document.getElementById('ctx');
const out = document.getElementById('out');
const btn = document.getElementById('go');

function renderResult(data) {
  out.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'result';
  div.textContent = data.explanation;
  out.appendChild(div);
  if (data.matchedCode) {
    const src = document.createElement('div');
    src.className = 'src';
    const a = document.createElement('a');
    a.href = data.sourceUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Official Cloudflare doc for error ' + data.matchedCode;
    src.appendChild(document.createTextNode('Matched: error ' + data.matchedCode + ' — '));
    src.appendChild(a);
    out.appendChild(src);
  }
}

function renderError(msg) {
  out.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'result err';
  div.textContent = msg;
  out.appendChild(div);
}

btn.addEventListener('click', async () => {
  const code = codeSel.value;
  const paste = pasteEl.value.trim();
  const ctx = ctxEl.value.trim();
  if (!code && !paste) {
    renderError('Select an error code or paste the error text first.');
    return;
  }
  btn.disabled = true; btn.textContent = 'Diagnosing…';
  try {
    const res = await fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, paste, ctx }),
    });
    const data = await res.json();
    if (!res.ok) { renderError(data.error || 'Something went wrong.'); return; }
    renderResult(data);
  } catch (e) {
    renderError('Network error — please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Diagnose';
  }
});
</script>
</body></html>`;

const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;

async function checkAndIncrementQuota(env) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${day}`;
  const current = parseInt((await env.QUOTA.get(key)) || "0", 10);
  if (current >= DAILY_AI_CALLS_CAP) return false;
  await env.QUOTA.put(key, String(current + 1), { expirationTtl: 172800 });
  return true;
}

function buildPrompt(entry, userText, userCtx) {
  const [code, title, meaning, causes, fixes] = entry;
  return [
    {
      role: "system",
      content:
        "You are a terse, accurate Cloudflare troubleshooting assistant. You must ONLY use the official cause/fix " +
        "information given to you below — do not invent new causes, products, or settings that aren't listed. " +
        "If the user's extra context doesn't clearly match one of the listed causes, say which listed causes are " +
        "still the most likely and why, rather than guessing something unlisted. Keep the answer under 150 words, " +
        "plain text, no markdown headers, prioritized as a short numbered list of next steps.",
    },
    {
      role: "user",
      content:
        `Error ${code} — ${title}\nOfficial meaning: ${meaning}\n` +
        `Official documented causes: ${causes.join(" | ")}\n` +
        `Official documented fixes: ${fixes.join(" | ")}\n\n` +
        `User's pasted error text (may be empty): ${userText || "(none)"}\n` +
        `User's extra context (may be empty): ${userCtx || "(none)"}\n\n` +
        "Write a short, specific, prioritized diagnosis and next-steps list for this user.",
    },
  ];
}

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      if (execCtx) execCtx.waitUntil(recordHit(env, request));
      return new Response(UI, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/stats") {
      return statsResponse(env);
    }
    if (url.pathname === "/robots.txt") {
      return new Response(ROBOTS_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(SITEMAP_XML, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
    }
    if (url.pathname === `/${INDEXNOW_KEY}.txt`) {
      return new Response(INDEXNOW_KEY, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === "/api/diagnose" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid request body." }, { status: 400 });
      }
      const code = String(body.code || "").slice(0, 20);
      const paste = String(body.paste || "").slice(0, 1500);
      const ctx = String(body.ctx || "").slice(0, 800);

      const entry = findEntry(code) || findEntry(paste);
      if (!entry) {
        return Response.json(
          { error: "Couldn't confidently match a known Cloudflare error code from your input. Please select a code from the list, or include the exact numeric code (e.g. 522, 1101) in the pasted text." },
          { status: 200 }
        );
      }

      const okQuota = await checkAndIncrementQuota(env);
      if (!okQuota) {
        return Response.json(
          { error: "This tool's free daily AI diagnosis quota is used up for today — please try again tomorrow. (The official doc link below still works right now.)",
            matchedCode: entry[0], sourceUrl: entry[5] },
          { status: 200 }
        );
      }

      try {
        const messages = buildPrompt(entry, paste, ctx);
        const aiResp = await env.AI.run(AI_MODEL, { messages, max_tokens: MAX_OUTPUT_TOKENS });
        const explanation = (aiResp && (aiResp.response || aiResp.result)) || "";
        if (!explanation) throw new Error("empty AI response");
        return Response.json({ explanation, matchedCode: entry[0], sourceUrl: entry[5] });
      } catch (e) {
        const fallback =
          `Official cause(s): ${entry[3].join(" ")}\n\nOfficial fix(es): ${entry[4].join(" ")}`;
        return Response.json({ explanation: fallback, matchedCode: entry[0], sourceUrl: entry[5] });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
