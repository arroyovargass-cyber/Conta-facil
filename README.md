# Conta Fácil · Fase 1

Base funcional de administración multiempresa para Costa Rica. **Desarrollo local; no está certificada ni lista para producción.** No emite comprobantes, no firma XML y no se conecta a Hacienda.

## Ejecutar

Requisitos: Node.js 24, npm, Docker Compose y espacio para las imágenes PostgreSQL/Supabase. Desde este directorio:

```bash
npm ci
npm run local:up
npm run db:migrate
npm run bootstrap < empresa-inicial.json
npm run dev
```

Abrir http://localhost:5173. El correo de prueba está en http://localhost:54324. Abre la invitación del administrador, confirma el correo, define identificación y contraseña y configura TOTP. No hay contraseña ni usuario predeterminado.

`empresa-inicial.json` contiene datos de alta, **sin contraseña**:

```json
{"email":"administracion@empresa.test","name":"Administración","legal_name":"Empresa de prueba","trade_name":"Mi empresa","identification_type":"other","identification":"PRUEBA-001","platform_operator":false}
```

El comando es una operación administrativa; no lo repitas para la misma empresa sin revisar el resultado. Para crear otra empresa se usa el mismo comando con sus propios datos y administrador. Una cuenta existente se invita a otra empresa desde la administración de esa empresa. El alta por bootstrap con email ya registrado requiere gestión administrativa explícita; no restablece cuentas existentes.

`local:env` genera secretos aleatorios locales en `.env` (ignorado y con permisos 0600); nunca uses los valores ni las contraseñas de Compose en producción. Mailpit captura correo local: no entrega correos externos. Usa `local:down` para detener sin borrar el volumen.

## Verificar

```bash
npm test
npm run test:db
npm run typecheck
npm run build
```

Las pruebas integradas requieren la base y Auth locales activos, generan usuarios/empresas sintéticos únicos y dejan esos datos para inspección. `test:db` requiere pgTAP instalado en PostgreSQL; con Supabase local completo usa también `supabase test db`. La imagen PostgreSQL Alpine del Compose normal no incluye pgTAP: las pruebas HTTP/Auth/Data API sí funcionan; usa un PostgreSQL con pgTAP o el entorno restringido documentado para las nueve pruebas SQL.

Las pruebas **no deben ejecutarse contra producción**. No hay pruebas tributarias porque esta fase no calcula ni emite comprobantes.

## Funciones

- Identificación y contraseña con Supabase Auth, recuperación, sesiones opacas con tokens cifrados, límite compartido de intentos y TOTP administrativo.
- Empresas autorizadas, permisos y alcance departamental con RLS, verificados en servidor y en acceso directo a Data API.
- Usuarios, invitaciones por correo, roles de consulta personalizados y revocación de membresías.
- Departamentos, centros de costos, sucursales, terminales, actividades y configuración tributaria separada por ambiente, siempre como borrador.
- Auditoría transaccional de cambios sin contenido sensible y sin permisos de modificación para usuarios.
- Interfaz en español adaptable, con indicadores de configuración reales. Los módulos fiscales futuros aparecen como pendientes.

## Documentación

- [Diseño aprobado](docs/superpowers/specs/2026-11-09-conta-facil-fase-1-design.md)
- [Plan](docs/superpowers/plans/2026-11-09-conta-facil-fase-1.md)
- [Evidencia y límites](docs/runbooks/phase1-evidence.md)
- [Seguridad](docs/runbooks/security.md)
- [Decisiones y revisión independiente](docs/runbooks/decisions-and-review.md)
- [Entorno restringido](docs/runbooks/local-setup.md)
- [Respaldo y recuperación](docs/runbooks/backup-restore.md)

No se publicó una interfaz aislada: el despliegue funcional necesita API Node, Supabase, SMTP, HTTPS y gestión de secretos configurados. No se crearon recursos externos ni servicios de pago.

## Despliegue de pruebas aprobado

La preparación para **Render Free + Supabase Free** está en [esta guía](docs/deployment/render-supabase.md) y `render.yaml`. El build genera web y backend; `npm start` sirve ambos desde el mismo dominio. Se añadieron migraciones para el rol limitado del backend y el refuerzo de permisos/RLS en Supabase alojado. La publicación solo se declara completada después de verificar el servicio remoto y su URL; el build local no la sustituye.

El proyecto independiente **Conta Fácil Pruebas** ya está creado en Supabase Free y su esquema está instalado. Ver [evidencia remota](docs/deployment/supabase-provisioning-evidence.md). La aplicación web aún requiere publicación en Render y configuración de secretos.

El README inicial del repositorio GitHub se conserva en [esta referencia](docs/reference/github-initial-readme.md). Su commit original permanece en el historial integrado.
