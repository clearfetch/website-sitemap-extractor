/**
 * Sitemap discovery and parsing. Pure functions over strings and buffers, so every rule is testable offline.
 */
import { gunzipSync, inflateSync } from 'node:zlib';
import * as cheerio from 'cheerio';

/** Paths worth trying when a site does not advertise its sitemap in robots.txt. */
export const COMMON_PATHS = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemap.xml.gz',
    '/sitemap/sitemap.xml',
    '/wp-sitemap.xml',
    '/sitemap1.xml',
    '/sitemaps/sitemap.xml',
    '/sitemap/index.xml',
];

/** Sitemap URLs advertised in robots.txt, which is where a site is supposed to declare them. */
export function sitemapsFromRobots(robotsText, baseUrl) {
    const out = [];
    for (const line of String(robotsText ?? '').split(/\r?\n/)) {
        const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
        if (!m) continue;
        const value = m[1];
        // The spec wants an absolute URL; relative paths appear in the wild and are worth resolving. Anything
        // else is a malformed line, and `new URL` would happily turn ":::junk:::" into a path on this host.
        if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) continue;
        try {
            out.push(new URL(value, baseUrl).href);
        } catch {
            /* a malformed entry should not stop the rest */
        }
    }
    return [...new Set(out)];
}

/** Sitemaps a page links to directly, which some sites do instead of using robots.txt. */
export function sitemapsFromHtml(html, baseUrl) {
    const $ = cheerio.load(html ?? '');
    const out = [];
    $('link[rel="sitemap"], a[href*="sitemap" i]').each((_, el) => {
        const href = el.attribs?.href;
        if (!href || !/sitemap[^/]*\.(xml|txt)(\.gz)?($|\?)/i.test(href)) return;
        try {
            out.push(new URL(href, baseUrl).href);
        } catch {
            /* ignore */
        }
    });
    return [...new Set(out)];
}

/** Gzipped sitemaps are common and are served with every content type imaginable, so sniff the magic bytes. */
export function decompressIfNeeded(buffer) {
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer);
    if (buffer.length > 2 && buffer[0] === 0x78 && [0x01, 0x9c, 0xda].includes(buffer[1])) return inflateSync(buffer);
    return buffer;
}

const text = (node) => node.text().trim();

/**
 * Parses a sitemap document.
 *
 * Returns either child sitemaps (a sitemap index) or URLs (a urlset). A plain-text sitemap, which the protocol
 * also allows, is one URL per line. Namespaced children such as xhtml:link alternates, image:image and
 * video:video are read too, since those are the fields that make a sitemap worth extracting rather than just
 * crawling the site.
 */
export function parseSitemap(body, sourceUrl) {
    const raw = body.toString('utf8');
    const trimmed = raw.trimStart();

    if (!trimmed.startsWith('<')) {
        // Plain-text sitemap: one URL per line.
        const urls = trimmed
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => /^https?:\/\//i.test(l))
            .map((loc) => ({ loc, lastmod: null, changefreq: null, priority: null, alternates: [], images: [], source: sourceUrl }));
        return { type: urls.length ? 'urlset' : 'unknown', sitemaps: [], urls };
    }

    const $ = cheerio.load(raw, { xmlMode: true });
    const isIndex = $('sitemapindex').length > 0 || ($('sitemap > loc').length > 0 && $('url > loc').length === 0);

    if (isIndex) {
        const sitemaps = [];
        $('sitemap').each((_, el) => {
            const node = $(el);
            const loc = text(node.find('loc').first());
            if (!loc) return;
            sitemaps.push({ loc, lastmod: text(node.find('lastmod').first()) || null });
        });
        return { type: 'sitemapindex', sitemaps, urls: [] };
    }

    const urls = [];
    $('url').each((_, el) => {
        const node = $(el);
        const loc = text(node.find('loc').first());
        if (!loc) return;
        const alternates = [];
        // In XML mode cheerio keeps the namespace prefix, so xhtml:link has to be selected by its full name.
        node.find('xhtml\\:link, link').filter((__, el) => (el.attribs?.rel ?? 'alternate') === 'alternate').each((__, link) => {
            const href = link.attribs?.href;
            const hreflang = link.attribs?.hreflang;
            if (href) alternates.push({ hreflang: hreflang ?? null, href });
        });
        const images = [];
        node.find('image\\:image, image').each((__, img) => {
            const imgLoc = text($(img).find('loc, image\\:loc').first()) || text($(img).find('image\\:loc').first());
            if (imgLoc) images.push(imgLoc);
        });
        urls.push({
            loc,
            lastmod: text(node.find('lastmod').first()) || null,
            changefreq: text(node.find('changefreq').first()) || null,
            priority: text(node.find('priority').first()) || null,
            alternates,
            images,
            source: sourceUrl,
        });
    });
    return { type: urls.length ? 'urlset' : 'unknown', sitemaps: [], urls };
}

/** True when a sitemap document is XML we could not make sense of, which usually means an HTML error page. */
export function looksLikeHtmlPage(body) {
    const head = body.toString('utf8', 0, 500).trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
}
