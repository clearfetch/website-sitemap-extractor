import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decompressIfNeeded, looksLikeHtmlPage, parseSitemap, sitemapsFromHtml, sitemapsFromRobots } from '../src/sitemap.js';

// --- discovery from robots.txt ----------------------------------------------------------------------------
const robots = `
User-agent: *
Disallow: /admin
Sitemap: https://example.com/sitemap_index.xml
sitemap:/relative-sitemap.xml
Sitemap:   https://example.com/sitemap_index.xml
Sitemap: :::not a url:::
`;
const fromRobots = sitemapsFromRobots(robots, 'https://example.com/');
assert.deepEqual(fromRobots, ['https://example.com/sitemap_index.xml', 'https://example.com/relative-sitemap.xml'],
    'case-insensitive, relative resolved, duplicates dropped, malformed ignored');

// --- discovery from the homepage --------------------------------------------------------------------------
const fromHtml = sitemapsFromHtml(
    `<html><head><link rel="sitemap" href="/sitemap.xml"></head>
     <body><a href="/about">About</a><a href="/sitemap-posts.xml.gz">posts</a><a href="/sitemap-page">not a sitemap file</a></body></html>`,
    'https://example.com/');
assert.deepEqual(fromHtml.sort(), ['https://example.com/sitemap-posts.xml.gz', 'https://example.com/sitemap.xml'].sort(),
    'link rel and .xml/.gz anchors, but not a page whose path merely contains the word');

// --- gzip -------------------------------------------------------------------------------------------------
const plain = Buffer.from('<urlset><url><loc>https://example.com/a</loc></url></urlset>');
assert.equal(decompressIfNeeded(gzipSync(plain)).toString(), plain.toString(), 'gzip is detected from the magic bytes');
assert.equal(decompressIfNeeded(plain).toString(), plain.toString(), 'plain data passes through');

// --- sitemap index ----------------------------------------------------------------------------------------
const index = parseSitemap(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc><lastmod>2026-01-02</lastmod></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`), 'https://example.com/sitemap.xml');
assert.equal(index.type, 'sitemapindex');
assert.equal(index.sitemaps.length, 2);
assert.equal(index.sitemaps[0].lastmod, '2026-01-02');
assert.equal(index.urls.length, 0);

// --- urlset, including the fields other extractors drop ---------------------------------------------------
const urlset = parseSitemap(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/en/post</loc>
    <lastmod>2026-02-03T10:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/post"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/post"/>
    <image:image><image:loc>https://cdn.example.com/a.jpg</image:loc></image:image>
  </url>
  <url><loc>https://example.com/plain</loc></url>
</urlset>`), 'https://example.com/sitemap-posts.xml');
assert.equal(urlset.type, 'urlset');
assert.equal(urlset.urls.length, 2);
const first = urlset.urls[0];
assert.equal(first.loc, 'https://example.com/en/post');
assert.equal(first.lastmod, '2026-02-03T10:00:00+00:00');
assert.equal(first.changefreq, 'weekly');
assert.equal(first.priority, '0.8');
assert.deepEqual(first.alternates.map((a) => a.hreflang), ['fr', 'de'], 'hreflang alternates are kept');
assert.deepEqual(first.images, ['https://cdn.example.com/a.jpg'], 'image entries are kept');
assert.equal(first.source, 'https://example.com/sitemap-posts.xml', 'each URL records which file it came from');
assert.deepEqual(urlset.urls[1].alternates, [], 'a bare url has empty collections, not undefined');

// --- plain-text sitemaps, which the protocol also allows ---------------------------------------------------
const txt = parseSitemap(Buffer.from('https://example.com/one\nhttps://example.com/two\n\n# a comment\n'), 'https://example.com/sitemap.txt');
assert.equal(txt.type, 'urlset');
assert.deepEqual(txt.urls.map((u) => u.loc), ['https://example.com/one', 'https://example.com/two']);

// --- an HTML error page must not be mistaken for a sitemap -------------------------------------------------
assert.ok(looksLikeHtmlPage(Buffer.from('<!DOCTYPE html><html><body>404</body></html>')));
assert.ok(!looksLikeHtmlPage(Buffer.from('<?xml version="1.0"?><urlset></urlset>')));

// --- an empty or unrecognised document -----------------------------------------------------------------------
assert.equal(parseSitemap(Buffer.from('<?xml version="1.0"?><urlset></urlset>'), 'x').type, 'unknown');

console.log('ALL SITEMAP TESTS PASSED');
