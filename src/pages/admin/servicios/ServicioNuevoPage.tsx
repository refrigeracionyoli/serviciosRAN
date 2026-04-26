import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ServicioForm } from '@/components/forms/ServicioForm'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { useCrearServicioMutation } from '@/hooks/use-servicios'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { CrearServicioInput } from '@/schemas/servicio.schema'

const SERVICIO_DRAFT_KEY = 'ran.servicio-nuevo.draft'

interface ServicioNuevoLocationState {
  source?: 'cliente-nuevo'
  selectedClienteId?: number
}

export function ServicioNuevoPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mutate: crearServicio, isPending } = useCrearServicioMutation()
  const locationState = (location.state as ServicioNuevoLocationState | null) ?? null
  const selectedClienteIdFromReturn = typeof locationState?.selectedClienteId === 'number'
    ? locationState.selectedClienteId
    : undefined

  const [draftValues] = useState<Partial<CrearServicioInput> | undefined>(() => {
    let parsedDraft: Partial<CrearServicioInput> | undefined

    try {
      const raw = localStorage.getItem(SERVICIO_DRAFT_KEY)
      if (raw) {
        parsedDraft = JSON.parse(raw) as Partial<CrearServicioInput>
      }
    } catch {
      parsedDraft = undefined
    }

    if (typeof selectedClienteIdFromReturn === 'number') {
      return {
        ...parsedDraft,
        cliente_id: selectedClienteIdFromReturn,
        maquina_id: undefined,
      }
    }

    return parsedDraft
  })

  const handleDraftChange = (draft: Partial<CrearServicioInput> | null) => {
    try {
      if (!draft) {
        localStorage.removeItem(SERVICIO_DRAFT_KEY)
        return
      }

      localStorage.setItem(SERVICIO_DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Ignora errores de quota/privacidad sin romper el flujo de captura.
    }
  }

  return (
    <div className="p-5 lg:p-7">
      <AdminBreadcrumbs items={['Servicios', 'Nuevo servicio']} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Nuevo servicio</h1>
            <p className="mt-1 text-lg text-ran-slate">Complete la información del servicio</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <span className="inline-flex h-10 items-center rounded-xl bg-amber-100 px-4 text-base font-semibold text-amber-700">
            Pendiente
          </span>
          <Button
            type="submit"
            form="nuevo-servicio-form"
            disabled={isPending}
            className="h-11 rounded-xl bg-ran-navy px-8 text-base font-semibold hover:bg-ran-navy/90"
          >
            {isPending ? 'Guardando...' : 'Guardar servicio'}
          </Button>
        </div>
      </div>

      <div>
        <ServicioForm
          defaultValues={draftValues}
          formId="nuevo-servicio-form"
          showSubmitButton={false}
          isLoading={isPending}
          onDraftChange={handleDraftChange}
          onCreateClienteRequest={(draft) => {
            handleDraftChange(draft)
            navigate('/catalogos/clientes/nuevo', {
              state: {
                source: 'servicio-nuevo',
                returnTo: '/servicios/nuevo',
              },
            })
          }}
          onSubmit={(data) => {
            crearServicio(data, {
              onSuccess: (servicio) => {
                localStorage.removeItem(SERVICIO_DRAFT_KEY)
                navigate(`/servicios/${servicio.id}`)
              },
            })
          }}
        />
      </div>
    </div>
  )
}
