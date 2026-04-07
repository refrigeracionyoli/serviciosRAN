# CLAUDE.md — Servicios RAN

Contexto completo del proyecto para construcción con IA.
**Lee este archivo completo antes de escribir cualquier línea de código.**

---

## 1. Contexto del negocio

**Servicios RAN** es un sistema de gestión de servicios técnicos para un taller de reparación de máquinas de hielo. El cliente gestiona una flota de máquinas instaladas en tiendas Six de Nuevo León, México.

El sistema **reemplaza un flujo 100% basado en Excel**. El cliente tiene plantillas de Excel con formatos exactos requeridos por Heineken que deben respetarse en la exportación automática.

### Partes involucradas
- **Administradora:** Patricia Torres Saucedo (`ran.patytorres@hotmail.com`) — llamada "Yolanda" en el sistema. Acceso completo.
- **Técnicos activos:**
  - Hiram Quintanilla — `ran.hiramq@gmail.com`
  - José Jaime Gatica Beltrán — `jjaime.gbeltran@hotmail.es`
  - Mario Alberto Martínez Robles — `setromtz@gmail.com`
- **Cliente Heineken:** proveedor número `4010269`, GZ Nuevo León. Todos los reportes siguen su formato exacto.

### Dominio
`serviciosran.com.mx` — primer año incluido en la cotización.

### Cotización original
- Precio: $25,000 MXN · Un solo pago a la entrega
- Plazo: 60 días naturales
- Mantenimiento post-entrega: 30 días de corrección de bugs incluidos (NO nuevas funcionalidades)
- Desarrollador: Ing. Isidro Saúl Treviño Lopez

---

## 2. Stack tecnológico

```
Frontend:
  React 18 + Vite
  TypeScript — strict mode, sin any, sin @ts-ignore
  Tailwind CSS v3
  shadcn/ui + Radix UI        → componentes accesibles y modificables
  TanStack Query v5            → server state, caching, sync
  TanStack Table v8            → tablas con paginación, filtros, ordenamiento
  Zustand                      → client state (sesión, sidebar, filtros activos)
  React Router v6              → rutas protegidas por rol
  React Hook Form + Zod        → formularios y validación
  vite-plugin-pwa + Workbox    → PWA, service worker, instalación offline
  Dexie.js                     → IndexedDB para modo offline

Backend / BaaS:
  Supabase
    PostgreSQL                 → base de datos principal
    Auth (JWT)                 → sesiones, login/logout
    Row Level Security         → autorización a nivel de base de datos
    Edge Functions (Deno)      → generación de Excel con plantillas

Almacenamiento de imágenes:
  Cloudflare R2                → fotos de evidencia fotográfica
  - Bucket privado, sin acceso público
  - Acceso solo mediante presigned URLs generadas en Edge Functions
  - URLs de descarga expiran en 1 hora
  - URLs de subida (PUT) expiran en 15 minutos
  - Carpeta por técnico: evidencias/{tecnico_id}/{servicio_id}/{filename}
  - browser-image-compression antes de subir (máx 1MB, 1920px)

Generación de Excel:
  ExcelJS en Supabase Edge Functions
  Plantillas .xlsx en Supabase Storage (bucket privado "templates")
  El servidor lee la plantilla, inyecta datos por celda, devuelve blob

Despliegue:
  Vercel (frontend + vercel.json con headers de seguridad)
  Cloudflare (DNS + R2)
  Supabase Cloud (DB + Auth + Edge Functions)
```

---

## 3. Arquitectura general

```
Browser (PWA instalable)
  ↕ TanStack Query          → online: fetch y caché de datos
  ↕ Dexie.js / IndexedDB   → offline: lecturas locales + cola de escrituras
       ↓
  Supabase PostgREST        → PostgreSQL + RLS (toda la autorización aquí)
  Supabase Auth             → JWT válido 8 horas (jornada laboral)
  Supabase Edge Functions   → generación de Excel con ExcelJS
       ↓
  Cloudflare R2             → fotos de evidencia (presigned URLs, bucket privado)
```

**Flujo offline:**
1. Sin internet — lecturas desde IndexedDB (caché de Workbox), escrituras a cola local en Dexie.
2. Al reconectar — Workbox detecta conexión, drena la cola y sincroniza con Supabase.
3. TanStack Query invalida y refresca las queries afectadas automáticamente.
4. El admin ve un banner "Sincronizando X cambios..." mientras ocurre el proceso.

---

## 4. Roles y permisos

Exactamente **dos roles**. Definidos en `profiles.role`. Reforzados con RLS en cada tabla.

