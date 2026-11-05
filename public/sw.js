const CACHE = "hana-log-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const home = new URL("./", self.location).href;
      const response = await fetch(home, { cache: "reload" });
      if (!response.ok) throw new Error("App shell unavailable");
      const html = await response.text();
      const assets = [
        ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
      ].map((m) => new URL(m[1], home).href);
      const cache = await caches.open(CACHE);
      await cache.addAll([
        home,
        ...assets,
        "./icon.svg",
        "./manifest.webmanifest",
        "./icon-192.png",
        "./icon-512.png",
        "./apple-touch-icon.png",
      ]);
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("hana-log-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    (async () => {
      // 静的な同一オリジンのアプリシェルのみ。配信側の Vary: Origin に依存しない。
      const cached = await caches.match(event.request, { ignoreVary: true });
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate")
          return (
            (await caches.match(new URL("./", self.location).href)) ||
            Response.error()
          );
        return Response.error();
      }
    })(),
  );
});
