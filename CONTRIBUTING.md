# Working on this Actor

```bash
npm install
node test/sitemap.test.mjs        # unit tests, no network
./scripts/run-test.sh default     # runs against real websites, charging simulated
```

`src/sitemap.js` holds the parsing and discovery rules as plain functions so they can be tested against fixed
input; `src/main.js` is the Actor shell.

## Things that are easy to get wrong here

- **robots.txt `Sitemap:` values.** Only absolute or root-relative values are accepted. Sites put all sorts of
  things on that line, and a relative path resolved against the wrong base sends the crawler somewhere else
  entirely.
- **Gzip is detected from the file's own magic bytes**, never from the content type, because servers routinely
  serve `.xml.gz` as `text/xml` and plain XML as `application/gzip`.
- **Namespace prefixes survive in XML mode.** cheerio keeps them, so an hreflang alternate has to be matched as
  `node.find('xhtml\\:link, link')` rather than `link` alone.
- **An HTML error page served at `/sitemap.xml`** is common enough that it is checked for explicitly and reported
  as a failed file, rather than parsed into an empty result that looks like a site with no URLs.

## A JavaScript trap this repo keeps hitting

Helpers and constants used by code that runs after the first top-level `await` must be `function` declarations,
not `const`. A `const` declared below that point is still in its temporal dead zone when the work starts and
throws at runtime, not at build time.
