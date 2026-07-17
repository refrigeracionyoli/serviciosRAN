import { useEffect, useRef, useState } from 'react'
import { Loader2, Snowflake, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  progress: number
  stage: string
  detail: string
  completedServices: number
  totalServices: number
  onCancel: () => void
}

function IceMachineExportLoader() {
  return (
    <div className="ran-ice-loader" aria-hidden="true">
      <span className="ran-ice-loader__halo" />
      <span className="ran-ice-loader__cabinet">
        <span className="ran-ice-loader__window">
          <Snowflake className="ran-ice-loader__flake" />
        </span>
        <span className="ran-ice-loader__vent" />
      </span>
      <span className="ran-ice-loader__tray" />
      <span className="ran-ice-loader__cube ran-ice-loader__cube--one" />
      <span className="ran-ice-loader__cube ran-ice-loader__cube--two" />
      <span className="ran-ice-loader__cube ran-ice-loader__cube--three" />
    </div>
  )
}

export function WeeklyReportExportDialog({
  open,
  progress,
  stage,
  detail,
  completedServices,
  totalServices,
  onCancel,
}: Props) {
  const targetProgress = Math.max(2, Math.min(100, progress))
  const hasServiceProgress = totalServices > 0
  const [displayProgress, setDisplayProgress] = useState(targetProgress)
  const [isCancelling, setIsCancelling] = useState(false)
  const animationFrameRef = useRef<number | null>(null)
  const displayProgressRef = useRef(targetProgress)

  useEffect(() => {
    displayProgressRef.current = displayProgress
  }, [displayProgress])

  useEffect(() => {
    if (!open) {
      setIsCancelling(false)
    }
  }, [open])

  useEffect(() => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (!open) {
      displayProgressRef.current = targetProgress
      setDisplayProgress(targetProgress)
      return
    }

    const from = displayProgressRef.current
    const delta = targetProgress - from
    if (Math.abs(delta) < 0.2) {
      displayProgressRef.current = targetProgress
      setDisplayProgress(targetProgress)
      return
    }

    const duration = Math.min(520, Math.max(180, Math.abs(delta) * 12))
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration)
      const eased = 1 - ((1 - elapsed) ** 2)
      const nextValue = from + (delta * eased)

      displayProgressRef.current = nextValue
      setDisplayProgress(nextValue)

      if (elapsed < 1) {
        animationFrameRef.current = requestAnimationFrame(tick)
      } else {
        animationFrameRef.current = null
      }
    }

    animationFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [open, targetProgress])

  const handleCancelClick = () => {
    if (isCancelling) return
    setIsCancelling(true)
    onCancel()
  }

  const progressWidth = Math.max(2, Math.min(100, displayProgress))
  const progressLabel = `${Math.round(progressWidth)}%`
  const counterLabel = hasServiceProgress
    ? `${completedServices} / ${totalServices} archivos`
    : 'Preparando archivos…'

  const statusTitle = isCancelling ? 'Cancelando descarga…' : stage
  const statusDetail = isCancelling
    ? 'Espera unos segundos mientras detenemos el proceso.'
    : detail

  return (
    <Dialog open={open}>
      <DialogContent
        className="overflow-hidden rounded-2xl border border-ran-ice bg-white p-0 shadow-[0_22px_60px_rgba(15,23,42,0.18)] sm:max-w-[460px] [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="relative">
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={isCancelling}
            className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-ran-slate transition hover:bg-ran-ice hover:text-ran-navy disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Cancelar descarga"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="px-6 pb-6 pt-7 sm:px-7 sm:pb-7">
            <div className="flex items-start gap-3">
              <div
                className={`ran-export-loader-shell flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  isCancelling ? 'text-ran-navy' : 'ran-export-icon-pulse'
                }`}
                aria-hidden="true"
              >
                {isCancelling ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <IceMachineExportLoader />
                )}
              </div>
              <div className="min-w-0 flex-1 pr-8">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ran-slate">
                  Reporte semanal
                </p>
                <DialogTitle className="mt-1 text-base font-bold leading-snug text-ran-navy">
                  {statusTitle}
                </DialogTitle>
              </div>
            </div>

            {statusDetail ? (
              <p className="mt-3 text-[13px] leading-5 text-ran-slate">
                {statusDetail}
              </p>
            ) : null}

            <div className="mt-5">
              <div className="ran-export-track" aria-hidden="true">
                <div
                  className="ran-export-track__fill"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
                <span className="text-ran-slate">{counterLabel}</span>
                <span className="tabular-nums text-ran-navy">{progressLabel}</span>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelClick}
                disabled={isCancelling}
                className="h-9 cursor-pointer rounded-lg border-ran-ice px-4 text-[13px] font-semibold text-ran-navy hover:bg-ran-ice hover:text-ran-navy disabled:cursor-not-allowed"
              >
                {isCancelling ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cancelando…
                  </span>
                ) : (
                  'Cancelar'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
