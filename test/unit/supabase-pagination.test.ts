import { describe, expect, it } from 'vitest'
import { fetchPaginatedRows } from '@/lib/supabase-pagination'

describe('fetchPaginatedRows', () => {
  it('keeps requesting pages until the remote page is shorter than the page size', async () => {
    const calls: Array<[number, number]> = []
    const rows = Array.from({ length: 5 }, (_, index) => index + 1)

    const result = await fetchPaginatedRows<number>(async (from, to) => {
      calls.push([from, to])
      return {
        data: rows.slice(from, to + 1),
        error: null,
      }
    }, 2)

    expect(result).toEqual([1, 2, 3, 4, 5])
    expect(calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ])
  })
})
