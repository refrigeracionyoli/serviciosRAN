-- seed.sql
-- Datos de prueba para desarrollo local
-- NOTA: Solo ejecutar en entorno de desarrollo, NUNCA en producción

-- Los usuarios se crean desde Supabase Auth Dashboard o con la CLI:
-- supabase auth admin create-user --email ran.patytorres@hotmail.com --password <password>
-- supabase auth admin create-user --email ran.hiramq@gmail.com --password <password>

-- El trigger on_auth_user_created crea los profiles automáticamente.
-- Después hay que actualizar los roles manualmente:
-- update profiles set role = 'admin', nombre = 'Patricia Torres Saucedo' where correo = 'ran.patytorres@hotmail.com';
-- update profiles set role = 'tecnico', nombre = 'Hiram Quintanilla' where correo = 'ran.hiramq@gmail.com';
-- update profiles set role = 'tecnico', nombre = 'José Jaime Gatica Beltrán' where correo = 'jjaime.gbeltran@hotmail.es';
-- update profiles set role = 'tecnico', nombre = 'Mario Alberto Martínez Robles' where correo = 'setromtz@gmail.com';

-- Algunos clientes Six de prueba
insert into clientes (codigo_cliente, nombre, direccion, municipio, telefono) values
  ('300831815', 'Tkt Six Centenario', 'Av. Centenario 123', 'Monterrey', '81-1234-5678'),
  ('300831816', 'Tkt Six San Pedro', 'Blvd. Antonio L. Rodríguez 456', 'San Pedro Garza García', '81-2345-6789'),
  ('300831817', 'Tkt Six Apodaca', 'Calle Industrias 789', 'Apodaca', '81-3456-7890'),
  ('300831818', 'Tkt Six Guadalupe', 'Av. Benito Juárez 321', 'Guadalupe', '81-4567-8901')
on conflict (codigo_cliente) do nothing;
