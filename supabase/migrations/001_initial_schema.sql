-- ─────────────────────────────────────────────────────────────
-- 001_initial_schema.sql
-- Esquema principal de Servicios RAN
-- ─────────────────────────────────────────────────────────────

-- PERFILES (extiende auth.users de Supabase)
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

-- CLIENTES (establecimientos Six)
create table clientes (
  id              bigserial   primary key,
  codigo_cliente  text        not null unique,
  nombre          text        not null,
  direccion       text,
  municipio       text,
  telefono        text,
  correo_contacto text,
  activo          boolean     not null default true,
  created_at      timestamptz not null default now()
);

-- MÁQUINAS
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

-- PÓLIZAS
create table polizas (
  id            bigserial   primary key,
  cliente_id    bigint      not null references clientes,
  maquina_id    bigint      not null references maquinas,
  activa        boolean     not null default true,
  fecha_inicio  date        not null,
  observaciones text,
  created_at    timestamptz not null default now()
);

-- SERVICIOS (órdenes de trabajo)
create table servicios (
  id                  bigserial    primary key,
  orden               bigint       unique,
  aviso               bigint,
  clase_orden         text,
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

-- CIERRES DE SERVICIO (datos de cierre para Heineken)
create table cierres (
  id              bigserial   primary key,
  servicio_id     bigint      not null references servicios unique,
  aviso           bigint,
  parte_objeto    text,
  causa           text,
  descripcion     text        not null,
  costo_total     numeric(10,2),
  tecnico_id      uuid        references profiles,
  firma_receptor  text,
  created_at      timestamptz not null default now()
);

-- MANTENIMIENTOS DE PÓLIZA (preventivos — sin orden SAP)
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

-- INVENTARIO (catálogo de refacciones)
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

-- REFACCIONES POR SERVICIO / MANTENIMIENTO
create table servicio_refacciones (
  id                bigserial    primary key,
  servicio_id       bigint       references servicios on delete cascade,
  mantenimiento_id  bigint       references mantenimientos_poliza on delete cascade,
  inventario_id     bigint       references inventario on delete set null,
  nombre_refaccion  text         not null,
  cantidad          integer      not null check (cantidad > 0),
  precio_unitario   numeric(10,2) not null,
  subtotal          numeric(10,2) generated always as (cantidad * precio_unitario) stored,
  constraint una_sola_referencia check (
    (servicio_id is not null)::int + (mantenimiento_id is not null)::int = 1
  )
);

-- INVENTARIO POR TÉCNICO (asignación diaria)
create table inventario_tecnico (
  id            bigserial    primary key,
  tecnico_id    uuid         not null references profiles,
  inventario_id bigint       not null references inventario,
  cantidad      integer      not null check (cantidad > 0),
  fecha         date         not null default current_date,
  created_at    timestamptz  not null default now(),
  unique (tecnico_id, inventario_id, fecha)
);

-- MOVIMIENTOS DE INVENTARIO (trazabilidad completa)
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

-- MÁQUINAS EN TALLER
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

-- EVIDENCIAS FOTOGRÁFICAS (referencia a Cloudflare R2)
create table evidencias (
  id            bigserial    primary key,
  servicio_id   bigint       not null references servicios on delete cascade,
  r2_key        text         not null,
  r2_bucket     text         not null default 'ran-evidencias',
  filename      text         not null,
  mime_type     text         not null default 'image/jpeg',
  size_bytes    integer,
  orden         integer      not null default 1,
  subida_por    uuid         references profiles,
  created_at    timestamptz  not null default now()
);

-- CATÁLOGO PEP DE HEINEKEN
create table catalogo_pep (
  id              bigserial   primary key,
  gz              text        not null,
  codigo_pep      text        not null,
  nombre_pep      text        not null,
  tipo_servicio   text        not null,
  activo          boolean     not null default true
);

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS updated_at automático
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_servicios_updated_at
  before update on servicios for each row execute function set_updated_at();

create trigger trg_profiles_updated_at
  before update on profiles for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Trigger: crear perfil automáticamente al registrar usuario
-- ─────────────────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, nombre, correo, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'tecnico')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
