interface SupabasePageResult<T> {
  data: T[] | null
  error: unknown
}

type SupabasePageQuery<T> = PromiseLike<SupabasePageResult<T>>

const DEFAULT_PAGE_SIZE = 1000

function toError(error: unknown): Error {
  if (error instanceof Error) return error

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message)
  }

  return new Error(String(error))
}

export async function fetchPaginatedRows<T>(
  buildQuery: (from: number, to: number) => SupabasePageQuery<T>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)

    if (error) throw toError(error)

    const pageRows = data ?? []
    rows.push(...pageRows)

    if (pageRows.length < pageSize) {
      break
    }
  }

  return rows
}
