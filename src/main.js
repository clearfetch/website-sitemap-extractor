import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { COMMON_PATHS, decompressIfNeeded, looksLikeHtmlPage, parseSitemap, sitemapsFromHtml, sitemapsFromRobots } from './sitemap.js';

const EVENT_WEBSITE = 'website-processed';
const EVENT_URL = 'url';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const inputs = normalizeUrls(input);
if (!inputs.length) {
    await Actor.fail('No websites provided. Pass "urls" (domains, or direct links to a sitemap), or "url" (single string), or "startUrls".');
}
const maxUrlsPerSite = clamp(Number(input.maxUrlsPerSite ?? 0), 0, 500000);
const maxSitemaps = clamp(Number(input.maxSitemaps ?? 50), 1, 1000);
const includeUrlList = input.includeUrlList !== false;
const urlPattern = compileFilter(input.urlPattern);
const changedSince = input.changedSince ? Date.parse(input.changedSince) : null;
const maxConcurrency = clamp(Number(input.maxConcurrency ?? 5), 1, 20);
const timeoutMs = clamp(Number(input.timeoutSecs ?? 30), 5, 120) * 1000;
const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);

if (changedSince !== null && Number.isNaN(changedSince)) {
    await Actor.fail(`"changedSince" is not a date I can read: ${input.changedSince}. Use a format like 2026-01-31.`);
}

log.info(`Extracting sitemaps for ${inputs.length} website(s), up to ${maxSitemaps} sitemap file(s) each`);

let done = 0;
let charged = 0;
let failed = 0;
let stop = false;

await runPool(inputs, maxConcurrency, async (entry) => {
    if (stop) return;
    const item = await processSite(entry);
    done += 1;
    if (item.ok) {
        const result = await Actor.pushData(item, EVENT_WEBSITE);
        charged += 1;
        if (result?.eventChargeLimitReached) {
            stop = true;
            log.warning('The maximum cost set for this run has been reached, stopping.');
        }
        // The work scales with how many URLs a site publishes, so those are charged too.
        const count = item.urlCount ?? 0;
        if (count > 0 && !stop) {
            const charge = await Actor.charge({ eventName: EVENT_URL, count });
            // The row is written before this, so a truncated charge means the user received more than they paid
            // for rather than the other way round. Worth logging, never worth withholding data already produced.
            if (charge?.chargedCount !== undefined && charge.chargedCount < count) {
                log.warning(`Charged for ${charge.chargedCount} of ${count} URLs on ${item.url}; the run's cost limit was reached.`);
            }
            if (charge?.eventChargeLimitReached) {
                stop = true;
                log.warning('The maximum cost for this run was reached while charging for URLs, stopping.');
            }
        }
    } else {
        failed += 1;
        await Actor.pushData(item);
    }
    await Actor.setStatusMessage(`${done}/${inputs.length} websites, ${charged} with sitemaps, ${failed} failed`);
});

log.info(`Finished: ${charged} website(s) processed, ${failed} failed, ${inputs.length - done} skipped`);
await Actor.exit();

// ---------------------------------------------------------------------------------------------------------