### `admin`
- Acceso completo a todas las pantallas desktop
- CRUD completo sobre todos los módulos
- Único que puede cambiar el status de un servicio a `cerrado`
- Único que puede crear y desactivar cuentas de usuario
- Genera reportes, evidencias Excel, y exportaciones

### `tecnico`
- Solo interfaz móvil (390px)
- Solo ve sus propios servicios asignados (`tecnico_id = auth.uid()`)
- Puede subir fotos de evidencia a sus propios servicios
- Puede registrar refacciones usadas en sus servicios
- Registra su inventario del día (qué piezas lleva al salir)
- **No puede** ver servicios de otros técnicos
- **No puede** ver inventario general, reportes, pólizas, ni catálogos completos
- **No puede** crear, editar ni cerrar servicios (solo completarlos)

**Regla crítica de seguridad:** el rol nunca viene del cliente. Se obtiene siempre de `profiles` usando `auth.uid()` en el servidor. RLS bloquea cualquier intento de elevación de privilegios antes de que llegue a los datos.

---

## 5. Esquema de base de datos

```sql
-- ─────────────────────────────────────────────────────────────
-- PERFILES (extiende auth.users de Supabase)
-- ─────────────────────────────────────────────────────────────
create table profiles (
  id            uuid        primary key references auth.users on delete cascade,
  nombre        text        not null,
  correo        text        not null,
  telefono      text,
  role          text        not null check (role in ('admin', 'tecnico')),
  especialidad  text,
  activo        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- CLIENTES (establecimientos Six)
-- ─────────────────────────────────────────────────────────────
create table clientes (
  id              bigserial   primary key,
  codigo_cliente  text        not null unique,  -- ej: 300831815
  nombre          text        not null,          -- ej: Tkt Six Centenario
  direccion       text,
  municipio       text,
  telefono        text,
  correo_contacto text,
  activo          boolean     not null default true,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- MÁQUINAS
-- ─────────────────────────────────────────────────────────────
create table maquinas (
  id                bigserial   primary key,
  serie             text        not null unique,
  modelo            text        not null check (modelo in ('KM901','MS1500','SD1002','KM1300')),
  cliente_id        bigint      references clientes on delete set null,
  fecha_instalacion date,
  status            text        not null default 'operando'
                    check (status in ('operando','en_taller','baja')),
  observaciones     text,
  activo            boolean     not null default true,
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- PÓLIZAS
-- ─────────────────────────────────────────────────────────────
create table polizas (
  id            bigserial   primary key,
  cliente_id    bigint      not null references clientes,
  maquina_id    bigint      not null references maquinas,
  activa        boolean     not null default true,
  fecha_inicio  date        not null,
  observaciones text,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- SERVICIOS (órdenes de trabajo)
-- ─────────────────────────────────────────────────────────────
create table servicios (
  id                  bigserial    primary key,
  orden               bigint       unique,
  aviso               bigint,
  clase_orden         text,                        -- ZSM1 | ZSI2
  tipo_servicio       text         not null,
  cliente_id          bigint       references clientes,
  maquina_id          bigint       references maquinas,
  tecnico_id          uuid         references profiles,
  descripcion         text,
  fecha_solicitud     date,
  fecha_servicio      date,
  status              text         not null default 'pendiente'
                      check (status in ('pendiente','en_ruta','completado','cerrado')),
  costo_refacciones   numeric(10,2) not null default 0,
  costo_mano_obra     numeric(10,2) not null default 0,
  total               numeric(10,2) generated always as (costo_refacciones + costo_mano_obra) stored,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- CIERRES DE SERVICIO (datos de cierre para Heineken)
-- ─────────────────────────────────────────────────────────────
create table cierres (
  id              bigserial   primary key,
  servicio_id     bigint      not null references servicios unique,
  aviso           bigint,
  parte_objeto    text,                  -- código Heineken ej: 1130
  causa           text,                  -- código Heineken ej: 1740
  descripcion     text        not null,
  costo_total     numeric(10,2),
  tecnico_id      uuid        references profiles,
  firma_receptor  text,                  -- nombre de quien firmó en la tienda
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- MANTENIMIENTOS DE PÓLIZA (preventivos — sin orden SAP)
-- ─────────────────────────────────────────────────────────────
create table mantenimientos_poliza (
  id                  bigserial    primary key,
  poliza_id           bigint       not null references polizas,
  cliente_id          bigint       not null references clientes,
  maquina_id          bigint       not null references maquinas,
  tecnico_id          uuid         not null references profiles,
  tipo_servicio       text         not null default 'MTTO PREVENTIVO RUTA',
  descripcion         text,
  fecha_visita        date         not null,
  status              text         not null default 'pendiente'
                      check (status in ('pendiente','realizado')),
  costo_refacciones   numeric(10,2) not null default 0,
  costo_mano_obra     numeric(10,2) not null default 648.00,
  total               numeric(10,2) generated always as (costo_refacciones + costo_mano_obra) stored,
  notas               text,
  created_at          timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- INVENTARIO (catálogo de refacciones)
-- ─────────────────────────────────────────────────────────────
create table inventario (
  id              bigserial    primary key,
  nombre          text         not null,
  descripcion     text,
  stock_actual    integer      not null default 0,
  stock_minimo    integer      not null default 0,
  precio_unitario numeric(10,2),
  activo          boolean      not null default true,
  created_at      timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- REFACCIONES POR SERVICIO / MANTENIMIENTO
-- ─────────────────────────────────────────────────────────────
create table servicio_refacciones (
  id                bigserial    primary key,
  servicio_id       bigint       references servicios on delete cascade,
  mantenimiento_id  bigint       references mantenimientos_poliza on delete cascade,
  inventario_id     bigint       references inventario on delete set null,
  nombre_refaccion  text         not null,   -- desnormalizado para trazabilidad histórica
  cantidad          integer      not null check (cantidad > 0),
  precio_unitario   numeric(10,2) not null,
  subtotal          numeric(10,2) generated always as (cantidad * precio_unitario) stored,
  constraint una_sola_referencia check (
    (servicio_id is not null)::int + (mantenimiento_id is not null)::int = 1
  )
);

-- ─────────────────────────────────────────────────────────────
-- INVENTARIO POR TÉCNICO (asignación diaria)
-- ─────────────────────────────────────────────────────────────
create table inventario_tecnico (
  id            bigserial    primary key,
  tecnico_id    uuid         not null references profiles,
  inventario_id bigint       not null references inventario,
  cantidad      integer      not null check (cantidad > 0),
  fecha         date         not null default current_date,
  created_at    timestamptz  not null default now(),
  unique (tecnico_id, inventario_id, fecha)
);

-- ─────────────────────────────────────────────────────────────
-- MOVIMIENTOS DE INVENTARIO (trazabilidad completa)
-- ─────────────────────────────────────────────────────────────
create table movimientos_inventario (
  id            bigserial    primary key,
  inventario_id bigint       not null references inventario,
  tipo          text         not null check (tipo in ('entrada','salida','ajuste')),
  cantidad      integer      not null,
  motivo        text,
  referencia_id bigint,
  usuario_id    uuid         references profiles,
  created_at    timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- MÁQUINAS EN TALLER
-- ─────────────────────────────────────────────────────────────
create table maquinas_en_taller (
  id            bigserial    primary key,
  maquina_id    bigint       not null references maquinas,
  cliente_id    bigint       references clientes,
  orden         bigint,
  fecha_entrada date         not null,
  fecha_salida  date,
  diagnostico   text,
  status        text         not null default 'en_taller'
                check (status in ('en_taller','reparada','devuelta')),
  created_at    timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- EVIDENCIAS FOTOGRÁFICAS (referencia a Cloudflare R2)
-- ─────────────────────────────────────────────────────────────
create table evidencias (
  id            bigserial    primary key,
  servicio_id   bigint       not null references servicios on delete cascade,
  r2_key        text         not null,   -- clave en R2: {tecnico_id}/{servicio_id}/{filename}
  r2_bucket     text         not null default 'ran-evidencias',
  filename      text         not null,
  mime_type     text         not null default 'image/jpeg',
  size_bytes    integer,
  orden         integer      not null default 1,
  subida_por    uuid         references profiles,
  created_at    timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- CATÁLOGO PEP DE HEINEKEN
-- ─────────────────────────────────────────────────────────────
create table catalogo_pep (
  id              bigserial   primary key,
  gz              text        not null,
  codigo_pep      text        not null,
  nombre_pep      text        not null,
  tipo_servicio   text        not null,
  activo          boolean     not null default true
);

-- ─────────────────────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────────────────────
create index idx_servicios_tecnico       on servicios (tecnico_id);
create index idx_servicios_status        on servicios (status);
create index idx_servicios_fechas        on servicios (fecha_solicitud, fecha_servicio);
create index idx_servicios_cliente       on servicios (cliente_id);
create index idx_evidencias_servicio     on evidencias (servicio_id);
create index idx_maquinas_cliente        on maquinas (cliente_id);
create index idx_inv_tecnico_fecha       on inventario_tecnico (tecnico_id, fecha);
create index idx_movimientos_inventario  on movimientos_inventario (inventario_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- TRIGGER updated_at automático
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_servicios_updated_at
  before update on servicios for each row execute function set_updated_at();

create trigger trg_profiles_updated_at
  before update on profiles for each row execute function set_updated_at();
```

