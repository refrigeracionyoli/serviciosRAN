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

    const { semana, fechaInicio, fechaFin, statuses } = await req.json()

    if (!semana || !fechaInicio || !fechaFin) {
      return new Response(
        JSON.stringify({ error: 'semana, fechaInicio y fechaFin son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const allowedStatuses = ['completado', 'cerrado'] as const
    const requestedStatuses = Array.isArray(statuses)
      ? statuses.filter((status) => allowedStatuses.includes(status))
      : []

    const statusesToUse = requestedStatuses.length > 0 ? requestedStatuses : [...allowedStatuses]

    // Obtener servicios del período
    const { data: servicios, error } = await supabase
      .from('servicios')
      .select(`
        *,
        cliente:clientes(*),
        maquina:maquinas(*),
        tecnico:profiles(id, nombre),
        refacciones:servicio_refacciones(*),
        cierre:cierres(*)
      `)
      .in('status', statusesToUse)
      .gte('fecha_servicio', fechaInicio)
      .lte('fecha_servicio', fechaFin)

    if (error) throw error

    // Obtener plantilla de Storage
    const { data: templateData } = await supabase.storage
      .from('templates')
      .download('FORMATO_SEMANAL_2026.xlsx')

    if (!templateData) {
      // Si no hay plantilla, generar Excel básico con ExcelJS
      // TODO: Instalar ExcelJS via esm.sh cuando se despliegue
      return new Response(
        JSON.stringify({
          error: 'Plantilla FORMATO_SEMANAL_2026.xlsx no encontrada en Storage',
          hint: 'Sube la plantilla al bucket "templates" en Supabase Storage',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Aquí iría el procesamiento con ExcelJS:
    // const workbook = new ExcelJS.Workbook()
    // await workbook.xlsx.load(await templateData.arrayBuffer())
    // const sheet = workbook.getWorksheet('Registro Ordenes')
    // Inyectar datos por celda...
    // const buffer = await workbook.xlsx.writeBuffer()

    // Por ahora retornar los datos en JSON para pruebas
    return new Response(
      JSON.stringify({
        semana,
        periodo: { inicio: fechaInicio, fin: fechaFin },
        statuses: statusesToUse,
        totalServicios: servicios?.length ?? 0,
        proveedor: '4010269',
        gz: 'NUEVO LEON',
        servicios: servicios?.map((s) => ({
          orden: s.orden,
          aviso: s.aviso,
          cliente: s.cliente?.nombre,
          equipo: s.maquina?.modelo,
          serie: s.maquina?.serie,
          tipo: s.tipo_servicio,
          fecha: s.fecha_servicio,
          costoServicio: s.costo_mano_obra,
          refacciones: s.costo_refacciones,
          total: s.total,
        })),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // En producción: 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          // 'Content-Disposition': `attachment; filename="reporte-${semana}.xlsx"`
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
