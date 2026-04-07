import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { requireRole } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    await requireRole(req, 'admin')

    const { servicioId } = await req.json()
    if (!servicioId) {
      return new Response(
        JSON.stringify({ error: 'servicioId es requerido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Obtener servicio con todo
    const { data: servicio, error: svcError } = await supabase
      .from('servicios')
      .select(`
        *,
        cliente:clientes(*),
        maquina:maquinas(*),
        tecnico:profiles(id, nombre),
        refacciones:servicio_refacciones(*),
        cierre:cierres(*),
        evidencias:evidencias(*)
      `)
      .eq('id', servicioId)
      .single()

    if (svcError || !servicio) {
      return new Response(
        JSON.stringify({ error: 'Servicio no encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Obtener plantilla
    const { data: templateData } = await supabase.storage
      .from('templates')
      .download('Formato_evidencias_OS_.xlsx')

    if (!templateData) {
      return new Response(
        JSON.stringify({
          error: 'Plantilla Formato_evidencias_OS_.xlsx no encontrada en Storage',
          hint: 'Sube la plantilla al bucket "templates" en Supabase Storage',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // TODO: Implementar con ExcelJS
    // 1. Leer plantilla
    // 2. Hoja 1 (Carátula): número de orden, tabla de componentes, suma total
    // 3. Hoja 3-4 (Evidencia): descargar fotos de R2, incrustar en celdas (2x2)
    // 4. Retornar blob xlsx

    // Por ahora retornar metadata
    return new Response(
      JSON.stringify({
        servicioId,
        orden: servicio.orden,
        cliente: servicio.cliente?.nombre,
        maquina: `${servicio.maquina?.serie} ${servicio.maquina?.modelo}`,
        totalFotos: servicio.evidencias?.length ?? 0,
        refacciones: servicio.refacciones?.length ?? 0,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