---

## 6. Row Level Security — Políticas completas

**RLS habilitado en TODAS las tablas. Sin excepciones.**

```sql
-- ─── PROFILES ───────────────────────────────────────────────
alter table profiles enable row level security;

create policy "Admin: acceso total a profiles"
  on profiles for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: ve su propio perfil"
  on profiles for select using (id = auth.uid());

-- CRÍTICO: nadie puede cambiar su propio role
create policy "Nadie eleva su role"
  on profiles for update
  using (id = auth.uid())
  with check (role = (select role from profiles where id = auth.uid()));

-- ─── SERVICIOS ──────────────────────────────────────────────
alter table servicios enable row level security;

create policy "Admin: acceso total a servicios"
  on servicios for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: ve solo sus servicios"
  on servicios for select using (tecnico_id = auth.uid());

create policy "Técnico: actualiza solo sus servicios (no puede cerrar)"
  on servicios for update
  using (tecnico_id = auth.uid())
  with check (tecnico_id = auth.uid() and status != 'cerrado');

-- Técnico NO tiene INSERT ni DELETE en servicios

-- ─── CIERRES ────────────────────────────────────────────────
alter table cierres enable row level security;
create policy "Solo admin gestiona cierres" on cierres for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── EVIDENCIAS ─────────────────────────────────────────────
alter table evidencias enable row level security;

create policy "Admin: ve todas las evidencias"
  on evidencias for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: inserta evidencias de sus servicios"
  on evidencias for insert
  with check (
    subida_por = auth.uid() and
    exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid())
  );

create policy "Técnico: ve evidencias de sus servicios"
  on evidencias for select
  using (exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid()));

-- ─── INVENTARIO ─────────────────────────────────────────────
alter table inventario enable row level security;
create policy "Todos leen inventario" on inventario for select using (true);
create policy "Solo admin modifica inventario" on inventario for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── INVENTARIO TÉCNICO ─────────────────────────────────────
alter table inventario_tecnico enable row level security;
create policy "Admin: acceso total inventario_tecnico" on inventario_tecnico for all
  using ((select role from profiles where id = auth.uid()) = 'admin');
create policy "Técnico: gestiona su inventario del día" on inventario_tecnico for all
  using (tecnico_id = auth.uid());

-- ─── MANTENIMIENTOS PÓLIZA ──────────────────────────────────
alter table mantenimientos_poliza enable row level security;
create policy "Solo admin gestiona mantenimientos" on mantenimientos_poliza for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── CLIENTES Y MÁQUINAS (lectura pública, escritura solo admin) ──
alter table clientes enable row level security;
create policy "Todos leen clientes" on clientes for select using (true);
create policy "Solo admin modifica clientes" on clientes for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

alter table maquinas enable row level security;
create policy "Todos leen maquinas" on maquinas for select using (true);
create policy "Solo admin modifica maquinas" on maquinas for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── RESTO: solo admin ──────────────────────────────────────
-- polizas, servicio_refacciones, movimientos_inventario,
-- maquinas_en_taller, catalogo_pep, cierres
```

