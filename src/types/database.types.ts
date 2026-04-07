/**
 * Este archivo es un skeleton tipado para el cliente de Supabase.
 *
 * Generarlo automáticamente con:
 *   npx supabase gen types typescript --project-id <tu-project-id> > src/types/database.types.ts
 *
 * O desde la CLI local:
 *   npx supabase gen types typescript --local > src/types/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          nombre: string
          correo: string
          telefono: string | null
          role: 'admin' | 'tecnico'
          especialidad: string | null
          activo: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      clientes: {
        Row: {
          id: number
          codigo_cliente: string
          nombre: string
          direccion: string | null
          municipio: string | null
          telefono: string | null
          correo_contacto: string | null
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['clientes']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['clientes']['Insert']>
      }
      maquinas: {
        Row: {
          id: number
          serie: string
          modelo: 'KM901' | 'MS1500' | 'SD1002' | 'KM1300'
          cliente_id: number | null
          fecha_instalacion: string | null
          status: 'operando' | 'en_taller' | 'baja'
          observaciones: string | null
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['maquinas']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['maquinas']['Insert']>
      }
      servicios: {
        Row: {
          id: number
          orden: number | null
          aviso: number | null
          clase_orden: string | null
          tipo_servicio: string
          cliente_id: number | null
          maquina_id: number | null
          tecnico_id: string | null
          descripcion: string | null
          fecha_solicitud: string | null
          fecha_servicio: string | null
          status: 'pendiente' | 'en_ruta' | 'completado' | 'cerrado'
          costo_refacciones: number
          costo_mano_obra: number
          total: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<
          Database['public']['Tables']['servicios']['Row'],
          'id' | 'total' | 'created_at' | 'updated_at'
        >
        Update: Partial<Database['public']['Tables']['servicios']['Insert']>
      }
      cierres: {
        Row: {
          id: number
          servicio_id: number
          aviso: number | null
          parte_objeto: string | null
          causa: string | null
          descripcion: string
          costo_total: number | null
          tecnico_id: string | null
          firma_receptor: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['cierres']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['cierres']['Insert']>
      }
      polizas: {
        Row: {
          id: number
          cliente_id: number
          maquina_id: number
          activa: boolean
          fecha_inicio: string
          observaciones: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['polizas']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['polizas']['Insert']>
      }
      poliza_estado_historial: {
        Row: {
          id: number
          poliza_id: number
          estado: 'activa' | 'inactiva'
          changed_at: string
          changed_by: string | null
          motivo: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['poliza_estado_historial']['Row'],
          'id' | 'changed_at'
        >
        Update: Partial<Database['public']['Tables']['poliza_estado_historial']['Insert']>
      }
      mantenimientos_poliza: {
        Row: {
          id: number
          poliza_id: number
          cliente_id: number
          maquina_id: number
          tecnico_id: string | null
          tipo_servicio: string
          descripcion: string | null
          fecha_visita: string | null
          status: 'pendiente' | 'en_ruta' | 'realizado'
          costo_refacciones: number
          costo_mano_obra: number
          total: number
          notas: string | null
          created_at: string
        }
        Insert: Omit<
          Database['public']['Tables']['mantenimientos_poliza']['Row'],
          'id' | 'total' | 'created_at'
        >
        Update: Partial<Database['public']['Tables']['mantenimientos_poliza']['Insert']>
      }
      inventario: {
        Row: {
          id: number
          nombre: string
          descripcion: string | null
          stock_actual: number
          stock_minimo: number
          precio_unitario: number | null
          activo: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['inventario']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['inventario']['Insert']>
      }
      servicio_refacciones: {
        Row: {
          id: number
          servicio_id: number | null
          mantenimiento_id: number | null
          inventario_id: number | null
          nombre_refaccion: string
          cantidad: number
          precio_unitario: number
          subtotal: number
        }
        Insert: Omit<Database['public']['Tables']['servicio_refacciones']['Row'], 'id' | 'subtotal'>
        Update: Partial<Database['public']['Tables']['servicio_refacciones']['Insert']>
      }
      inventario_tecnico: {
        Row: {
          id: number
          tecnico_id: string
          inventario_id: number
          cantidad: number
          fecha: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['inventario_tecnico']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['inventario_tecnico']['Insert']>
      }
      movimientos_inventario: {
        Row: {
          id: number
          inventario_id: number
          tipo: 'entrada' | 'salida' | 'ajuste'
          cantidad: number
          motivo: string | null
          referencia_id: number | null
          usuario_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['movimientos_inventario']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['movimientos_inventario']['Insert']>
      }
      maquinas_en_taller: {
        Row: {
          id: number
          maquina_id: number
          cliente_id: number | null
          servicio_id: number | null
          orden: number | null
          fecha_entrada: string
          fecha_salida: string | null
          diagnostico: string | null
          status: 'en_taller' | 'reparada' | 'devuelta'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['maquinas_en_taller']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['maquinas_en_taller']['Insert']>
      }
      maquinas_taller_movimientos: {
        Row: {
          id: number
          maquina_id: number
          maquina_taller_id: number | null
          servicio_id: number | null
          orden_servicio: number | null
          accion: 'entrada' | 'salida' | 'reubicacion' | 'nota'
          motivo: string
          origen: string | null
          destino: string | null
          detalle: string | null
          fecha_movimiento: string
          usuario_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['maquinas_taller_movimientos']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['maquinas_taller_movimientos']['Insert']>
      }
      evidencias: {
        Row: {
          id: number
          servicio_id: number
          r2_key: string
          r2_bucket: string
          filename: string
          mime_type: string
          size_bytes: number | null
          orden: number
          subida_por: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['evidencias']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['evidencias']['Insert']>
      }
      catalogo_pep: {
        Row: {
          id: number
          gz: string
          codigo_pep: string
          nombre_pep: string
          tipo_servicio: string
          activo: boolean
        }
        Insert: Omit<Database['public']['Tables']['catalogo_pep']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['catalogo_pep']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
