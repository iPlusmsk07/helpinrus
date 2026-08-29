const CACHE='pomogay-site-consistency-9';
const ASSETS=['./','index.html','styles.css','app.js','native-bundle.js','config.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','specialist-portraits-v1.png'];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // Один временно недоступный файл больше не ломает установку всего SW.
    await Promise.allSettled(ASSETS.map(asset=>cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=event.request;
  const url=new URL(request.url);
  // Никогда не кэшируем Auth/REST/Storage и другие внешние ответы.
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(request);
      if(response&&response.ok&&response.type==='basic'){
        const cache=await caches.open(CACHE);
        cache.put(request,response.clone()).catch(()=>{});
      }
      return response;
    }catch(error){
      const cached=await caches.match(request);
      if(cached)return cached;
      if(request.mode==='navigate')return caches.match('./');
      throw error;
    }
  })());
});
