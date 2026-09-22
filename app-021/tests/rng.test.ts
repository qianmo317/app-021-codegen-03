import { describe, expect, it } from 'vitest'
import { hashSeed, mulberry32 } from '../src/lib/rng'

describe('mulberry32 带种子随机', () => {
  it('同一种子序列完全一致（可复现基础）', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 100 }, () => a())
    const seqB = Array.from({ length: 100 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同种子序列不同', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(Array.from({ length: 10 }, () => b()))
  })

  it('hashSeed 稳定且对不同输入不同', () => {
    expect(hashSeed(42, 1, 0)).toBe(hashSeed(42, 1, 0))
    expect(hashSeed(42, 1, 0)).not.toBe(hashSeed(42, 2, 0))
  })
})
