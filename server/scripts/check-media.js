'use strict';

/* Diagnostic: probe every catalogue asset (primary + fallback) as the browser would. */

const API = process.env.API_ORIGIN || 'http://localhost:4300';

async function probe(url, base) {
  const target = new URL(url, base);
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(15000),
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      bytes,
      ms: Date.now() - started,
      final: response.url,
    };
  } catch (error) {
    return { status: `FETCH FAILED (${error.name}: ${error.message})`, ms: Date.now() - started };
  }
}

(async () => {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'host@watchspaces.dev', password: 'Host123!' }),
  }).then((r) => r.json());
  const { titles } = await fetch(`${API}/api/v1/titles`, {
    headers: { authorization: `Bearer ${login.accessToken}` },
  }).then((r) => r.json());

  console.log(`API ${API} — ${titles.length} titles\n`);
  let failures = 0;
  for (const title of titles) {
    const primary = await probe(title.videoAssetUrl, API);
    const fallback = title.fallbackAssetUrl
      ? await probe(title.fallbackAssetUrl, API)
      : { status: 'none (local primary)' };
    const bad = !(primary.status === 200 || primary.status === 206);
    if (bad) failures += 1;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${title.name}`);
    console.log(`       primary  ${primary.status} ${primary.type || ''} ${primary.bytes || 0}B ${primary.ms}ms`);
    console.log(`       fallback ${fallback.status} ${fallback.type || ''} ${fallback.bytes || 0}B`);
  }
  console.log(`\n${failures ? `${failures} title(s) with a failing primary` : 'every title has a working primary source'}`);
  process.exitCode = failures ? 1 : 0;
})().catch((error) => {
  console.error('FAILED', error.message);
  process.exit(1);
});
