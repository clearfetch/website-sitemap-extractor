# Website Sitemap Extractor - Find Sitemaps & Extract URLs

Give it a domain. It finds the sitemaps itself, follows index files, unpacks gzipped ones, and returns every URL
with its last-modified date, hreflang alternates and images. **$0.002 per website plus $0.02 per 1,000 URLs.**
Websites with no sitemap are free.

## Why this one

Most sitemap tools ask you for the sitemap URL. If you already knew where it was, you would not need the tool.
This one starts from a bare domain and looks in the three places a sitemap actually lives:

1. **robots.txt**, where the standard says it should be declared.
2. **A link on the homepage**, which some content systems use instead.
3. **The usual paths**, from `/sitemap.xml` to `/wp-sitemap.xml` and `/sitemap_index.xml`.

The output tells you which of the three worked, so an SEO audit can flag a site that has a sitemap but never
declares it.

It also handles the parts that break naive extractors:

- **Sitemap index files**, followed recursively, because large sites split their URLs across hundreds of files.
- **Gzipped sitemaps**, detected from the file's own bytes rather than the content type, which servers get wrong.
- **Plain-text sitemaps**, which the protocol allows and almost nothing supports.
- **An HTML error page served in place of a sitemap**, reported as a failed file instead of parsed into nonsense.

## What data you get

Per URL: `loc`, `lastmod`, `changefreq`, `priority`, **hreflang alternates**, **image URLs**, and the
sitemap file it came from, which matters on sites with dozens of them.

Per website: how the sitemap was discovered, the full sitemap tree with the URL count of each file, and a summary
including the newest `lastmod` anywhere on the site, which tells you at a glance when it last changed.

## How to use

1. Paste domains into **Websites**, one per line. A direct sitemap link works too and is used as-is.
2. Optionally filter with **URL filter** (a regular expression) or **Changed since** (a date), to pull only what
   you need.
3. Run it. Each website is one row, exportable as JSON, CSV or Excel.

## Input

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | array | — | Domains, or direct sitemap links. Also accepts `url` and `startUrls`. |
| `maxUrlsPerSite` | integer | `0` | Stop after this many URLs per website. 0 means no limit. |
| `maxSitemaps` | integer | `50` | How many sitemap files to read per website. |
| `urlPattern` | string | — | Case-insensitive regular expression; only matching URLs are returned. |
| `changedSince` | string | — | A date such as `2026-01-31`; only URLs with a `lastmod` on or after it. |
| `includeUrlList` | boolean | `true` | Turn off for counts and the sitemap tree only, when auditing many sites. |
| `maxConcurrency` | integer | `5` | Websites processed in parallel. |
| `timeoutSecs` | integer | `30` | Per-request timeout. |
| `proxyConfiguration` | object | off | Optional. Not needed for most sites. |

## Output example

One website, trimmed to two URLs and three sitemap files:

```json
{
  "url": "https://vercel.com/",
  "ok": true,
  "discovery": "robots.txt",
  "sitemapCount": 1,
  "sitemaps": [
    {
      "url": "https://vercel.com/sitemap.xml",
      "ok": true,
      "type": "urlset",
      "urls": 7092,
      "children": 0,
      "depth": 0
    }
  ],
  "urlCount": 500,
  "urls": [
    {
      "loc": "https://vercel.com/docs/flags",
      "lastmod": "2026-08-29T03:11:19.144Z",
      "changefreq": null,
      "priority": null,
      "alternates": [],
      "images": [],
      "source": "https://vercel.com/sitemap.xml"
    },
    {
      "loc": "https://vercel.com/kb/ai-sdk",
      "lastmod": "2026-08-26T01:31:12.753Z",
      "changefreq": null,
      "priority": null,
      "alternates": [],
      "images": [],
      "source": "https://vercel.com/sitemap.xml"
    }
  ],
  "stats": {
    "withLastmod": 500,
    "withAlternates": 0,
    "withImages": 0,
    "newestLastmod": "2026-09-06T10:10:02.700Z"
  },
  "notes": [
    "Stopped at the \"maxUrlsPerSite\" limit of 500; the site has more."
  ],
  "elapsedMs": 330,
  "scrapedAt": "2026-09-06T10:30:50.785Z"
}
```

A website with no sitemap is reported and costs nothing:

```json
{
  "url": "https://this-domain-does-not-exist-12345.com/",
  "ok": false,
  "error": "no sitemap found in robots.txt, on the homepage, or at any of the usual paths",
  "elapsedMs": 11729,
  "scrapedAt": "2026-09-06T10:31:02.184Z"
}
```

## Pricing

- **$0.002 per website**, covering discovery and every sitemap file read.
- **$0.02 per 1,000 URLs** returned. A 500-page site costs about a cent. A 50,000-page site costs about a dollar.
- Websites with no sitemap are free.

## Use cases

- **Crawl planning**: get the URL list before you crawl, so you scrape only what exists.
- **SEO audits**: find sites whose sitemap is undeclared, whose index points at missing files, or whose
  `lastmod` dates are stale.
- **Change monitoring**: run with **Changed since** on a schedule and get only the pages updated since your last
  run.
- **Content migration**: enumerate every URL on the old site before switching over.
- **Feeding other tools**: pipe the URL list into a scraper, a screenshot tool, or a technology detector.
- **AI agents**: a tool that answers "what pages does this site have" without crawling it.

## Integrations

```bash
curl -X POST "https://api.apify.com/v2/acts/clearfetch~website-sitemap-extractor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["apify.com"], "urlPattern": "/blog/"}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("clearfetch/website-sitemap-extractor").call(
    run_input={"urls": ["apify.com"], "changedSince": "2026-01-01"}
)

for site in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(site["url"], site["urlCount"], "URLs via", site["discovery"])
    for u in site["urls"][:5]:
        print("  ", u["lastmod"], u["loc"])
```

Works with the Apify integrations for n8n, Make, Zapier, Google Sheets, Slack and webhooks, with scheduled runs,
and with AI agents through the Apify MCP server.

## FAQ

**What if a site has no sitemap?** The row comes back with `ok: false` and an explanation, and you are not
charged for it.

**Does it check whether the URLs work?** No. This lists what a site says it publishes. Checking each URL is a
different job with a different cost profile.

**How deep does it follow index files?** As deep as they go, breadth-first, up to the **maxSitemaps** limit. If
that limit stops it early, the output says so and tells you how many files were left.

**Are gzipped sitemaps supported?** Yes, detected from the file's own magic bytes, because servers routinely
send them with the wrong content type.

**Do I need a proxy?** No. A proxy input exists for sites that block datacenter traffic.

**Is this legal?** A sitemap is a file a website publishes specifically to be read by machines. This reads it.

## Changelog

- **1.0.0** (2026-09) — first release: discovery from robots.txt, homepage links and common paths; recursive
  index following; gzip and plain-text sitemaps; hreflang alternates and images; filtering by pattern and date.
