const DB_NAME = 'zeepos_offline_db'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB tidak didukung'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('offline_orders')) {
        db.createObjectStore('offline_orders', { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheCatalogProducts(products: Array<{ id: number; [key: string]: unknown }>): Promise<void> {
  try {
    const db = await openDatabase()
    const tx = db.transaction('products', 'readwrite')
    const store = tx.objectStore('products')
    for (const prod of products) {
      store.put(prod)
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Gagal menyimpan cache produk offline:', err)
  }
}

export async function getCachedCatalogProducts<T>(): Promise<T[]> {
  try {
    const db = await openDatabase()
    const tx = db.transaction('products', 'readonly')
    const store = tx.objectStore('products')
    const req = store.getAll()
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as T[]) || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function queueOfflineOrder(payload: Record<string, unknown>): Promise<string> {
  const db = await openDatabase()
  const tx = db.transaction('offline_orders', 'readwrite')
  const store = tx.objectStore('offline_orders')
  const id = `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  store.add({
    id,
    created_at: new Date().toISOString(),
    payload,
    synced: false,
  })

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(id)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getOfflineOrdersCount(): Promise<number> {
  try {
    const db = await openDatabase()
    const tx = db.transaction('offline_orders', 'readonly')
    const store = tx.objectStore('offline_orders')
    const req = store.count()
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return 0
  }
}

export async function getAllOfflineOrders(): Promise<Array<{ id: string; created_at: string; payload: Record<string, unknown>; synced: boolean }>> {
  try {
    const db = await openDatabase()
    const tx = db.transaction('offline_orders', 'readonly')
    const store = tx.objectStore('offline_orders')
    const req = store.getAll()
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function removeOfflineOrder(id: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction('offline_orders', 'readwrite')
  const store = tx.objectStore('offline_orders')
  store.delete(id)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
