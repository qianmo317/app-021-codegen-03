import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../src/lib/storage'
import { makeClass } from './helpers'

describe('存储契约（MemoryStorage 实现）', () => {
  it('put/getAll/remove 往返一致', async () => {
    const s = new MemoryStorage()
    expect(await s.getAll()).toHaveLength(0)
    const cls = makeClass({ name: '一班' })
    await s.put(cls)
    const all = await s.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('一班')
    expect(all[0]).not.toBe(cls) // 深拷贝隔离
    // 更新
    cls.name = '一班（改）'
    await s.put(cls)
    expect((await s.getAll())[0].name).toBe('一班（改）')
    expect(await s.getAll()).toHaveLength(1)
    // 删除
    await s.remove(cls.id)
    expect(await s.getAll()).toHaveLength(0)
    await expect(s.remove('不存在')).resolves.toBeUndefined()
  })
})