---

## 7. Cloudflare R2 — Almacenamiento de imágenes

R2 es exclusivamente para fotos de evidencia. Las plantillas de Excel van en Supabase Storage.

### Variables de entorno (solo en Edge Functions, nunca en frontend)
```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=ran-evidencias
```

### Flujo de subida desde el técnico
```typescript
// 1. Comprimir en el browser antes de pedir la URL
import imageCompression from 'browser-image-compression';
const compressed = await imageCompression(file, {
  maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true,
});

// 2. Pedir presigned URL PUT a la Edge Function (con JWT)
const { uploadUrl, r2Key } = await fetch(
  `${SUPABASE_URL}/functions/v1/r2-presigned-put`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ servicioId, filename: file.name, contentType: file.type }),
  }
).then(r => r.json());

// 3. Subir directo a R2 con el presigned URL (no pasa por Supabase)
await fetch(uploadUrl, { method: 'PUT', body: compressed,
  headers: { 'Content-Type': file.type } });

// 4. Registrar referencia en DB
await supabase.from('evidencias').insert({ servicio_id, r2_key: r2Key, filename, ... });
```

### Flujo de descarga (admin ve las fotos)
```typescript
// Edge Function genera presigned URL GET válida 1 hora
const { downloadUrl } = await fetch(
  `${SUPABASE_URL}/functions/v1/r2-presigned-get`,
  { headers: { Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ r2Key }) }
).then(r => r.json());

// Usar en <img src={downloadUrl} /> — expira en 1 hora
```

