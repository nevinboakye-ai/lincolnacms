/* LACMS Wrapped service worker.
   Its only job is to make the Wrapped app open instantly and survive a bad signal: it keeps a copy of the Wrapped page
   and the files it needs, and serves them straight away. It is deliberately narrow:
     - it is registered with a scope of wrapped.html only, so it never touches any other page on the site;
     - it only handles same-site GET requests, so votes (which go to Supabase) are never cached or intercepted;
     - the page itself is "network first" (so a new version of the site is picked up as soon as there is a connection),
       and everything else is "stale while revalidate" (instant, then refreshed in the background).
   Change VERSION to throw away every cached file. */
'use strict';

var VERSION = 'v1';
var CACHE = 'lacms-wrapped-' + VERSION;
var SHELL = ['wrapped.html', 'Media/wrapped-app/icon-192.png', 'Media/ACMS%20Branding/logo.png'];
var MAX_URLS = 80;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' })).catch(function () { /* not fatal */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('lacms-wrapped-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// The page tells us which files it loaded so the first visit is fully available offline.
self.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.type !== 'wr-cache' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(d.urls.slice(0, MAX_URLS).map(function (u) {
      var url; try { url = new URL(u, self.location.href); } catch (x) { return null; }
      if (url.origin !== self.location.origin || /\.html?$/.test(url.pathname)) return null;
      var req = new Request(url.href);
      return cache.match(req).then(function (hit) {
        if (hit) return null;
        return fetch(req).then(function (res) { if (res && res.ok) return cache.put(req, res); }).catch(function () { /* ignore */ });
      });
    }));
  }));
});

function pageKey(url) { return url.origin + url.pathname; }

function samePathOthers(cache, req) {
  var u = new URL(req.url);
  return cache.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      var ku = new URL(k.url); return ku.pathname === u.pathname && ku.search !== u.search;
    }).map(function (k) { return cache.delete(k); }));
  });
}

function pageResponse(req, e) {
  var url = new URL(req.url), key = pageKey(url);
  return caches.open(CACHE).then(function (cache) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) { cache.put(key, res.clone()); }
      return res;
    });
    return cache.match(key).then(function (hit) {
      if (!hit) return net.catch(function () { return Response.error(); });
      // We have a copy: give the network a few seconds, then use the copy so a weak signal never means a blank screen.
      e.waitUntil(net.catch(function () { /* offline: fine */ }));
      return new Promise(function (resolve) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; resolve(hit); } }, 3500);
        net.then(function (res) { if (!done) { done = true; clearTimeout(t); resolve(res && (res.ok || res.type === 'opaqueredirect') ? res : hit); } },
                 function () { if (!done) { done = true; clearTimeout(t); resolve(hit); } });
      });
    });
  });
}

function assetResponse(req, e) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {   // same-site only (checked above); font requests come back as "cors", so do not insist on "basic"
          var copy = res.clone();
          cache.put(req, copy).then(function () { return samePathOthers(cache, req); });
        }
        return res;
      });
      if (hit) { e.waitUntil(net.catch(function () { /* offline: the copy is enough */ })); return hit; }
      return net.catch(function () { return Response.error(); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase, fonts CDNs, anything else: straight to the network
  if (req.headers.has('range')) return;                     // media seeking: let the browser handle it
  if (req.mode === 'navigate') { e.respondWith(pageResponse(req, e)); return; }
  e.respondWith(assetResponse(req, e));
});
