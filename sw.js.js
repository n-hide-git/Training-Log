/**
 * 2026.11.17
 * ジムカーナ練習記録：圏外・電波が弱い場所でも起動できるようにする仕組み（Service Worker）
 *
 * 動き：
 *   ・電波があれば、毎回ネットから最新の index.html を取りに行き、端末にも保存し直す。
 *   ・圏外のとき、または WAIT_MS ミリ秒待っても届かないときは、端末に保存した版で起動する。
 *   ・待ち時間を超えたあとで届いた最新版は、端末に保存しておき、次回の起動から使う。
 *
 * 記録（localStorage）と写真（IndexedDB）には一切触らない。扱うのはページ本体だけ。
 */
'use strict';

var CACHE_PREFIX = 'gymkhana-log-';
var CACHE = CACHE_PREFIX + 'v1';
var SHELL = './index.html';
var WAIT_MS = 3000;

// 最初の1回：ページ本体を端末に保存する
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        return fetch(SHELL, { cache: 'no-cache' }).then(function (res) {
          if (!res || !res.ok) throw new Error('ページを取得できません');
          return cache.put(SHELL, res);
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

// 古い保存領域（名前の違うもの）を片付け、開いている画面をすぐ担当する
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE) return caches.delete(k);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// ページ本体の要求かどうか（./ や ./index.html、画面の読み込み）
function isShellRequest(req, url) {
  if (req.mode === 'navigate') return true;
  var scope = new URL(self.registration.scope);
  return url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
}

// ネットから最新版を取り、うまく取れたら端末にも保存する
function fetchAndStore(cache) {
  return fetch(SHELL, { cache: 'no-cache' }).then(function (res) {
    if (!res || !res.ok) throw new Error('取得失敗');
    return cache.put(SHELL, res.clone()).then(function () { return res; });
  });
}

function shellResponse() {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(SHELL).then(function (saved) {
      var fromNet = fetchAndStore(cache);
      // 端末に保存した版がまだ無ければ、ネットの結果をそのまま返す
      if (!saved) return fromNet;
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve(saved);
        }, WAIT_MS);
        fromNet.then(function (res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(res);
        }).catch(function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(saved);
        });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (!isShellRequest(req, url)) return;
  event.respondWith(
    shellResponse().catch(function () {
      // 保存した版も無く、ネットにもつながらない場合は、通常の読み込みに任せる
      return fetch(req);
    })
  );
});