---

## 8. Seguridad — Reglas no negociables

### Variables de entorno
```bash
# .env.local — NUNCA commitear
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # pública por diseño de Supabase

# .env.example — SÍ commitear (valores vacíos)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Supabase Edge Function secrets — NUNCA en el repo
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
```

### Headers HTTP — vercel.json
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=self, microphone=(), geolocation=()" },
      { "key": "Content-Security-Policy",
        "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://*.r2.cloudflarestorage.com; img-src 'self' data: blob:; worker-src 'self'" }
    ]
  }]
}
```

### Checklist de seguridad
- Session timeout: 8 horas. Al expirar → redirect a `/login` sin mostrar datos.
- Verificar `perfil.activo === true` después del login. Si es `false` → logout inmediato.
- Presigned URLs de R2 generadas **solo en Edge Functions**, nunca en el cliente.
- La `service_role_key` no existe en ningún archivo del frontend.
- Soft delete en todo: `activo = false` en lugar de `DELETE`.
- `total` y `subtotal` son columnas generadas en Postgres. Nunca se calculan ni envían desde el cliente.

---

## 9. Estructura de carpetas

```
servicios-ran/
├── .claude/
│   └── CLAUDE.md
│
├── public/
│   ├── icons/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── icon-512-maskable.png
│   └── robots.txt
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx
│   │
│   ├── lib/                            # infraestructura pura
│   │   ├── supabase.ts                 # cliente singleton
│   │   ├── r2.ts                       # helpers presigned URLs
│   │   ├── queryClient.ts              # TanStack Query config
│   │   ├── db.ts                       # Dexie.js — IndexedDB offline
│   │   ├── offline-queue.ts            # cola de mutaciones offline
│   │   └── utils.ts                    # cn(), formatMXN(), formatDate()
│   │
│   ├── types/
│   │   ├── database.types.ts           # generado: supabase gen types typescript
│   │   ├── domain.types.ts             # Servicio, Poliza, Tecnico, Maquina...
│   │   └── api.types.ts                # request/response de Edge Functions
│   │
│   ├── schemas/                        # Zod — validación de formularios
│   │   ├── servicio.schema.ts
│   │   ├── mantenimiento.schema.ts
│   │   ├── poliza.schema.ts
│   │   ├── inventario.schema.ts
│   │   └── cliente.schema.ts
│   │
│   ├── hooks/                          # un archivo por entidad de negocio
│   │   ├── use-auth.ts
│   │   ├── use-servicios.ts
│   │   ├── use-servicio-detalle.ts
│   │   ├── use-polizas.ts
│   │   ├── use-mantenimientos.ts
│   │   ├── use-inventario.ts
│   │   ├── use-maquinas.ts
│   │   ├── use-clientes.ts
│   │   ├── use-tecnicos.ts
│   │   ├── use-evidencias.ts
│   │   ├── use-cierres.ts
│   │   └── use-offline-sync.ts
│   │
│   ├── stores/                         # Zustand — UI state solamente
│   │   ├── sidebar.store.ts
│   │   ├── filtros.store.ts
│   │   └── sync.store.ts
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui — NO editar manualmente
│   │   │
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx           # sidebar + content (admin)
│   │   │   ├── MobileLayout.tsx        # layout técnico móvil
│   │   │   ├── Sidebar.tsx             # nav expandida
│   │   │   └── SidebarCollapsed.tsx    # nav colapsada (68px)
│   │   │
│   │   ├── shared/                     # reutilizables entre módulos
│   │   │   ├── DataTable.tsx           # wrapper TanStack Table + paginación
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── KpiCard.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── ExportButton.tsx        # llama Edge Function y descarga blob
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── OfflineBanner.tsx       # "Sin conexión — modo offline"
│   │   │   └── SyncIndicator.tsx       # "Sincronizando X cambios..."
│   │   │
│   │   └── forms/
│   │       ├── ServicioForm.tsx
│   │       ├── RefaccionesForm.tsx     # lista dinámica de refacciones
│   │       ├── MantenimientoForm.tsx
│   │       ├── CierreForm.tsx
│   │       ├── PolizaForm.tsx
│   │       └── ClienteCombobox.tsx     # combobox con autollenado
│   │
│   ├── pages/
│   │   ├── auth/
│   │   │   └── LoginPage.tsx
│   │   │
│   │   ├── admin/                      # desktop (1440px)
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── servicios/
│   │   │   │   ├── ServiciosPage.tsx
│   │   │   │   ├── ServicioNuevoPage.tsx
│   │   │   │   ├── ServicioEditarPage.tsx
│   │   │   │   └── ServicioDetallePage.tsx
│   │   │   ├── bitacora/
│   │   │   │   └── BitacoraPage.tsx
│   │   │   ├── polizas/
│   │   │   │   ├── PolizasPage.tsx
│   │   │   │   ├── PolizaNuevaPage.tsx
│   │   │   │   └── MantenimientosPage.tsx
│   │   │   ├── inventario/
│   │   │   │   ├── InventarioPage.tsx
│   │   │   │   ├── InventarioTecnicoPage.tsx
│   │   │   │   └── MovimientosPage.tsx
│   │   │   ├── maquinas-taller/
│   │   │   │   └── MaquinasTallerPage.tsx
│   │   │   ├── reportes/
│   │   │   │   ├── ReporteSemanalPage.tsx
│   │   │   │   └── EvidenciaPage.tsx
│   │   │   └── catalogos/
│   │   │       ├── CatalogosPage.tsx
│   │   │       ├── TecnicosPage.tsx
│   │   │       ├── MaquinasPage.tsx
│   │   │       └── MaquinaHistorialPage.tsx
│   │   │
│   │   └── tecnico/                    # móvil (390px)
│   │       ├── TecnicoHomePage.tsx
│   │       ├── TecnicoEvidenciaPage.tsx
│   │       ├── TecnicoInventarioPage.tsx
│   │       └── TecnicoRefaccionesPage.tsx
│   │
│   └── supabase/
│       └── functions/
│           ├── _shared/
│           │   ├── auth.ts             # verificar JWT y extraer rol
│           │   └── cors.ts
│           ├── generar-reporte-semanal/
│           │   └── index.ts
│           ├── generar-evidencia-os/
│           │   └── index.ts
│           ├── r2-presigned-put/
│           │   └── index.ts
│           └── r2-presigned-get/
│               └── index.ts
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   ├── 003_indexes.sql
│   │   └── 004_seed_catalogs.sql
│   └── seed.sql
│
├── .env.example                        # keys vacías — SÍ commitear
├── .env.local                          # keys reales — NUNCA commitear
├── .gitignore
├── vercel.json                         # headers de seguridad
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 10. Convenciones de código

