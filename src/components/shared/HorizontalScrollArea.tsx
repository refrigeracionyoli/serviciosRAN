import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface HorizontalScrollAreaProps {
  children: ReactNode
  className?: string
  viewportClassName?: string
}

interface ScrollState {
  canScrollLeft: boolean
  canScrollRight: boolean
  isOverflowing: boolean
  progress: number
}

const INITIAL_SCROLL_STATE: ScrollState = {
  canScrollLeft: false,
  canScrollRight: false,
  isOverflowing: false,
  progress: 0,
}

function getPrefersReducedMotion() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function isInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(
    target.closest(
      'a, button, input, textarea, select, [role="button"], [role="menuitem"], [data-no-drag-scroll]',
    ),
  )
}

export function HorizontalScrollArea({
  children,
  className,
  viewportClassName,
}: HorizontalScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({
    active: false,
    dragged: false,
    pointerId: 0,
    startX: 0,
    scrollLeft: 0,
  })
  const suppressClickRef = useRef(false)
  const [scrollState, setScrollState] = useState<ScrollState>(INITIAL_SCROLL_STATE)
  const [isDragging, setIsDragging] = useState(false)

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const scrollLeft = Math.min(Math.max(0, viewport.scrollLeft), maxScrollLeft)
    const nextState: ScrollState = {
      isOverflowing: maxScrollLeft > 2,
      canScrollLeft: scrollLeft > 2,
      canScrollRight: scrollLeft < maxScrollLeft - 2,
      progress: maxScrollLeft > 0 ? scrollLeft / maxScrollLeft : 0,
    }

    setScrollState((current) => (
      current.isOverflowing === nextState.isOverflowing
      && current.canScrollLeft === nextState.canScrollLeft
      && current.canScrollRight === nextState.canScrollRight
      && Math.abs(current.progress - nextState.progress) < 0.01
        ? current
        : nextState
    ))
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    updateScrollState()
    const handleScroll = () => updateScrollState()
    viewport.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(viewport)
    Array.from(viewport.children).forEach((child) => resizeObserver.observe(child))

    window.addEventListener('resize', updateScrollState)

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateScrollState)
    }
  }, [updateScrollState])

  const scrollByPage = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    if (!viewport) return

    viewport.scrollBy({
      left: direction * Math.max(240, viewport.clientWidth * 0.82),
      behavior: getPrefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport || !scrollState.isOverflowing || event.button !== 0 || isInteractiveElement(event.target)) {
      return
    }

    dragRef.current = {
      active: true,
      dragged: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: viewport.scrollLeft,
    }
    viewport.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const drag = dragRef.current
    if (!viewport || !drag.active || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    drag.dragged = drag.dragged || Math.abs(event.clientX - drag.startX) > 6
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX)
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const drag = dragRef.current
    if (!viewport || !drag.active || drag.pointerId !== event.pointerId) return

    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId)
    }
    suppressClickRef.current = drag.dragged
    if (drag.dragged) {
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    dragRef.current.active = false
    dragRef.current.dragged = false
    setIsDragging(false)
  }

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return

    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className={cn('relative', className)}>
      {scrollState.isOverflowing && (
        <div className="mb-2 flex items-center justify-end gap-2 px-2 pt-2">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-ran-navy transition-[width] duration-200"
              style={{ width: `${Math.max(12, scrollState.progress * 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-white/95"
                  onClick={() => scrollByPage(-1)}
                  disabled={!scrollState.canScrollLeft}
                  aria-label="Desplazar tabla a la izquierda"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Desplazar a la izquierda</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-white/95"
                  onClick={() => scrollByPage(1)}
                  disabled={!scrollState.canScrollRight}
                  aria-label="Desplazar tabla a la derecha"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Desplazar a la derecha</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="relative">
        {scrollState.canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-white via-white/85 to-transparent" />
        )}
        {scrollState.canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-white via-white/85 to-transparent" />
        )}
        <div
          ref={viewportRef}
          className={cn(
            'overflow-x-auto overscroll-x-contain touch-pan-x',
            scrollState.isOverflowing && (isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'),
            viewportClassName,
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onClickCapture={handleClickCapture}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
