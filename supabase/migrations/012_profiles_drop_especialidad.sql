-- Quita campo no utilizado para técnicos.
alter table if exists public.profiles
  drop column if exists especialidad;
