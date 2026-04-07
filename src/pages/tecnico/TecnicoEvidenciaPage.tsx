import { useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Camera, ArrowLeft, ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useEvidenciasQuery, useSubirEvidenciaMutation } from '@/hooks/use-evidencias'
import { useServicioDetalleQuery } from '@/hooks/use-servicios'

export function TecnicoEvidenciaPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: servicio } = useServicioDetalleQuery(servicioId)
  const { data: evidencias = [], isLoading } = useEvidenciasQuery(servicioId)
  const { mutate: subirEvidencia, isPending: subiendo } = useSubirEvidenciaMutation(servicioId)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach((file) => subirEvidencia(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5 text-ran-slate" />
        </button>
        <div>
          <h2 className="font-bold text-ran-navy">Evidencia fotográfica</h2>
          <p className="text-xs text-ran-slate">{servicio?.cliente?.nombre ?? `Servicio #${servicioId}`}</p>
        </div>
      </div>

      {/* Galería */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {evidencias.map((ev) => (
            <div key={ev.id} className="aspect-square rounded-lg bg-ran-ice flex items-center justify-center overflow-hidden">
              <Camera className="h-8 w-8 text-ran-slate/40" />
            </div>
          ))}

          {/* Botón agregar */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={subiendo}
            className="aspect-square rounded-lg border-2 border-dashed border-ran-slate/30 flex flex-col items-center justify-center gap-2 text-ran-slate hover:border-ran-navy hover:text-ran-navy transition-colors disabled:opacity-50"
          >
            {subiendo ? (
              <LoadingSpinner size="sm" />
            ) : (
              <>
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs font-medium">Agregar foto</span>
              </>
            )}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <p className="text-xs text-ran-slate text-center">
        Las fotos se comprimen automáticamente antes de subirse (máx. 1MB)
      </p>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => navigate(-1)}
      >
        Listo
      </Button>
    </div>
  )
}
