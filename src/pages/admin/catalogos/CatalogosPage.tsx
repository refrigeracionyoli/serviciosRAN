import { useNavigate } from 'react-router-dom'
import { Users, Cpu, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'

const catalogos = [
  { to: '/catalogos/tecnicos', icon: Users, title: 'Técnicos', description: 'Gestión de usuarios técnicos' },
  { to: '/catalogos/maquinas', icon: Cpu, title: 'Máquinas', description: 'Catálogo de equipos instalados' },
]

export function CatalogosPage() {
  const navigate = useNavigate()
  return (
    <div>
      <PageHeader title="Catálogos" description="Administración de datos maestros" />
      <div className="p-6 grid grid-cols-2 gap-4 max-w-2xl">
        {catalogos.map((cat) => (
          <button key={cat.to} type="button" onClick={() => navigate(cat.to)} className="text-left">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="rounded-xl bg-ran-ice p-3">
                    <cat.icon className="h-6 w-6 text-ran-navy" />
                  </div>
                  <div>
                    <p className="font-semibold text-ran-navy">{cat.title}</p>
                    <p className="text-sm text-ran-slate">{cat.description}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-ran-slate" />
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}
