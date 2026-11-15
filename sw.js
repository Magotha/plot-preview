// Plot — service worker: the app keeps working without a connection.
//
// Flutter no longer ships a caching service worker, so this one does it:
//  * every file of the app is stored on the device (precache.json, written
//    by tool/make_precache.py after the build, plus whatever the page
//    loaded before this worker took control);
//  * with a connection, files come from the network (a new version shows
//    up at the next launch) and the stored copy is refreshed;
//  * without one — or when it is too slow — the stored copy is used.
// Projects are not here: they live in IndexedDB (see assets_web.dart).
'use strict';

const CACHE = 'plot-app-v1';
const SLOW_MS = 4000;

// Stored under the path only: "?v=…" and "?bench=1" share one copy.
function keyOf(url) {
  const u = new URL(url, self.location.href);
  return u.origin + u.pathname;
}

async function store(cache, url) {
  try {
    const res = await fetch(new Request(url, { cache: 'no-cache' }));
    if (res.ok && res.type === 'basic') {
      await cache.put(keyOf(url), res);
      return true;
    }
  } catch (_) { /* offline: next time */ }
  return false;
}

async function precache() {
  const cache = await caches.open(CACHE);
  let list = [];
  try {
    const res = await fetch(new Request('precache.json', { cache: 'no-store' }));
    if (res.ok) list = await res.json();
  } catch (_) { /* local run without the list */ }
  await Promise.all(list.map(function (u) { return store(cache, u); }));
}

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    for (const name of await caches.keys()) {
      if (name.startsWith('plot-app-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// The page tells which files it loaded before this worker controlled it
// (the drawing engine, which differs between browsers).
self.addEventListener('message', function (event) {
  const data = event.data || {};
  if (data.type === 'refresh') {
    // The page found it is older than what is published: fetch every file
    // again, then tell it (it offers to restart).
    event.waitUntil((async function () {
      const cache = await caches.open(CACHE);
      // Only announced when the new page really arrived.
      if (!(await store(cache, './'))) return;
      await precache();
      if (event.source) event.source.postMessage({ type: 'refreshed' });
    })());
    return;
  }
  if (data.type !== 'cache' || !Array.isArray(data.urls)) return;
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    for (const url of data.urls) {
      if (new URL(url).origin !== self.location.origin) continue;
      if (await cache.match(keyOf(url))) continue;
      await store(cache, url);
    }
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The version check must reach the network, never a stored copy.
  if (url.pathname.endsWith('/build.txt')) return;

  event.respondWith((async function () {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate'
      ? keyOf(self.registration.scope) // the app is one page
      : keyOf(req.url);
    const cached = await cache.match(key);

    // Always asked afresh: the browser's own cache (GitHub Pages lets it
    // keep files for ten minutes) must not hide a new version.
    const fresh = req.mode === 'navigate'
      ? new Request(self.registration.scope, { cache: 'no-cache' })
      : new Request(req.url, { cache: 'no-cache' });
    const fromNet = fetch(fresh).then(function (res) {
      if (res.ok && res.type === 'basic') {
        cache.put(key, res.clone()).catch(function () {});
      }
      return res;
    });
    if (!cached) return fromNet;

    // Keep refreshing the stored copy even if the answer comes too late.
    event.waitUntil(fromNet.catch(function () {}));
    const slow = new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, SLOW_MS);
    });
    try {
      const res = await Promise.race([fromNet, slow]);
      return res && res.ok ? res : cached;
    } catch (_) {
      return cached;
    }
  })());
});
