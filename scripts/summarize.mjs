import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dir = 'storage/datasets/default';
const items = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`)))
    : [];
const ok = items.filter((i) => i.ok);
const bad = items.filter((i) => !i.ok);
console.log(`items: ${items.length} (ok ${ok.length}, failed ${bad.length})`);

for (const i of ok) {
    console.log(
        `  ${i.url.padEnd(34)} via ${String(i.discovery).padEnd(13)} ${String(i.sitemapCount).padStart(3)} file(s) ` +
        ` ${String(i.urlCount).padStart(6)} URLs  newest=${i.stats?.newestLastmod ?? '-'}`,
    );
    console.log(
        `      with lastmod ${i.stats?.withLastmod ?? 0}, alternates ${i.stats?.withAlternates ?? 0}, images ${i.stats?.withImages ?? 0}`,
    );
    for (const n of i.notes ?? []) console.log(`      note: ${n}`);
}
for (const b of bad) console.log(`  FAILED ${b.url}: ${b.error}`);

const cdir = 'storage/datasets/charging_log';
const charges = existsSync(cdir) ? readdirSync(cdir).filter((f) => f.endsWith('.json')) : [];
const byEvent = {};
for (const f of charges) {
    const { eventName } = JSON.parse(readFileSync(`${cdir}/${f}`));
    byEvent[eventName] = (byEvent[eventName] ?? 0) + 1;
}
console.log('charged   :', charges.length, byEvent);
const siteCharges = byEvent['website-processed'] ?? 0;
if (siteCharges !== ok.length) console.log(`!! ${siteCharges} website charges for ${ok.length} good items`);
