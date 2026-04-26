import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { PolizaForm } from '@/components/forms/PolizaForm'
import { useCrearPolizaMutation } from '@/hooks/use-polizas'
import { useToast } from '@/hooks/use-toast'
import type { CrearPolizaInput } from '@/schemas/poliza.schema'

export function PolizaNuevaPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { mutate: crearPoliza, isPending } = useCrearPolizaMutation()

  const handleSubmit = (data: CrearPolizaInput) => {
    crearPoliza(data, {
      onSuccess: () => {
        toast({
          title: 'Póliza creada',
          description: 'El establecimiento quedó registrado en póliza.',
        })
        navigate('/polizas')
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'No se pudo crear la póliza.'
        toast({
          title: 'Error al crear póliza',
          description: message,
          variant: 'destructive',
        })
      },
    })
  }

  return (
    <div className="p-5 lg:p-7">
      <AdminBreadcrumbs items={['Pólizas', 'Nueva póliza']} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Nuevo establecimiento en póliza</h1>
            <p className="mt-1 text-lg text-ran-slate">Registra la sucursal y asigna su máquina para activar la póliza.</p>
          </div>
        </div>

        <Button
          type="submit"
          form="nueva-poliza-form"
          disabled={isPending}
          className="h-11 rounded-xl bg-ran-navy px-8 text-base font-semibold hover:bg-ran-navy/90"
        >
          {isPending ? 'Guardando...' : 'Guardar póliza'}
        </Button>
      </div>

      <PolizaForm
        formId="nueva-poliza-form"
        showSubmitButton={false}
        onSubmit={handleSubmit}
        isLoading={isPending}
      />
    </div>
  )
}
