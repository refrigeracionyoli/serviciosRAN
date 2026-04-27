import { beforeEach, describe, expect, it } from 'vitest'
import {
  addPendingLocalEvidencia,
  buildCacheKey,
  clearOfflineState,
  createLocalNumberId,
  createOfflineId,
  getCachedClientesSnapshot,
  getCachedEvidenciasByServicio,
  getCachedInventarioSnapshot,
  getCachedInventarioTecnicoSnapshot,
  getCachedMaquinasSnapshot,
  getCachedMantenimientoRefaccionesSnapshot,
  getCachedMantenimientosSnapshot,
  getCachedProfilesByRole,
  getCachedServicioDetalleSnapshot,
  getCachedServicioRefaccionesSnapshot,
  getCachedServiciosSnapshot,
  getLinkedRemoteId,
  getLocalAttachmentUrl,
  isLocalNumberId,
  parseLocalAttachmentId,
  replaceCachedEvidenciasForServicio,
  toLocalAttachmentKey,
  upsertCachedClientes,
  upsertCachedEvidencias,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedMaquinas,
  upsertCachedMantenimientos,
  upsertCachedProfiles,
  upsertCachedServicio,
  upsertCachedServicioRefacciones,
  upsertCachedServicios,
  upsertEntityLink,
} from '@/lib/offline/cache'
import {
  OWNER_ID,
  TECNICO_ID,
  buildCliente,
  buildEvidencia,
  buildInventarioItem,
  buildInventarioTecnico,
  buildMaquina,
  buildMantenimiento,
  buildProfile,
  buildServicio,
} from '../fixtures/domain'