### Nombrado de archivos
| Carpeta | Convención | Ejemplo |
|---------|-----------|---------|
| `pages/` | PascalCase + sufijo `Page` | `ServiciosPage.tsx` |
| `components/` | PascalCase | `DataTable.tsx` |
| `hooks/` | kebab-case + prefijo `use-` | `use-servicios.ts` |
| `stores/` | kebab-case + sufijo `.store` | `sidebar.store.ts` |
| `schemas/` | kebab-case + sufijo `.schema` | `servicio.schema.ts` |
| `lib/` | kebab-case | `offline-queue.ts` |
| `types/` | kebab-case + sufijo `.types` | `domain.types.ts` |

### Nombrado de variables y funciones
```typescript
// Conceptos de negocio → español
const servicio: Servicio = { ... }
const poliza: Poliza = { ... }
const tecnico: Tecnico = { ... }

// Infraestructura React → inglés
const [isLoading, setIsLoading] = useState(false)
const queryClient = useQueryClient()

// Event handlers → handleVerbo
const handleCrearServicio = () => { ... }
const handleCambiarStatus = () => { ... }
const handleExportarExcel = () => { ... }

// Queries → use[Entidad]Query / use[Accion]Mutation
const { data: servicios } = useServiciosQuery()
const { mutate: crearServicio } = useCrearServicioMutation()
```

### Patrón de hook de datos
```typescript
// hooks/use-servicios.ts — toda la lógica de datos aquí, no en los componentes

export function useServiciosQuery(filtros?: FiltrosServicio) {
  return useQuery({
    queryKey: ['servicios', filtros],
    queryFn: () => fetchServicios(filtros),
    staleTime: 1000 * 60 * 5,
  });
}

export function useCrearServicioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CrearServicioInput) => crearServicio(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servicios'] });
    },
  });
}
```

