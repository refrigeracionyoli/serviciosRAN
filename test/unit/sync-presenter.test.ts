import { describe, expect, it } from 'vitest'
import { getSyncCommandPresentation } from '@/lib/offline/sync-presenter'
import { OWNER_ID, buildOfflineCommand } from '../fixtures/domain'
import type { OfflineCommandType } from '@/lib/offline/db'

describe('sync command presentation', () => {
  it.each([
    ['cliente.create', 'Crear cliente'],
    ['cliente.update', 'Actualizar cliente'],
    ['cliente.delete', 'Eliminar cliente'],
    ['maquina.create', 'Crear máquina'],
    ['maquina.update', 'Actualizar máquina'],
    ['profile.create', 'Crear técnico'],
    ['profile.update', 'Actualizar empleado'],
    ['profile.reset_password', 'Cambiar contraseña de empleado'],
    ['servicio.create', 'Crear servicio'],
    ['servicio.update', 'Actualizar servicio'],
    ['servicio.replace_refacciones', 'Guardar refacciones del servicio'],
    ['servicio.close', 'Cerrar servicio'],
    ['service.complete_with_refacciones', 'Completar servicio'],
    ['service.update_status', 'Actualizar estado del servicio'],
    ['service.add_evidencia', 'Subir evidencia del servicio'],
    ['service.delete_evidencia', 'Eliminar evidencia del servicio'],
    ['poliza.create', 'Crear póliza'],
    ['poliza.update', 'Actualizar póliza'],
    ['poliza.set_active', 'Desactivar póliza'],
    ['poliza.delete', 'Eliminar póliza'],
    ['poliza_pause.create', 'Pausar pólizas'],
    ['poliza_pause.resume', 'Reanudar pólizas'],
    ['mantenimiento.create', 'Crear mantenimiento de póliza'],
    ['mantenimiento.update', 'Actualizar mantenimiento de póliza'],
    ['mantenimiento.replace_refacciones', 'Guardar refacciones del mantenimiento'],
    ['inventario.create', 'Crear refacción'],
    ['inventario.update', 'Actualizar refacción'],
    ['inventario.set_active', 'Desactivar refacción'],
    ['inventario.adjust', 'Ajustar inventario'],
    ['inventario_tecnico.upsert', 'Actualizar inventario del técnico'],
    ['inventario_tecnico.delete', 'Devolver refacción al inventario general'],
    ['taller.registrar_entrada', 'Registrar entrada a taller'],
    ['taller.registrar_salida', 'Registrar salida de taller'],
    ['taller.reubicacion', 'Reubicar máquina'],
  ] satisfies Array<[OfflineCommandType, string]>)('%s maps to the current user-facing title and some detail', (type, title) => {
    const command = buildOfflineCommand({
      type,
      ownerId: OWNER_ID,
      entityType: entityTypeFor(type),
      entityId: entityIdFor(type),
      payload: payloadFor(type),
    })

    const presentation = getSyncCommandPresentation(command)
    expect(presentation.title).toBe(title)
    expect(presentation.description).toEqual(expect.any(String))
  })

  it('shows self-service profile and password changes differently from admin employee changes', () => {
    expect(getSyncCommandPresentation(buildOfflineCommand({
      ownerId: OWNER_ID,
      entityType: 'profile',
      entityId: OWNER_ID,
      type: 'profile.update',
      payload: { data: { correo: 'admin@ran.test' } },
    })).title).toBe('Actualizar perfil')

    expect(getSyncCommandPresentation(buildOfflineCommand({
      ownerId: OWNER_ID,
      entityType: 'profile',
      entityId: OWNER_ID,
      type: 'profile.reset_password',
      payload: {},
    })).title).toBe('Cambiar contraseña')
  })

  it('includes high-signal secondary details for refacciones, statuses, evidence files, and technician inventory', () => {
    expect(getSyncCommandPresentation(buildOfflineCommand({
      type: 'servicio.replace_refacciones',
      entityType: 'servicio',
      entityId: '30',
      payload: payloadFor('servicio.replace_refacciones'),
    })).description).toContain('1 refacción')

    expect(getSyncCommandPresentation(buildOfflineCommand({
      type: 'service.update_status',
      entityType: 'servicio',
      entityId: '30',
      payload: payloadFor('service.update_status'),
    })).description).toContain('Estado: completado')

    expect(getSyncCommandPresentation(buildOfflineCommand({
      type: 'service.add_evidencia',
      entityType: 'evidencia',
      entityId: '30',
      payload: payloadFor('service.add_evidencia'),
    })).description).toContain('foto.jpg')

    expect(getSyncCommandPresentation(buildOfflineCommand({
      type: 'inventario_tecnico.upsert',
      entityType: 'inventario_tecnico',
      entityId: '50',
      payload: payloadFor('inventario_tecnico.upsert'),
    })).description).toContain('2 pieza(s) · 2026-04-26')
  })
})