async function processSite(entry) {
    const started = Date.now();
    const { url, isDirectSitemap } = entry;
    const notes = [];
    try {
        const origin = new URL(url).origin;
        let candidates = [];
        let discovery = 'input';

        if (isDirectSitemap) {
            candidates = [url];
        } else {
            // robots.txt is where a site is supposed to declare its sitemaps, so it is tried first.
            const robots = await fetchQuiet(`${origin}/robots.txt`);
            if (robots?.body) {
                const found = sitemapsFromRobots(robots.body.toString('utf8'), origin);
                if (found.length) {
                    candidates = found;
                    discovery = 'robots.txt';
                }
            }
            if (!candidates.length) {
                const home = await fetchQuiet(url);
                if (home?.body && looksLikeHtmlPage(home.body)) {
                    const found = sitemapsFromHtml(home.body.toString('utf8'), url);
                    if (found.length) {
                        candidates = found;
                        discovery = 'homepage link';
                    }
                }
            }
            if (!candidates.length) {
                for (const path of COMMON_PATHS) {
                    const probe = await fetchQuiet(`${origin}${path}`);
                    if (probe?.statusCode === 200 && probe.body?.length && !looksLikeHtmlPage(decompressIfNeeded(probe.body))) {
                        candidates = [`${origin}${path}`];
                        discovery = 'common path';
                        break;
                    }
                }
            }
        }

        if (!candidates.length) {
            return {
                url,
                ok: false,
                error: 'no sitemap found in robots.txt, on the homepage, or at any of the usual paths',
                elapsedMs: Date.now() - started,
                scrapedAt: new Date().toISOString(),
            };
        }

        // Walk the sitemap tree breadth-first, since an index can point at further indexes.
        const queue = candidates.map((loc) => ({ loc, depth: 0 }));
        const seen = new Set();
        const files = [];
        const urls = [];
        let truncated = false;

        while (queue.length && files.length < maxSitemaps) {
            const { loc, depth } = queue.shift();
            if (seen.has(loc)) continue;
            seen.add(loc);
            const res = await fetchQuiet(loc);
            if (!res || res.statusCode >= 400 || !res.body?.length) {
                files.push({ url: loc, ok: false, status: res?.statusCode ?? null, depth });
                continue;
            }
            let body;
            try {
                body = decompressIfNeeded(res.body);
            } catch (err) {
                files.push({ url: loc, ok: false, error: `could not decompress: ${err.message}`, depth });
                continue;
            }
            if (looksLikeHtmlPage(body)) {
                files.push({ url: loc, ok: false, error: 'served an HTML page rather than a sitemap', depth });
                continue;
            }
            const parsed = parseSitemap(body, loc);
            files.push({ url: loc, ok: true, type: parsed.type, urls: parsed.urls.length, children: parsed.sitemaps.length, depth });
            for (const child of parsed.sitemaps) {
                if (!seen.has(child.loc) && files.length + queue.length < maxSitemaps) queue.push({ loc: child.loc, depth: depth + 1 });
            }
            for (const u of parsed.urls) {
                if (maxUrlsPerSite && urls.length >= maxUrlsPerSite) {
                    truncated = true;
                    break;
                }
                if (urlPattern && !urlPattern.test(u.loc)) continue;
                if (changedSince !== null) {
                    const t = u.lastmod ? Date.parse(u.lastmod) : NaN;
                    if (Number.isNaN(t) || t < changedSince) continue;
                }
                urls.push(u);
            }
            if (truncated) break;
        }

        if (truncated) notes.push(`Stopped at the "maxUrlsPerSite" limit of ${maxUrlsPerSite}; the site has more.`);
        if (queue.length) notes.push(`Stopped at the "maxSitemaps" limit of ${maxSitemaps}; ${queue.length} more sitemap file(s) were not read.`);
        if (urlPattern) notes.push('URLs were filtered by "urlPattern", so this is a subset of the sitemap.');
        if (changedSince !== null) notes.push('Only URLs with a lastmod on or after "changedSince" are included.');

        const withLastmod = urls.filter((u) => u.lastmod).length;
        return {
            url,
            ok: true,
            discovery,
            sitemapCount: files.length,
            sitemaps: files,
            urlCount: urls.length,
            urls: includeUrlList ? urls : undefined,
            stats: {
                withLastmod,
                withAlternates: urls.filter((u) => u.alternates.length).length,
                withImages: urls.filter((u) => u.images.length).length,
                newestLastmod: newest(urls),
            },
            notes: notes.length ? notes : undefined,
            elapsedMs: Date.now() - started,
            scrapedAt: new Date().toISOString(),
        };
    } catch (err) {
        log.warning(`Failed ${url}: ${err.message}`);
        return {
            url,
            ok: false,
            error: err.message,
            errorCode: err.code ?? null,
            elapsedMs: Date.now() - started,
            scrapedAt: new Date().toISOString(),
        };
    }
}

function newest(urls) {
    let best = null;
    for (const u of urls) {
        if (!u.lastmod) continue;
        const t = Date.parse(u.lastmod);
        if (Number.isNaN(t)) continue;
        if (!best || t > best) best = t;
    }
    return best ? new Date(best).toISOString() : null;
}

async function fetchQuiet(url) {
    try {
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        return await gotScraping({
            url,
            proxyUrl,
            timeout: { request: timeoutMs },
            responseType: 'buffer',
            throwHttpErrors: false,
            followRedirect: true,
            maxRedirects: 5,
            retry: { limit: 1 },
            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'] },
        });
    } catch {
        return null;
    }
}

function normalizeUrls(inp) {
    const raw = [];
    const push = (v) => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(push);
        if (typeof v === 'object') return push(v.url ?? v.domain ?? v.website);
        String(v)
            .split(/[\n\r,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((s) => raw.push(s));
    };
    for (const key of ['urls', 'url', 'startUrls', 'domains', 'websites', 'sitemaps']) push(inp[key]);
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(entry);
        if (scheme && !/^https?$/i.test(scheme[1])) {
            log.warning(`Skipping unsupported scheme "${scheme[1]}:": ${entry}`);
            continue;
        }
        let parsed;
        try {
            parsed = new URL(scheme ? entry : `https://${entry}`);
        } catch {
            log.warning(`Skipping invalid URL: ${entry}`);
            continue;
        }
        if (!parsed.hostname?.includes('.')) {
            log.warning(`Skipping URL without a valid hostname: ${entry}`);
            continue;
        }
        if (seen.has(parsed.href)) continue;
        seen.add(parsed.href);
        // A link that already points at a sitemap is used directly instead of rediscovering it.
        out.push({ url: parsed.href, isDirectSitemap: /sitemap[^/]*\.(xml|txt)(\.gz)?($|\?)/i.test(parsed.pathname) });
    }
    return out;
}

function compileFilter(pattern) {
    if (!pattern || typeof pattern !== 'string') return null;
    try {
        return new RegExp(pattern, 'i');
    } catch (err) {
        log.warning(`Ignoring "urlPattern": ${err.message}`);
        return null;
    }
}

async function runPool(items, size, worker) {
    let index = 0;
    const next = async () => {
        while (index < items.length) await worker(items[index++]);
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
}

function clamp(n, lo, hi) {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
