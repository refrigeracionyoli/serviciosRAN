import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  MantenimientoStatusBadge,
  MaquinaStatusBadge,
  ServicioStatusBadge,
} from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'

describe('shared UI components', () => {
  it('renders service, machine, and maintenance status labels used across admin and technician flows', () => {
    render(
      <div>
        <ServicioStatusBadge status="pendiente" />
        <ServicioStatusBadge status="en_ruta" />
        <ServicioStatusBadge status="completado" />
        <ServicioStatusBadge status="cerrado" />
        <MaquinaStatusBadge status="operando" />
        <MaquinaStatusBadge status="en_taller" />
        <MaquinaStatusBadge status="baja" />
        <MantenimientoStatusBadge status="pendiente" />
        <MantenimientoStatusBadge status="en_ruta" />
        <MantenimientoStatusBadge status="realizado" />
      </div>,
    )

    for (const label of ['Pendiente', 'En ruta', 'Completado', 'Cerrado', 'Operando', 'En taller', 'Baja', 'Realizado']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('renders empty states with optional action content', () => {
    render(
      <EmptyState
        title="Sin asignaciones"
        description="No tienes servicios ni mantenimientos asignados."
        action={<button type="button">Ver inventario</button>}
      />,
    )

    expect(screen.getByText('Sin asignaciones')).toBeInTheDocument()
    expect(screen.getByText('No tienes servicios ni mantenimientos asignados.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver inventario' })).toBeInTheDocument()
  })
})
