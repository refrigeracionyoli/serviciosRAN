import { ProfileSettingsPanel } from '@/components/profile/ProfileSettingsPanel'

export function TecnicoPerfilPage() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.3)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Perfil
        </p>
        <h1 className="mt-1.5 text-xl font-extrabold tracking-tight text-ran-navy">
          Mi cuenta
        </h1>
        <p className="mt-1 text-[13px] text-ran-slate">
          Actualiza tu información de contacto y la contraseña de acceso.
        </p>
      </section>

      <ProfileSettingsPanel variant="page" />
    </div>
  )
}
