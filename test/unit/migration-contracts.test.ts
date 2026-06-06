import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readMigrations(): string {
  return fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => read(`supabase/migrations/${file}`))
    .join('\n')
}

describe('database and edge-function contracts', () => {
  const initialSchema = read('supabase/migrations/001_initial_schema.sql')
  const allMigrations = readMigrations()

  it('keeps every core business table in the initial schema', () => {
    for (const table of [
      'profiles',
      'clientes',
      'maquinas',
      'polizas',
      'servicios',
      'cierres',
      'mantenimientos_poliza',
      'inventario',
      'servicio_refacciones',
      'inventario_tecnico',
      'movimientos_inventario',
      'maquinas_en_taller',
      'evidencias',
      'catalogo_pep',
    ]) {
      expect(initialSchema).toContain(`create table ${table}`)
    }
  })

  it('enforces role-based RLS policies for admin and technician boundaries', () => {
    const rls = read('supabase/migrations/002_rls_policies.sql') + read('supabase/migrations/014_rls_least_privilege_tecnicos.sql')

    expect(rls).toContain('alter table servicios enable row level security')
    expect(rls).toContain('Admin: acceso total a servicios')
    expect(rls).toContain('Técnico: ve solo sus servicios')
    expect(rls).toContain('Técnico: actualiza solo sus servicios (no puede cerrar)')
    expect(rls).toContain('Tecnico: lee clientes relacionados')
    expect(rls).toContain('Tecnico: lee maquinas relacionadas')
    expect(rls).toContain('Tecnico: lee polizas asignadas')
  })

  it('preserves refaccion source separation and automatic inventory movements', () => {
    expect(allMigrations).toContain('servicio_refacciones_inventory_source_check')
    expect(allMigrations).toContain("check (inventory_source in ('general', 'tecnico'))")
    expect(allMigrations).toContain('create trigger trg_servicio_refacciones_sync_inventario')
    expect(allMigrations).toContain('sync_inventario_from_servicio_refacciones')
    expect(allMigrations).toContain('instalacion_refaccion')
    expect(allMigrations).toContain('correccion_instalacion')
    expect(allMigrations).toContain('replace_servicio_refacciones_tecnico')
    expect(allMigrations).toContain('servicio_refacciones_tecnico_unique')
  })

  it('deletes services through an admin RPC that cleans references and restores inventory', () => {
    expect(allMigrations).toContain('delete_servicio_completo')
    expect(allMigrations).toContain('p_dry_run boolean default false')
    expect(allMigrations).toContain("coalesce(v_actor_role, '') <> 'admin'")
    expect(allMigrations).toContain('update public.maquinas_en_taller')
    expect(allMigrations).toContain('update public.maquinas_taller_movimientos')
    expect(allMigrations).toContain('delete from public.cierres')
    expect(allMigrations).toContain('delete from public.evidencias')
    expect(allMigrations).toContain('delete from public.servicio_refacciones')
    expect(allMigrations).toContain("coalesce(servicio_refacciones.inventory_source, 'general') = 'tecnico'")
    expect(allMigrations).toContain("'devolucion_tecnico'")
    expect(allMigrations).toContain('grant execute on function public.delete_servicio_completo(bigint, boolean) to authenticated')
  })

  it('keeps installation and retiro machine lifecycle attached to service completion boundary', () => {
    const lifecycle = read('supabase/migrations/024_retiro_detaches_machine_from_cliente.sql')

    expect(lifecycle).toContain("if new.status not in ('completado', 'cerrado') then")
    expect(lifecycle).toContain("if v_tipo like '%RETIRO%' then")
    expect(lifecycle).toContain('cliente_id = null')
    expect(lifecycle).toContain("if v_tipo like '%INSTALACION%' then")
    expect(lifecycle).toContain("status = 'operando'")
    expect(lifecycle).toContain('fecha_instalacion = coalesce(new.fecha_servicio, fecha_instalacion)')
  })

  it('repairs missing workshop lifecycle movement when completed services are closed', () => {
    const lifecycleRepair = read('supabase/migrations/032_repair_terminal_workshop_lifecycle.sql')

    expect(lifecycleRepair).toContain("old.status = 'completado' and new.status = 'cerrado'")
    expect(lifecycleRepair).toContain("and accion = 'entrada'")
    expect(lifecycleRepair).toContain("and motivo = 'retiro'")
    expect(lifecycleRepair).toContain("and accion = 'salida'")
    expect(lifecycleRepair).toContain("and motivo = 'instalacion'")
    expect(lifecycleRepair).toContain('if v_existing_mov is not null then')
    expect(lifecycleRepair).toContain("status = 'operando'")
    expect(lifecycleRepair).toContain("status = 'en_taller'")
  })

  it('publishes all realtime tables used by query invalidation hooks', () => {
    for (const table of [
      'servicios',
      'evidencias',
      'inventario',
      'inventario_tecnico',
      'movimientos_inventario',
      'servicio_refacciones',
      'clientes',
      'maquinas',
      'profiles',
      'polizas',
      'mantenimientos_poliza',
      'cierres',
      'maquinas_en_taller',
      'maquinas_taller_movimientos',
      'poliza_pausas',
    ]) {
      expect(allMigrations).toContain(table)
      expect(allMigrations).toMatch(new RegExp(`supabase_realtime add table public\\.${table}|target_table.*${table}`, 's'))
    }
  })

  it('protects privileged edge functions with role checks and required secrets', () => {
    const createEmployee = read('supabase/functions/admin-create-tecnico/index.ts')
    const resetPassword = read('supabase/functions/admin-reset-empleado-password/index.ts')
    const deleteServicio = read('supabase/functions/admin-delete-servicio/index.ts')
    const r2Upload = read('supabase/functions/r2-upload/index.ts')
    const r2Delete = read('supabase/functions/r2-delete/index.ts')
    const r2Get = read('supabase/functions/r2-presigned-get/index.ts')

    expect(createEmployee).toContain("await requireRole(req, 'admin')")
    expect(createEmployee).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(resetPassword).toContain("await requireRole(req, 'admin')")
    expect(deleteServicio).toContain("await requireRole(req, 'admin')")
    expect(deleteServicio).toContain('deleteServicioInDatabase(servicioId, token, true)')
    expect(deleteServicio).toContain('delete_servicio_completo')
    expect(r2Upload).toContain("await requireAnyRole(req, ['admin', 'tecnico'])")
    expect(r2Upload).toContain('ensureServicioAccess')
    expect(r2Delete).toContain("await requireAnyRole(req, ['admin', 'tecnico'])")
    expect(r2Get).toContain("await requireAnyRole(req, ['admin', 'tecnico'])")
    for (const source of [r2Upload, r2Delete, r2Get]) {
      expect(source).toContain('R2_ACCOUNT_ID')
      expect(source).toContain('R2_ACCESS_KEY_ID')
      expect(source).toContain('R2_SECRET_ACCESS_KEY')
    }
  })
})
