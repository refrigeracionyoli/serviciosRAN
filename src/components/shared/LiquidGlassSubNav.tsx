import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface LiquidGlassSubNavItem {
  to: string
  label: string
  icon: ElementType
  end?: boolean
  isActive?: (pathname: string) => boolean
}

interface LiquidGlassSubNavProps {
  items: LiquidGlassSubNavItem[]
  memoryKey: string
}

interface IndicatorState {
  left: number
  width: number
  ready: boolean
}

interface TabRect {
  left: number
  width: number
  center: number
}

type MoveDirection = 'left' | 'right'

const MOTION_DURATION_MS = 760
const MOTION_SETTLE_MS = 120
const MOTION_EASING = 'cubic-bezier(0.18,0.9,0.2,1.02)'
const indicatorMemory = new Map<string, IndicatorState>()

function toTabRect(rect: Pick<IndicatorState, 'left' | 'width'>): TabRect {
  return {
    left: rect.left,
    width: rect.width,
    center: rect.left + rect.width / 2,
  }
}

function isDefaultTabActive(pathname: string, item: LiquidGlassSubNavItem): boolean {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export function LiquidGlassSubNav({ items, memoryKey }: LiquidGlassSubNavProps) {
  const location = useLocation()
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const indicatorElementRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const targetAnimationFrameRef = useRef<number | null>(null)
  const movingTimeoutRef = useRef<number | null>(null)
  const reduceMotionRef = useRef(false)

  const [indicator, setIndicator] = useState<IndicatorState>(() => (
    indicatorMemory.get(memoryKey) ?? {
      left: 0,
      width: 0,
      ready: false,
    }
  ))
  const indicatorStateRef = useRef(indicator)
  const [canAnimateIndicator, setCanAnimateIndicator] = useState(false)
  const [isMoving, setIsMoving] = useState(false)
  const [moveDirection, setMoveDirection] = useState<MoveDirection>('right')

  const activeIndex = useMemo(() => {
    const index = items.findIndex((item) => (
      item.isActive ? item.isActive(location.pathname) : isDefaultTabActive(location.pathname, item)
    ))
    return index >= 0 ? index : 0
  }, [items, location.pathname])

  const setIndicatorState = useCallback((next: IndicatorState) => {
    indicatorStateRef.current = next
    setIndicator(next)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyPreference = () => {
      reduceMotionRef.current = media.matches
    }

    applyPreference()
    media.addEventListener('change', applyPreference)

    return () => {
      media.removeEventListener('change', applyPreference)
    }
  }, [])

  const clearMotionTimers = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (targetAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(targetAnimationFrameRef.current)
      targetAnimationFrameRef.current = null
    }

    if (movingTimeoutRef.current !== null) {
      window.clearTimeout(movingTimeoutRef.current)
      movingTimeoutRef.current = null
    }
  }, [])

  const getTabRect = useCallback((index: number): TabRect | null => {
    const element = itemRefs.current[index]
    if (!element) return null

    const left = element.offsetLeft
    const width = element.offsetWidth

    return {
      left,
      width,
      center: left + width / 2,
    }
  }, [])

  const getVisualIndicatorRect = useCallback((): TabRect | null => {
    const element = indicatorElementRef.current
    if (element) {
      const style = window.getComputedStyle(element)
      const left = Number.parseFloat(style.left)
      const width = Number.parseFloat(style.width)

      if (Number.isFinite(left) && Number.isFinite(width) && width > 0) {
        return toTabRect({ left, width })
      }
    }

    const fallback = indicatorStateRef.current
    return fallback.ready ? toTabRect(fallback) : null
  }, [])

  const rememberVisualIndicatorRect = useCallback(() => {
    const visualRect = getVisualIndicatorRect()
    if (!visualRect) return

    indicatorMemory.set(memoryKey, {
      left: visualRect.left,
      width: visualRect.width,
      ready: true,
    })
  }, [getVisualIndicatorRect, memoryKey])

  const syncIndicatorToActive = useCallback(() => {
    const activeRect = getTabRect(activeIndex)
    if (!activeRect) return

    clearMotionTimers()
    setCanAnimateIndicator(false)
    setIndicatorState({ left: activeRect.left, width: activeRect.width, ready: true })
    setIsMoving(false)

    animationFrameRef.current = window.requestAnimationFrame(() => {
      setCanAnimateIndicator(true)
      animationFrameRef.current = null
    })
  }, [activeIndex, clearMotionTimers, getTabRect, setIndicatorState])

  const animateIndicator = useCallback(() => {
    const activeRect = getTabRect(activeIndex)
    if (!activeRect) return

    const visualRect = getVisualIndicatorRect()

    if (!visualRect || reduceMotionRef.current) {
      syncIndicatorToActive()
      return
    }

    const hasMoved = visualRect.left !== activeRect.left || visualRect.width !== activeRect.width
    if (!hasMoved) {
      setIndicatorState({ left: activeRect.left, width: activeRect.width, ready: true })
      setIsMoving(false)
      return
    }

    clearMotionTimers()
    const nextMoveDirection = activeRect.center > visualRect.center ? 'right' : 'left'
    setMoveDirection(nextMoveDirection)
    setIsMoving(false)

    setCanAnimateIndicator(false)
    setIndicatorState({ left: visualRect.left, width: visualRect.width, ready: true })

    animationFrameRef.current = window.requestAnimationFrame(() => {
      setCanAnimateIndicator(true)
      setIsMoving(true)
      animationFrameRef.current = null

      targetAnimationFrameRef.current = window.requestAnimationFrame(() => {
        setIndicatorState({ left: activeRect.left, width: activeRect.width, ready: true })
        targetAnimationFrameRef.current = null
      })
    })

    movingTimeoutRef.current = window.setTimeout(() => {
      setIsMoving(false)
      movingTimeoutRef.current = null
    }, MOTION_DURATION_MS + MOTION_SETTLE_MS)
  }, [
    activeIndex,
    clearMotionTimers,
    getTabRect,
    getVisualIndicatorRect,
    setIndicatorState,
    syncIndicatorToActive,
  ])

  useEffect(() => {
    animateIndicator()
  }, [animateIndicator])

  useEffect(() => {
    const handleResize = () => {
      syncIndicatorToActive()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [syncIndicatorToActive])

  useEffect(() => {
    return () => {
      clearMotionTimers()
    }
  }, [clearMotionTimers])

  useLayoutEffect(() => {
    return () => {
      rememberVisualIndicatorRect()
      clearMotionTimers()
    }
  }, [clearMotionTimers, rememberVisualIndicatorRect])

  return (
    <nav className="mb-4 overflow-x-auto rounded-2xl border border-slate-200/90 bg-white/80 p-2 shadow-[0_16px_40px_-20px_rgba(27,59,111,0.42)] backdrop-blur-[14px] backdrop-saturate-[165%]">
      <div className="relative flex w-fit min-w-max items-center gap-2 rounded-xl bg-[linear-gradient(132deg,rgba(255,255,255,0.94)_0%,rgba(245,247,250,0.92)_42%,rgba(235,244,255,0.9)_68%,rgba(255,255,255,0.94)_100%)] px-1 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_-1px_0_rgba(27,59,111,0.08)]">
        <div
          ref={indicatorElementRef}
          data-liquid-glass-indicator={memoryKey}
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 z-0 h-10 -translate-y-1/2 rounded-[14px] border border-white/90 transition-[left,width,transform,opacity,box-shadow,filter] [transition-timing-function:cubic-bezier(0.18,0.9,0.2,1.02)]',
            !canAnimateIndicator && 'transition-none',
            indicator.ready ? 'opacity-100' : 'opacity-0',
            isMoving ? 'scale-x-[1.18] scale-y-[0.92]' : 'scale-x-100 scale-y-100',
          )}
          style={{
            left: indicator.left,
            width: indicator.width,
            background:
              'linear-gradient(160deg, rgba(255,255,255,0.96) 0%, rgba(235,244,255,0.91) 36%, rgba(219,231,247,0.9) 64%, rgba(250,253,255,0.95) 100%)',
            boxShadow: isMoving
              ? '0 16px 30px -10px rgba(27,59,111,0.4), 0 2px 14px rgba(92,131,182,0.3), inset 0 1px 0 rgba(255,255,255,0.98), inset 0 -1px 0 rgba(147,174,208,0.42), 0 0 0 1px rgba(218,230,246,0.85)'
              : '0 10px 22px -12px rgba(27,59,111,0.3), 0 2px 10px rgba(92,131,182,0.24), inset 0 1px 0 rgba(255,255,255,0.97), inset 0 -1px 0 rgba(147,174,208,0.3), 0 0 0 1px rgba(218,230,246,0.72)',
            backdropFilter: 'blur(18px) saturate(185%) brightness(1.03)',
            WebkitBackdropFilter: 'blur(18px) saturate(185%) brightness(1.03)',
            transitionDuration: `${MOTION_DURATION_MS}ms`,
            transitionTimingFunction: MOTION_EASING,
          }}
        >
          <span
            aria-hidden
            className="absolute inset-[1px] rounded-[12px] bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(232,241,252,0.2)_64%,rgba(255,255,255,0.12)_100%)]"
          />
          <span
            aria-hidden
            className="absolute left-2 right-2 top-0.5 h-[44%] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(255,255,255,0.22)_58%,rgba(255,255,255,0)_100%)] opacity-100"
          />
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-1 w-[28%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.85)_46%,rgba(255,255,255,0)_100%)] blur-[0.8px] transition-[transform,opacity] [transition-timing-function:cubic-bezier(0.2,0.8,0.2,1)]',
              isMoving ? 'opacity-95' : 'opacity-72',
            )}
            style={{
              left: moveDirection === 'right' ? '16%' : '56%',
              transform: `translateX(${isMoving ? (moveDirection === 'right' ? '30%' : '-30%') : '0%'})`,
              transitionDuration: `${MOTION_DURATION_MS + 80}ms`,
            }}
          />
          <span
            aria-hidden
            className={cn(
              'absolute -top-5 h-16 w-10 rounded-full bg-white/80 blur-md transition-[transform,opacity] [transition-timing-function:cubic-bezier(0.2,0.8,0.2,1)]',
              isMoving ? 'opacity-95' : 'opacity-48',
            )}
            style={{
              transform: `translateX(${isMoving
                ? moveDirection === 'right'
                  ? 40
                  : -40
                : moveDirection === 'right'
                  ? -24
                  : 24}px) rotate(${moveDirection === 'right' ? '16deg' : '-16deg'})`,
              transitionDuration: `${MOTION_DURATION_MS + 60}ms`,
            }}
          />
          <span
            className={cn(
              'absolute top-1/2 h-5.5 w-5.5 -translate-y-1/2 rounded-full bg-white/95 blur-[2.4px] transition-all [transition-timing-function:cubic-bezier(0.18,0.9,0.2,1.02)]',
              moveDirection === 'right' ? '-right-2' : '-left-2',
              isMoving ? 'opacity-100 scale-100' : 'opacity-0 scale-75',
            )}
            style={{
              transitionDuration: `${MOTION_DURATION_MS}ms`,
            }}
          />
          <span
            className={cn(
              'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-ran-ice/95 blur-[1.2px] transition-all [transition-timing-function:cubic-bezier(0.18,0.9,0.2,1.02)]',
              moveDirection === 'right' ? '-left-1.5' : '-right-1.5',
              isMoving ? 'opacity-95 scale-100' : 'opacity-0 scale-75',
            )}
            style={{
              transitionDuration: `${MOTION_DURATION_MS}ms`,
            }}
          />
        </div>

        {items.map((item, index) => {
          const active = item.isActive
            ? item.isActive(location.pathname)
            : isDefaultTabActive(location.pathname, item)

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              onPointerDown={rememberVisualIndicatorRect}
              onClick={rememberVisualIndicatorRect}
              className={() => cn(
                'relative z-10 inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-300',
                active
                  ? 'text-ran-navy drop-shadow-[0_1px_0_rgba(255,255,255,0.95)]'
                  : 'text-ran-slate/90 hover:bg-ran-ice/75 hover:text-ran-navy',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
