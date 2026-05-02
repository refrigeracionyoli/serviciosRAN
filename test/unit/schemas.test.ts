import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cierreSchema, crearClienteSchema, crearMaquinaSchema } from '@/schemas/cliente.schema'
import { ajusteInventarioSchema, crearItemInventarioSchema, inventarioTecnicoSchema, refaccionSchema } from '@/schemas/inventario.schema'
import { crearMantenimientoSchema, editarMantenimientoSchema } from '@/schemas/mantenimiento.schema'
import { crearPolizaSchema } from '@/schemas/poliza.schema'
import { crearServicioSchema, editarServicioSchema } from '@/schemas/servicio.schema'
import { crearTecnicoSchema } from '@/schemas/tecnico.schema'
import { TECNICO_ID } from '../fixtures/domain'

describe('domain schemas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-26T12:00:00-06:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates client catalog data and normalizes optional contact fields', () => {
    const result = crearClienteSchema.parse({
      codigo_cliente: '00123',
      nombre: 'Six Centro',
      direccion: 'Av. Principal',
      municipio: 'Monterrey',
      telefono: '',
      correo_contacto: '',
      activo: true,
    })

    expect(result.telefono).toBeNull()
    expect(result.correo_contacto).toBeNull()
    expect(crearClienteSchema.safeParse({ codigo_cliente: '0', nombre: 'Six' }).success).toBe(false)
    expect(crearClienteSchema.safeParse({ codigo_cliente: 'ABC', nombre: 'Six' }).success).toBe(false)
  })

  it('validates machine records with nullable ownership for workshop or pending installation state', () => {
    expect(crearMaquinaSchema.parse({
      serie: 'SER-001',
      modelo: 'KM901',
      cliente_id: null,
      fecha_instalacion: null,
      status: 'en_taller',
      observaciones: '',
      activo: true,
    })).toMatchObject({ serie: 'SER-001', cliente_id: null, status: 'en_taller' })

    expect(crearMaquinaSchema.safeParse({ serie: '', modelo: 'KM901' }).success).toBe(false)
    expect(crearMaquinaSchema.safeParse({ serie: 'SER-001', modelo: 'KM901', status: 'vendida' }).success).toBe(false)
  })

  it('enforces service SAP ids, required client/machine, and solicitud-before-servicio date ordering', () => {
    const valid = crearServicioSchema.parse({
      tipo_servicio: 'MTTO PREVENTIVO RUTA - MAQUINA HIELO',
      clase_orden: 'ZSM1',
      orden: '9001',
      aviso: '7001',
      cliente_id: 10,
      maquina_id: 20,
      tecnico_id: TECNICO_ID,
      descripcion: '',
      fecha_solicitud: '2026-04-20',
      fecha_servicio: '2026-04-26',
      costo_mano_obra: 0,
    })

    expect(valid.orden).toBe(9001)
    expect(valid.aviso).toBe(7001)
    expect(crearServicioSchema.safeParse({ ...valid, fecha_solicitud: '2026-04-27' }).success).toBe(false)
    expect(crearServicioSchema.safeParse({ ...valid, fecha_solicitud: '2026-04-26', fecha_servicio: '2026-04-25' }).success).toBe(false)
    expect(editarServicioSchema.safeParse({ status: 'cerrado' }).success).toBe(false)
  })

  it('requires a valid evidence-backed closure payload with non-future fecha_cierre', () => {
    const result = cierreSchema.parse({
      servicio_id: 30,
      aviso: 7001,
      parte_objeto: 'Compresor',
      causa: 'Mantenimiento',
      descripcion: 'Trabajo realizado correctamente',
      costo_total: 300,
      tecnico_id: TECNICO_ID,
      fecha_cierre: '2026-04-26',
      firma_receptor: 'Encargado',
    })

    expect(result.fecha_cierre).toBe('2026-04-26')
    expect(cierreSchema.safeParse({ ...result, descripcion: 'corto' }).success).toBe(false)
    expect(cierreSchema.safeParse({ ...result, fecha_cierre: '2026-04-27' }).success).toBe(false)
    expect(cierreSchema.safeParse({ ...result, aviso: -1 }).success).toBe(false)
    expect(cierreSchema.safeParse({ ...result, costo_total: -1 }).success).toBe(false)
  })

  it('validates inventory, refacciones, and technician stock assignments', () => {
    expect(crearItemInventarioSchema.parse({
      nombre: 'Filtro',
      descripcion: '',
      stock_actual: '10',
      stock_minimo: '2',
      precio_unitario: '',
      activo: true,
    })).toMatchObject({ stock_actual: 10, stock_minimo: 2, precio_unitario: null })

    expect(ajusteInventarioSchema.safeParse({ inventario_id: 50, tipo: 'salida', cantidad: 0 }).success).toBe(false)
    expect(refaccionSchema.safeParse({ inventario_id: 50, nombre_refaccion: 'Filtro', cantidad: 1, precio_unitario: 150, inventory_source: 'tecnico' }).success).toBe(true)
    expect(inventarioTecnicoSchema.safeParse({ tecnico_id: TECNICO_ID, inventario_id: 50, cantidad: 1, fecha: '2026-04-26' }).success).toBe(true)
  })

  it('validates policies and maintenance assignment semantics', () => {
    expect(crearPolizaSchema.safeParse({
      cliente_id: 10,
      maquina_id: 20,
      fecha_inicio: '2026-04-01',
      observaciones: null,
      activa: true,
    }).success).toBe(true)

    expect(crearMantenimientoSchema.safeParse({
      poliza_id: 90,
      cliente_id: 10,
      maquina_id: 20,
      tecnico_id: null,
      fecha_visita: '2026-04-26',
      status: 'pendiente',
    }).success).toBe(false)

    expect(editarMantenimientoSchema.safeParse({
      status: 'realizado',
      fecha_visita: '',
      costo_refacciones: 0,
    }).success).toBe(true)

    const missingPoliza = crearMantenimientoSchema.safeParse({
      cliente_id: 10,
      maquina_id: 20,
      tecnico_id: TECNICO_ID,
      fecha_visita: '2026-04-26',
      status: 'pendiente',
    })
    expect(missingPoliza.success).toBe(false)
    if (!missingPoliza.success) {
      expect(missingPoliza.error.issues[0]?.message).toBe('Selecciona una póliza')
    }
    expect(editarMantenimientoSchema.safeParse({ costo_mano_obra: -1 }).success).toBe(false)
    expect(editarMantenimientoSchema.safeParse({ costo_refacciones: -1 }).success).toBe(false)
  })

  it('enforces employee creation password and confirmation rules', () => {
    expect(crearTecnicoSchema.safeParse({
      nombre: 'Admin RAN',
      telefono: '',
      correo: 'admin@ran.test',
      role: 'admin',
      activo: true,
      password: 'Robusta1!',
      confirmar_password: 'Robusta1!',
      notas: '',
    }).success).toBe(true)

    expect(crearTecnicoSchema.safeParse({
      nombre: 'Tecnico',
      correo: 'tecnico@ran.test',
      password: 'password123',
      confirmar_password: 'password123',
    }).success).toBe(false)

    expect(crearTecnicoSchema.safeParse({
      nombre: 'Tecnico',
      correo: 'tecnico@ran.test',
      password: 'Robusta1!',
      confirmar_password: 'Robusta2!',
    }).success).toBe(false)
  })
})