### Patrón de validación con Zod
```typescript
// schemas/servicio.schema.ts
export const crearServicioSchema = z.object({
  tipo_servicio: z.enum([
    'MTTO CORRECTIVO RUTA',
    'MTTO CORRECTIVO PISO',
    'INSTALACION',
    'RETIRO',
    'GARANTIA',
  ]),
  cliente_id:   z.number().int().positive(),
  maquina_id:   z.number().int().positive(),
  tecnico_id:   z.string().uuid(),
  descripcion:  z.string().min(10).max(500),
  fecha_solicitud: z.string().date(),
  // total NO va aquí — columna generada en DB
});

export type CrearServicioInput = z.infer<typeof crearServicioSchema>;
```

### TypeScript — reglas estrictas
```typescript
// PROHIBIDO — cualquiera de estas líneas es un error de revisión:
const x: any = valor
// @ts-ignore
const y = foo as unknown as OtroTipo
```

### Componentes — reglas
```typescript
// Exportación nombrada, no default
export function ServicioDetalle({ servicioId }: Props) { ... }

// Props con interface siempre
interface Props {
  servicioId: number;
  onClose: () => void;
}

// El componente no hace fetch directo, no tiene useEffect de datos
// Toda la lógica va en el hook correspondiente
export function ServiciosPage() {
  const { data, isLoading, error } = useServiciosQuery();
  return <DataTable data={data} loading={isLoading} />;
}
```

---

## 11. Datos del negocio — catálogos y contexto

### Tipos de servicio
```
MTTO CORRECTIVO RUTA    → correctivo en sucursal del cliente
MTTO CORRECTIVO PISO    → correctivo en taller
MTTO PREVENTIVO RUTA    → preventivo por póliza (sin orden SAP, sin aviso)
INSTALACION             → instalación de máquina nueva
RETIRO                  → retiro de máquina para reparación
GARANTIA                → servicio en garantía
```

### Modelos de máquina
```
KM901   → Hoshizaki estándar
MS1500  → Hoshizaki grande
SD1002  → dispensador
KM1300  → Hoshizaki extra grande
```

### Clases de orden SAP
```
ZSM1 → Mantenimiento
ZSI2 → Instalación
```

### Costos base (del Excel POLIZA_2025 hoja MTTOS)
```
Mano de obra estándar   → $648.00 MXN
Mano de obra Jaime      → $1,008.00 MXN (algunas rutas específicas)
Filtro de agua          → $266.00 MXN (precio unitario)
```

### Datos Heineken para reportes
```
Número de proveedor  → 4010269
GZ                   → NUEVO LEON
Semana               → formato S{semana}{año} ej: S0426
```

### Autollenado de formularios
Al seleccionar un cliente en el formulario de nuevo servicio:
- nombre, dirección, teléfono → se llenan desde `clientes`
- dropdown de máquinas → filtrado por `maquinas.cliente_id`
- Al seleccionar técnico → se selecciona de lista, no se escribe el nombre

---

## 12. Plantillas de Excel — Estructura

Plantillas en Supabase Storage, bucket privado `templates`. ExcelJS las lee en Edge Functions.

### FORMATO_SEMANAL_2026.xlsx
```
Hoja 1 - Carátula
  Proveedor: 4010269 | GZ: NUEVO LEON | Período: S0426
  Tipo de servicio | Fechas inicio/fin de semana

Hoja 2 - Registro Ordenes
  Proveedor | GZ | Período | Tipo Servicio | PEP | Nombre PEP |
  Aviso | Orden | Cliente | Equipo | Serie | Fecha Cierre |
  Costo Servicio | Refacciones | Total | Comentarios

Hoja 3 - Registro Refacciones
  SelGZ | Orden | Equipo | PEP | Nombre PEP |
  Refacción | Cantidad | Precio Unitario | Precio Total

Hoja 4 - Resumen para pago
  Pivot consolidado por tipo de servicio y PEP
```

### Formato_evidencias_OS_.xlsx
```
Hoja 1 - Carátula
  Número de orden | Tabla de componentes | Suma total

Hoja 2 - Orden de servicio
  Imagen de la orden

Hoja 3 - Evidencia fotográfica
  4 fotos incrustadas (2x2) desde Cloudflare R2

Hoja 4 - Evidencia fotográfica adicional
  Misma estructura para fotos extra
```

### Edge Function — patrón de autenticación compartido
```typescript
// supabase/functions/_shared/auth.ts
export async function requireRole(req: Request, role: 'admin' | 'tecnico') {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Response('Unauthorized', { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role, activo').eq('id', user.id).single();

  if (!profile?.activo) throw new Response('Account disabled', { status: 403 });
  if (profile.role !== role) throw new Response('Forbidden', { status: 403 });

  return { user, profile };
}
```

