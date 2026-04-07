import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Boxes, ClipboardList, UsersRound } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Item {
  to: string
  label: string
  icon: React.ElementType
  end?: boolean
}

const items: Item[] = [
  { to: '/inventario', label: 'Catálogo', icon: Boxes, end: true },
  { to: '/inventario/tecnico', label: 'Inventario por técnico', icon: UsersRound },
  { to: '/inventario/movimientos', label: 'Movimientos', icon: ClipboardList },
]

interface IndicatorState {
  left: number
  width: number
  ready: boolean
}

interface SlimeBridgeState {
  left: number
  width: number
  visible: boolean
}

interface TabRect {
  left: number
  width: number
  center: number
}

type MoveDirection = 'left' | 'right'

let lastActiveTabIndex: number | null = null
const MOTION_DURATION_MS = 760
const MOTION_SETTLE_MS = 120
const MOTION_EASING = 'cubic-bezier(0.18,0.9,0.2,1.02)'

function isTabActive(pathname: string, item: Item): boolean {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export function InventarioSubNav() {
  const location = useLocation()
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const animationFrameRef = useRef<number | null>(null)
  const animationFrameRef2 = useRef<number | null>(null)
  const movingTimeoutRef = useRef<number | null>(null)

  const [indicator, setIndicator] = useState<IndicatorState>({
    left: 0,
    width: 0,
    ready: false,
  })
  const [slimeBridge, setSlimeBridge] = useState<SlimeBridgeState>({
    left: 0,
    width: 0,
    visible: false,
  })
  const [canAnimateIndicator, setCanAnimateIndicator] = useState(false)
  const [isMoving, setIsMoving] = useState(false)
  const [moveDirection, setMoveDirection] = useState<MoveDirection>('right')

  const activeIndex = useMemo(() => {
    const index = items.findIndex((item) => isTabActive(location.pathname, item))
    return index >= 0 ? index : 0
  }, [location.pathname])

  const clearMotionTimers = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (animationFrameRef2.current !== null) {
      window.cancelAnimationFrame(animationFrameRef2.current)
      animationFrameRef2.current = null
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

  const syncIndicatorToActive = useCallback(() => {
    const activeRect = getTabRect(activeIndex)
    if (!activeRect) return

    setCanAnimateIndicator(false)
    setIndicator({ left: activeRect.left, width: activeRect.width, ready: true })
    setSlimeBridge((previous) => ({ ...previous, visible: false }))
    setIsMoving(false)

    animationFrameRef.current = window.requestAnimationFrame(() => {
      setCanAnimateIndicator(true)
      animationFrameRef.current = null
    })
  }, [activeIndex, getTabRect])

  const animateIndicator = useCallback((fromIndex: number | null) => {
    const activeRect = getTabRect(activeIndex)
    if (!activeRect) return

    const fromRect = fromIndex != null ? getTabRect(fromIndex) : null

    if (!fromRect) {
      setCanAnimateIndicator(false)
      setIndicator({ left: activeRect.left, width: activeRect.width, ready: true })
      setSlimeBridge((previous) => ({ ...previous, visible: false }))
      setIsMoving(false)

      animationFrameRef.current = window.requestAnimationFrame(() => {
        setCanAnimateIndicator(true)
        animationFrameRef.current = null
      })

      lastActiveTabIndex = activeIndex
      return
    }

    const hasMoved = fromRect.left !== activeRect.left || fromRect.width !== activeRect.width

    if (!hasMoved) {
      setCanAnimateIndicator(false)
      setIndicator({ left: activeRect.left, width: activeRect.width, ready: true })
      setSlimeBridge((previous) => ({ ...previous, visible: false }))
      setIsMoving(false)

      animationFrameRef.current = window.requestAnimationFrame(() => {
        setCanAnimateIndicator(true)
        animationFrameRef.current = null
      })

      lastActiveTabIndex = activeIndex
      return
    }

    clearMotionTimers()
    setMoveDirection(activeRect.left > fromRect.left ? 'right' : 'left')
    setIsMoving(true)

    const bridgePadding = 16
    setSlimeBridge({
      left: Math.min(fromRect.center, activeRect.center) - bridgePadding,
      width: Math.abs(activeRect.center - fromRect.center) + bridgePadding * 2,
      visible: true,
    })

    setCanAnimateIndicator(false)
    setIndicator({ left: fromRect.left, width: fromRect.width, ready: true })

    animationFrameRef.current = window.requestAnimationFrame(() => {
      setCanAnimateIndicator(true)
      animationFrameRef.current = null

      animationFrameRef2.current = window.requestAnimationFrame(() => {
        setIndicator({ left: activeRect.left, width: activeRect.width, ready: true })
        animationFrameRef2.current = null
      })
    })

    movingTimeoutRef.current = window.setTimeout(() => {
      setIsMoving(false)
      setSlimeBridge((previous) => ({ ...previous, visible: false }))
      movingTimeoutRef.current = null
    }, MOTION_DURATION_MS + MOTION_SETTLE_MS)

    lastActiveTabIndex = activeIndex
  }, [activeIndex, clearMotionTimers, getTabRect])

  useLayoutEffect(() => {
    animateIndicator(lastActiveTabIndex)
  }, [animateIndicator])

  useEffect(() => {
    const handleResize = () => {
      clearMotionTimers()
      syncIndicatorToActive()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [clearMotionTimers, syncIndicatorToActive])

  useEffect(() => {
    return () => {
      clearMotionTimers()
    }
  }, [clearMotionTimers])

  return (
    <nav className="mb-4 overflow-x-auto rounded-2xl border border-slate-200/90 bg-white/80 p-2 shadow-[0_16px_40px_-20px_rgba(27,59,111,0.42)] backdrop-blur-[14px] backdrop-saturate-[165%]">
      <div className="relative flex w-fit min-w-max items-center gap-2 rounded-xl bg-[linear-gradient(132deg,rgba(255,255,255,0.94)_0%,rgba(245,247,250,0.92)_42%,rgba(235,244,255,0.9)_68%,rgba(255,255,255,0.94)_100%)] px-1 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_-1px_0_rgba(27,59,111,0.08)]">
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 z-0 h-11 -translate-y-1/2 rounded-full transition-[left,width,opacity,transform,filter,box-shadow] ease-[cubic-bezier(0.18,0.9,0.2,1.02)]',
            slimeBridge.visible ? 'opacity-95 scale-x-100' : 'opacity-0 scale-x-90',
          )}
          style={{
            left: slimeBridge.left,
            width: slimeBridge.width,
            background:
              'linear-gradient(90deg, rgba(124,155,193,0.12) 0%, rgba(77,118,172,0.46) 38%, rgba(59,101,161,0.54) 50%, rgba(77,118,172,0.46) 62%, rgba(124,155,193,0.12) 100%)',
            boxShadow: isMoving
              ? '0 0 30px rgba(69,111,170,0.42), 0 0 14px rgba(179,207,240,0.34)'
              : '0 0 22px rgba(69,111,170,0.28)',
            filter: isMoving ? 'blur(15px) saturate(165%)' : 'blur(11px) saturate(140%)',
            transitionDuration: `${MOTION_DURATION_MS}ms`,
            transitionTimingFunction: MOTION_EASING,
          }}
        />

        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 z-0 h-10 -translate-y-1/2 rounded-[14px] border border-white/90 transition-[left,width,transform,opacity,box-shadow,filter] ease-[cubic-bezier(0.18,0.9,0.2,1.02)]',
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
              'absolute inset-y-1 w-[28%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.85)_46%,rgba(255,255,255,0)_100%)] blur-[0.8px] transition-[transform,opacity] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
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
              'absolute -top-5 h-16 w-10 rounded-full bg-white/80 blur-md transition-[transform,opacity] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
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
              'absolute top-1/2 h-5.5 w-5.5 -translate-y-1/2 rounded-full bg-white/95 blur-[2.4px] transition-all ease-[cubic-bezier(0.18,0.9,0.2,1.02)]',
              moveDirection === 'right' ? '-right-2' : '-left-2',
              isMoving ? 'opacity-100 scale-100' : 'opacity-0 scale-75',
            )}
            style={{
              transitionDuration: `${MOTION_DURATION_MS}ms`,
            }}
          />
          <span
            className={cn(
              'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-ran-ice/95 blur-[1.2px] transition-all ease-[cubic-bezier(0.18,0.9,0.2,1.02)]',
              moveDirection === 'right' ? '-left-1.5' : '-right-1.5',
              isMoving ? 'opacity-95 scale-100' : 'opacity-0 scale-75',
            )}
            style={{
              transitionDuration: `${MOTION_DURATION_MS}ms`,
            }}
          />
        </div>

        {items.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            className={({ isActive }) => cn(
              'relative z-10 inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-300',
              isActive
                ? 'text-ran-navy drop-shadow-[0_1px_0_rgba(255,255,255,0.95)]'
                : 'text-ran-slate/90 hover:bg-ran-ice/75 hover:text-ran-navy',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
