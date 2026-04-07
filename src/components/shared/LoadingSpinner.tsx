import { cn } from '@/lib/utils'

interface Props {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function LoadingSpinner({ className, size = 'md' }: Props) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-ran-ice border-t-ran-navy',
        sizes[size],
        className,
      )}
    />
  )
}

export function PageLoading() {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  )
}