---

## 13. PWA — Configuración

```typescript
// vite.config.ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Servicios RAN',
    short_name: 'RAN',
    description: 'Sistema de gestión de servicios técnicos',
    theme_color: '#1B3B6F',
    background_color: '#F5F7FA',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [{
      urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'supabase-api',
        expiration: { maxAgeSeconds: 60 * 5 },
        networkTimeoutSeconds: 3,
      },
    }],
  },
})
```

---

## 14. Routing y guards de rol

```typescript
// src/router.tsx
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireRole role="admin"><AppLayout /></RequireRole>,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'servicios', element: <ServiciosPage /> },
      { path: 'servicios/nuevo', element: <ServicioNuevoPage /> },
      { path: 'servicios/:id', element: <ServicioDetallePage /> },
      { path: 'servicios/:id/editar', element: <ServicioEditarPage /> },
      { path: 'bitacora', element: <BitacoraPage /> },
      { path: 'polizas', element: <PolizasPage /> },
      { path: 'polizas/nueva', element: <PolizaNuevaPage /> },
      { path: 'polizas/mantenimientos', element: <MantenimientosPage /> },
      { path: 'inventario', element: <InventarioPage /> },
      { path: 'inventario/tecnico', element: <InventarioTecnicoPage /> },
      { path: 'inventario/movimientos', element: <MovimientosPage /> },
      { path: 'maquinas-taller', element: <MaquinasTallerPage /> },
      { path: 'reportes/semanal', element: <ReporteSemanalPage /> },
      { path: 'reportes/evidencia', element: <EvidenciaPage /> },
      { path: 'catalogos', element: <CatalogosPage /> },
      { path: 'catalogos/tecnicos', element: <TecnicosPage /> },
      { path: 'catalogos/maquinas', element: <MaquinasPage /> },
      { path: 'catalogos/maquinas/:id/historial', element: <MaquinaHistorialPage /> },
    ],
  },
  {
    element: <RequireRole role="tecnico"><MobileLayout /></RequireRole>,
    children: [
      { path: 'tecnico', element: <TecnicoHomePage /> },
      { path: 'tecnico/servicio/:id/evidencia', element: <TecnicoEvidenciaPage /> },
      { path: 'tecnico/inventario', element: <TecnicoInventarioPage /> },
      { path: 'tecnico/servicio/:id/refacciones', element: <TecnicoRefaccionesPage /> },
    ],
  },
]);

function RequireRole({ role, children }: { role: string; children: ReactNode }) {
  const { user, perfil, isLoading } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!perfil?.activo) return <Navigate to="/login" replace />;
  if (perfil.role !== role) {
    return <Navigate to={perfil.role === 'admin' ? '/' : '/tecnico'} replace />;
  }
  return <>{children}</>;
}
```

---

## 15. Lo que NO debe hacer el sistema

```
SEGURIDAD — errores críticos:
  ✗ Técnico ve servicios de otro técnico (RLS lo previene)
  ✗ Técnico cambia status a 'cerrado' (RLS with check lo previene)
  ✗ Usuario modifica su propio role (RLS with check lo previene)
  ✗ Presigned URLs de R2 generadas en el frontend
  ✗ service_role_key en cualquier archivo del frontend o del repo
  ✗ URLs públicas de fotos — siempre presigned con expiración
  ✗ Commitear .env.local
  ✗ Login exitoso si perfil.activo === false

DATOS — errores de integridad:
  ✗ DELETE físico de registros — usar activo = false siempre
  ✗ Calcular total en el frontend — es columna generada en Postgres
  ✗ Enviar campos calculados (total, subtotal) desde formularios
  ✗ Servicios sin cliente_id y maquina_id válidos

CÓDIGO — errores de calidad:
  ✗ any en TypeScript
  ✗ @ts-ignore
  ✗ useEffect para fetch de datos (usar TanStack Query)
  ✗ Lógica de negocio dentro de componentes de UI
  ✗ Fetch manual a Supabase (usar siempre el SDK)
  ✗ Default exports en componentes (usar named exports)
```

---

*Última actualización: Marzo 2026*
*Diseño: Figma — 30 pantallas completas en archivo frBkEzrP4Ig2K4S5Bcmbaq*
*Cotización: $25,000 MXN · 60 días · serviciosran.com.mx*
*Desarrollador: Ing. Isidro Saúl Treviño Lopez*