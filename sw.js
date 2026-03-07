const CACHE_NAME = 'diari-classe-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/state.js',
  '/views.js',
  '/actions.js',
  '/utils.js',
  '/i18n.js',
  '/evaluation.js',
  '/style.css',
  '/manifest.json',
  '/logo.png',
  '/favicon.ico',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://d3js.org/d3.v7.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