describe('offline cache', () => {
  beforeEach(async () => {
    await clearOfflineState()
  })

  it('builds scoped local identifiers and resolves entity links', async () => {
    const offlineId = createOfflineId('cmd')
    const localNumberId = createLocalNumberId()

    expect(buildCacheKey(OWNER_ID, 30)).toBe(`${OWNER_ID}:30`)
    expect(offlineId).toMatch(/^cmd:/)
    expect(isLocalNumberId(localNumberId)).toBe(true)
    expect(isLocalNumberId(30)).toBe(false)

    await upsertEntityLink(OWNER_ID, 'servicio', localNumberId, 30)

    expect(await getLinkedRemoteId(OWNER_ID, 'servicio', String(localNumberId))).toBe('30')
  })

  it('stores and filters profiles, clientes, maquinas, and inventory catalog snapshots', async () => {
    await upsertCachedProfiles(OWNER_ID, [
      buildProfile({ id: TECNICO_ID, role: 'tecnico', activo: true }),
      buildProfile({ id: '33333333-3333-4333-8333-333333333333', role: 'admin', activo: true }),
      buildProfile({ id: '44444444-4444-4444-8444-444444444444', role: 'tecnico', activo: false }),
    ])
    await upsertCachedClientes(OWNER_ID, [
      buildCliente({ id: 10, activo: true, nombre: 'Cliente activo' }),
      buildCliente({ id: 11, activo: false, nombre: 'Cliente inactivo' }),
    ])
    await upsertCachedMaquinas(OWNER_ID, [
      buildMaquina({ id: 20, cliente_id: 10, activo: true, serie: 'A' }),
      buildMaquina({ id: 21, cliente_id: 11, activo: true, serie: 'B' }),
      buildMaquina({ id: 22, cliente_id: 10, activo: false, serie: 'C' }),
    ])
    await upsertCachedInventario(OWNER_ID, [
      buildInventarioItem({ id: 50, nombre: 'Activo', activo: true }),
      buildInventarioItem({ id: 51, nombre: 'Inactivo', activo: false }),
    ])

    expect(await getCachedProfilesByRole(OWNER_ID, ['tecnico'])).toHaveLength(1)
    expect(await getCachedProfilesByRole(OWNER_ID, ['admin', 'tecnico'], true)).toHaveLength(3)
    expect(await getCachedClientesSnapshot(OWNER_ID)).toHaveLength(1)
    expect(await getCachedClientesSnapshot(OWNER_ID, true)).toHaveLength(2)
    expect(await getCachedMaquinasSnapshot(OWNER_ID, { clienteId: 10 })).toHaveLength(1)
    expect(await getCachedMaquinasSnapshot(OWNER_ID, { clienteId: 10, includeInactive: true })).toHaveLength(2)
    expect(await getCachedInventarioSnapshot(OWNER_ID)).toHaveLength(1)
    expect(await getCachedInventarioSnapshot(OWNER_ID, true)).toHaveLength(2)
  })

  it('stores technician inventory as active rows or history depending on query options', async () => {
    await upsertCachedInventarioTecnico(OWNER_ID, [
      buildInventarioTecnico({ id: 70, fecha: '2026-04-26', cantidad: 2, devuelto_at: null }),
      buildInventarioTecnico({ id: 71, fecha: '2026-04-26', cantidad: 0, devuelto_at: null }),
      buildInventarioTecnico({ id: 72, fecha: '2026-04-25', cantidad: 4, devuelto_at: '2026-04-26T01:00:00.000Z' }),
    ])

    expect(await getCachedInventarioTecnicoSnapshot(OWNER_ID, {
      fecha: '2026-04-26',
      tecnicoId: TECNICO_ID,
    })).toHaveLength(1)

    expect(await getCachedInventarioTecnicoSnapshot(OWNER_ID, {
      fecha: '2026-04-26',
      tecnicoId: TECNICO_ID,
      includeZeroQuantity: true,
    })).toHaveLength(2)

    expect(await getCachedInventarioTecnicoSnapshot(OWNER_ID, {
      fecha: '2026-04-25',
      tecnicoId: TECNICO_ID,
      includeReturned: true,
    })).toHaveLength(1)
  })

  it('stores service, maintenance, refacciones, and evidence snapshots with source boundaries', async () => {
    await upsertCachedServicios(OWNER_ID, [
      buildServicio({ id: 30, status: 'en_ruta', fecha_servicio: '2026-04-26', tecnico_id: TECNICO_ID }),
      buildServicio({ id: 31, status: 'pendiente', fecha_servicio: '2026-04-27', tecnico_id: null }),
    ])
    await upsertCachedServicio(OWNER_ID, buildServicio({ id: 32, status: 'completado' }))
    await upsertCachedMantenimientos(OWNER_ID, [
      buildMantenimiento({ id: 100, poliza_id: 90, status: 'pendiente' }),
      buildMantenimiento({ id: 101, poliza_id: 91, status: 'realizado' }),
    ])

    await upsertCachedServicioRefacciones(OWNER_ID, {
      serviceId: 30,
      items: [
        { inventario_id: 50, nombre_refaccion: 'Filtro', cantidad: 1, precio_unitario: 100, inventory_source: 'general' },
        { inventario_id: 51, nombre_refaccion: 'Bomba', cantidad: 1, precio_unitario: 200, inventory_source: 'tecnico' },
      ],
    })
    await upsertCachedServicioRefacciones(OWNER_ID, {
      mantenimientoId: 100,
      items: [
        { inventario_id: 50, nombre_refaccion: 'Filtro', cantidad: 2, precio_unitario: 100, inventory_source: 'tecnico' },
      ],
    })

    await replaceCachedEvidenciasForServicio(OWNER_ID, 30, [
      buildEvidencia({ id: 40, filename: 'foto.jpg' }),
      buildEvidencia({ id: 41, filename: 'orden-servicio__1__firmada.jpg' }),
    ])

    expect(await getCachedServiciosSnapshot(OWNER_ID, { status: 'en_ruta', tecnicoId: TECNICO_ID, fechaDesde: '2026-04-26', fechaHasta: '2026-04-26' })).toHaveLength(1)
    expect(await getCachedServiciosSnapshot(OWNER_ID, { search: 'Six Centro' })).toHaveLength(3)
    expect(await getCachedServicioDetalleSnapshot(OWNER_ID, 32)).toMatchObject({ id: 32, status: 'completado' })
    expect(await getCachedMantenimientosSnapshot(OWNER_ID, 90)).toHaveLength(1)
    expect(await getCachedServicioRefaccionesSnapshot(OWNER_ID, 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nombre_refaccion: 'Filtro', inventory_source: 'general' }),
      expect.objectContaining({ nombre_refaccion: 'Bomba', inventory_source: 'tecnico' }),
    ]))
    expect(await getCachedMantenimientoRefaccionesSnapshot(OWNER_ID, 100)).toEqual([
      expect.objectContaining({ nombre_refaccion: 'Filtro', inventory_source: 'tecnico' }),
    ])
    expect(await getCachedEvidenciasByServicio(OWNER_ID, 30)).toHaveLength(2)
  })

  it('tracks pending local evidence attachments and local URL keys', async () => {
    const pending = await addPendingLocalEvidencia(OWNER_ID, {
      servicioId: 30,
      attachmentId: 'att_1',
      commandId: 'cmd_1',
      filename: 'foto-local.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 123,
      subidaPor: TECNICO_ID,
    })

    expect(pending.id).toBeLessThan(0)
    expect(toLocalAttachmentKey('att_1')).toBe('local-attachment:att_1')
    expect(parseLocalAttachmentId('local-attachment:att_1')).toBe('att_1')
    expect(await getCachedEvidenciasByServicio(OWNER_ID, 30)).toEqual([
      expect.objectContaining({ filename: 'foto-local.jpg', syncStatus: 'pending' }),
    ])
    await expect(getLocalAttachmentUrl(OWNER_ID, 'local-attachment://missing')).resolves.toBeNull()
  })
})
