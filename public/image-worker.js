const registryDatabaseName = 'test-parrot-exams-v1'
const databaseVersion = 8
const mediaStore = 'media-assets'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, databaseVersion)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function recordFrom(databaseName, storeName, key) {
  const database = await openDatabase(databaseName)
  try {
    if (!database.objectStoreNames.contains(storeName)) return null
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const get = transaction.objectStore(storeName).get(key)
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
    })
  } finally {
    database.close()
  }
}

async function assetFor(hash) {
  return recordFrom(registryDatabaseName, mediaStore, hash)
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/local-images/')) return
  const hash = url.pathname.slice('/local-images/'.length)
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    event.respondWith(new Response('Image not found', { status: 404 }))
    return
  }
  event.respondWith(assetFor(hash).then(
    (asset) => asset
      ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType } })
      : new Response('Image not found', { status: 404 }),
    () => new Response('Image not found', { status: 404 }),
  ))
})
