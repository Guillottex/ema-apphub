# Base de datos de la plataforma

* `migrations/` — DDL versionado. El backend aplica al iniciar las migraciones pendientes (tabla `schema_migrations`, con bloqueo para evitar ejecuciones concurrentes). Para agregar cambios cree `002_descripcion.sql`; nunca modifique una migración ya aplicada.
* `seeds/` — roles y permisos (idempotente, se ejecuta en cada arranque). El Super Administrador inicial se crea desde las variables `ADMIN_*` si la tabla `users` está vacía.

Ejecución manual: `docker compose exec backend node dist/db/migrate.js`
