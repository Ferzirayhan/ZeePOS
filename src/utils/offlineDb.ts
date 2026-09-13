const DB_NAME = 'zeepos_offline_db'
const DB_VERSION = 3

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
        const store = db.createObjectStore('products', { keyPath: ['tenant_id', 'id'] })
        store.createIndex('by_tenant', 'tenant_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('cache_meta')) {
        db.createObjectStore('cache_meta', { keyPath: 'tenant_id' })
      }
      // Remove legacy offline_orders store — offline mode is catalog-only
      if (db.objectStoreNames.contains('offline_orders')) {
        db.deleteObjectStore('offline_orders')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheCatalogProducts(
  products: Array<{ id: number | null; [key: string]: unknown }>,
  tenantId: string,
): Promise<void> {
  if (!tenantId) {
    throw new Error('tenantId wajib untuk cache catalog')
  }
  try {
    const db = await openDatabase()
    const tx = db.transaction(['products', 'cache_meta'], 'readwrite')
    const productStore = tx.objectStore('products')
    for (const prod of products) {
      productStore.put({ ...prod, tenant_id: tenantId })
    }
    const metaStore = tx.objectStore('cache_meta')
    metaStore.put({ tenant_id: tenantId, cached_at: Date.now() })
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Gagal menyimpan cache produk offline:', err)
  }
}

export async function getCachedCatalogProducts<T>(tenantId: string): Promise<T[]> {
  if (!tenantId) {
    return []
  }
  try {
    const db = await openDatabase()
    const tx = db.transaction('products', 'readonly')
    const store = tx.objectStore('products')
    const index = store.index('by_tenant')
    const req = index.getAll(IDBKeyRange.only(tenantId))
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as T[]) || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function getCatalogCacheFreshness(tenantId: string): Promise<number | null> {
  if (!tenantId) {
    return null
  }
  try {
    const db = await openDatabase()
    const tx = db.transaction('cache_meta', 'readonly')
    const store = tx.objectStore('cache_meta')
    const req = store.get(tenantId)
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result?.cached_at ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function clearCatalogCache(tenantId?: string): Promise<void> {
  try {
    const db = await openDatabase()
    if (tenantId) {
      const readonlyTx = db.transaction('products', 'readonly')
      const readonlyStore = readonlyTx.objectStore('products')
      const index = readonlyStore.index('by_tenant')
      const keysReq = index.getAllKeys(IDBKeyRange.only(tenantId))
      const productKeys: IDBValidKey[] = await new Promise((resolve, reject) => {
        keysReq.onsuccess = () => resolve(keysReq.result || [])
        keysReq.onerror = () => reject(keysReq.error)
      })

      const tx = db.transaction(['products', 'cache_meta'], 'readwrite')
      const writeStore = tx.objectStore('products')
      for (const key of productKeys) {
        writeStore.delete(key)
      }
      tx.objectStore('cache_meta').delete(tenantId)
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } else {
      const tx = db.transaction(['products', 'cache_meta'], 'readwrite')
      tx.objectStore('products').clear()
      tx.objectStore('cache_meta').clear()
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    }
  } catch (err) {
    console.warn('Gagal menghapus cache catalog:', err)
  }
}
