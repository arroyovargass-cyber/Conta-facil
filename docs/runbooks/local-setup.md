# Entorno local y entorno restringido

## Camino normal

`npm ci`, `npm run local:up`, `npm run db:migrate`, bootstrap por stdin y `npm run dev`. Compose usa imágenes oficiales fijadas, credenciales de desarrollo y puertos publicados solo en loopback. No abrir estos servicios a Internet. Cambiar `APP_ORIGIN` y URLs de redirección juntos si se usa otro host. La API exige coincidencia exacta de Origin.

Supabase CLI 3.1.0 está fijado. Revisar `supabase --help` y ayuda del subcomando antes de operaciones CLI. El destino de los scripts propios de migración/pruebas se restringe a loopback. Para Supabase alojado usar un proyecto identificado y el flujo de migraciones revisado; no ejecutar estos scripts con credenciales remotas.

## Camino utilizado en este workspace

El daemon Docker usa VFS y su red está separada del executor. La imagen Supabase PostgreSQL agotó espacio; Alpine también duplicó demasiadas capas. No se alteró el daemon ni se instaló software del sistema.

Se descargaron y extrajeron bajo `.local/pg/root` estos paquetes oficiales de Debian trixie: PostgreSQL 17.11, cliente 17.11 y pgTAP 1.3.3. El índice de Debian es https://deb.debian.org/debian/dists/trixie/main/binary-amd64/Packages.xz. PostgreSQL se ejecuta como usuario ordinario con datos en `.local/pg/data`. Los binarios estáticos Auth 2.197.0, PostgREST 16.5 y Mailpit 1.31.3 se extrajeron de las imágenes oficiales fijadas en Compose.

El launcher `infra/start-local.mjs` usa esos binarios. Está destinado únicamente a esta alternativa, no sustituye la instalación normal con Docker Compose. No ejecutarlo si los puertos están ocupados: no detecta salud ni reemplaza procesos anteriores. Los logs y PID quedan en `.local` (ignorado). Para detener, verificar proceso y comando del PID antes de enviar SIGTERM; no matar procesos por número de un archivo viejo sin comprobarlos.

El gateway HTTP de desarrollo escucha en 127.0.0.1:54321 y enruta `/auth/v1/` a Auth y `/rest/v1/` a PostgREST. No tiene autenticación de gateway adicional: las firmas JWT y RLS se verifican por los servicios. Es exclusivamente local. La API nunca entrega tokens al frontend.

PostgreSQL puede reiniciarse con `.local/pg/root/usr/lib/postgresql/17/bin/pg_ctl -D .local/pg/data -l /tmp/conta-postgres.log start`. Se cambió su socket a `/tmp`; el socket predeterminado de Debian no existe aquí. Tras las pruebas se restringirá TCP a loopback, ya que ya no se conecta ningún contenedor.

El directorio `.local`, `.env`, datos, respaldos y certificados de sesión no pertenecen al código distribuible. No subirlos a Git ni compartirlos como ejemplo. El arranque normal de Compose completo no se pudo verificar en este executor; se verificaron los mismos componentes como procesos locales.

## Herramienta XSD de diagnóstico

Antes de ejecutar la suite que incluye el nuevo worker: `npm run xml:prepare`
(Python 3.10+ y Linux). Instala un venv privado con wheels fijados por hash.
`npm run test:xml-validator` ejecuta sus pruebas propias. Ver
[alcance y límites del motor](../development/xml-xsd11-evidence.md).
El servicio publicado actual no utiliza este worker; no se requiere cambiar
sus secretos ni instalar Python en Render para mantener la versión vigente.