function entityTypeFor(type: OfflineCommandType): string {
  if (type.startsWith('cliente.')) return 'cliente'
  if (type.startsWith('maquina.')) return 'maquina'
  if (type.startsWith('profile.')) return 'profile'
  if (type.startsWith('servicio.') || type.startsWith('service.')) return type.includes('evidencia') ? 'evidencia' : 'servicio'
  if (type.startsWith('poliza_pause.')) return 'poliza_pausa'
  if (type.startsWith('poliza.')) return 'poliza'
  if (type.startsWith('mantenimiento.')) return 'mantenimiento'
  if (type.startsWith('inventario_tecnico.')) return 'inventario_tecnico'
  if (type.startsWith('inventario.')) return 'inventario'
  return type === 'taller.reubicacion' ? 'maquina' : 'maquina_taller'
}

function entityIdFor(type: OfflineCommandType): string | null {
  if (type.startsWith('cliente.')) return '10'
  if (type.startsWith('maquina.')) return '20'
  if (type.startsWith('profile.')) return '22222222-2222-4222-8222-222222222222'
  if (type.startsWith('servicio.') || type.startsWith('service.')) return '30'
  if (type.startsWith('poliza_pause.')) return type === 'poliza_pause.resume' ? '5' : null
  if (type.startsWith('poliza.')) return '90'
  if (type.startsWith('mantenimiento.')) return '100'
  if (type.startsWith('inventario.')) return '50'
  if (type === 'taller.registrar_salida') return '120'
  if (type === 'taller.reubicacion') return '20'
  return null
}

function payloadFor(type: OfflineCommandType): Record<string, unknown> {
  if (type.startsWith('cliente.')) return { data: { nombre: 'Cliente offline' }, clienteId: 10 }
  if (type.startsWith('maquina.')) return { data: { serie: 'SER-001' }, maquinaId: 20 }
  if (type === 'profile.create') return { data: { correo: 'tecnico@ran.test', role: 'tecnico' } }
  if (type.startsWith('profile.')) return { data: { correo: 'tecnico@ran.test' } }
  if (type === 'servicio.create' || type === 'servicio.update') return { data: { tipo_servicio: 'MTTO RUTA' } }
  if (type === 'servicio.replace_refacciones') return { serviceId: 30, items: [{ nombre_refaccion: 'Filtro' }] }
  if (type === 'servicio.close') return { serviceId: 30 }
  if (type === 'service.complete_with_refacciones') return { serviceId: 30, items: [] }
  if (type === 'service.update_status') return { serviceId: 30, status: 'completado' }
  if (type === 'service.add_evidencia') return { serviceId: 30, filename: 'ev-foto__1__foto.jpg' }
  if (type === 'service.delete_evidencia') return { serviceId: 30 }
  if (type.startsWith('poliza_pause.')) return type === 'poliza_pause.resume' ? { pausaId: 5 } : {}
  if (type.startsWith('poliza.')) return { polizaId: 90, activa: false }
  if (type === 'mantenimiento.replace_refacciones') return { mantenimientoId: 100, items: [{ nombre_refaccion: 'Filtro' }] }
  if (type.startsWith('mantenimiento.')) return { mantenimientoId: 100 }
  if (type === 'inventario.create' || type === 'inventario.update') return { data: { nombre: 'Filtro' }, itemId: 50 }
  if (type === 'inventario.adjust') return { data: { cantidad: 5 }, itemId: 50 }
  if (type === 'inventario.set_active') return { itemId: 50, activo: false }
  if (type === 'inventario_tecnico.upsert') return { data: { inventario_id: 50, cantidad: 2, fecha: '2026-04-26' } }
  if (type === 'inventario_tecnico.delete') return { inventario_id: 50, cantidad: 2, fecha: '2026-04-26' }
  if (type.startsWith('taller.')) return { input: { orden: 9001 }, registroId: 120, maquinaId: 20 }
  return {}
}
