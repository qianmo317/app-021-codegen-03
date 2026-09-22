import type { ClassEntity } from '../types'

// 数据留在浏览器（IndexedDB），不上传任何学生信息（隐私底线）
export interface Storage {
  getAll(): Promise<ClassEntity[]>
  put(cls: ClassEntity): Promise<void>
  remove(id: string): Promise<void>
}

export class MemoryStorage implements Storage {
  private map = new Map<string, ClassEntity>()
  async getAll(): Promise<ClassEntity[]> {
    return [...this.map.values()].map((c) => structuredClone(c))
  }
  async put(cls: ClassEntity): Promise<void> {
    this.map.set(cls.id, structuredClone(cls))
  }
  async remove(id: string): Promise<void> {
    this.map.delete(id)
  }
}

const DB_NAME = 'app-021-seating'
const STORE = 'classes'

export class IndexedDBStorage implements Storage {
  private dbp: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
      })
    }
    return this.dbp
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
    })
  }

  async getAll(): Promise<ClassEntity[]> {
    const all = await this.tx<ClassEntity[]>('readonly', (s) => s.getAll() as IDBRequest<ClassEntity[]>)
    return all ?? []
  }
  async put(cls: ClassEntity): Promise<void> {
    await this.tx('readwrite', (s) => s.put(cls))
  }
  async remove(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id))
  }
}

export const storage: Storage = typeof indexedDB !== 'undefined' ? new IndexedDBStorage() : new MemoryStorage()
