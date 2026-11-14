# Conta Fácil · Fase 2B1

Administración multiempresa, clientes, productos y borradores comerciales para Costa Rica. **Desarrollo local; no está certificada ni lista para producción.** No emite comprobantes, no firma XML y no se conecta a Hacienda.

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

Las pruebas **no deben ejecutarse contra producción**. Los cálculos son comerciales y exactos, antes de impuestos; no se verifica todavía emisión tributaria.

## Funciones

- Vista previa explícita de IVA general13% para borradores CRC, al contado, sin descuentos/exoneraciones. No modifica documentos ni confirma la tarifa legal de un CABYS. Bloquea valores que requieren redondeo y separa cifras de impedimentos fiscales.

- Clientes y productos/servicios por empresa, desactivación y control de versiones.
- Borradores por departamento, copias históricas, subtotal decimal exacto, idempotencia, edición y archivo/restauración. Sin validez tributaria.

- Identificación y contraseña con Supabase Auth, recuperación, sesiones opacas con tokens cifrados, límite compartido de intentos y TOTP administrativo.
- Empresas autorizadas, permisos y alcance departamental con RLS, verificados en servidor y en acceso directo a Data API.
- Usuarios, invitaciones por correo, roles de consulta personalizados y revocación de membresías.
- Departamentos, centros de costos, sucursales, terminales, actividades y configuración tributaria separada por ambiente, siempre como borrador.
- Auditoría transaccional de cambios sin contenido sensible y sin permisos de modificación para usuarios.
- Interfaz en español adaptable, con indicadores de configuración reales. Los módulos fiscales futuros aparecen como pendientes.

## Documentación

- [Diseño Fase 2B1](docs/superpowers/specs/2026-11-14-conta-facil-fase-2b1-design.md)
- [Plan Fase 2B1](docs/superpowers/plans/2026-11-14-conta-facil-fase-2b1.md)
- [Evidencia Fase 2B1](docs/development/phase2b1-evidence.md)
- [Diseño Fase 2A](docs/superpowers/specs/2026-11-14-conta-facil-fase-2a-design.md)
- [Plan Fase 2A](docs/superpowers/plans/2026-11-14-conta-facil-fase-2a.md)
- [Evidencia y límites Fase 2A](docs/development/phase2a-evidence.md)

- [Diseño aprobado](docs/superpowers/specs/2026-11-09-conta-facil-fase-1-design.md)
- [Plan](docs/superpowers/plans/2026-11-09-conta-facil-fase-1.md)
- [Evidencia y límites](docs/runbooks/phase1-evidence.md)
- [Seguridad](docs/runbooks/security.md)
- [Decisiones y revisión independiente](docs/runbooks/decisions-and-review.md)
- [Entorno restringido](docs/runbooks/local-setup.md)
- [Respaldo y recuperación](docs/runbooks/backup-restore.md)

No se publicó una interfaz aislada: el despliegue funcional necesita API Node, Supabase, SMTP, HTTPS y gestión de secretos configurados. Existe un proyecto separado de Supabase de pruebas; la aplicación todavía no está publicada en línea. No se añadieron servicios de pago en esta fase.

## Despliegue de pruebas aprobado

La preparación para **Render Free + Supabase Free** está en [esta guía](docs/deployment/render-supabase.md) y `render.yaml`. El build genera web y backend; `npm start` sirve ambos desde el mismo dominio. Se añadieron migraciones para el rol limitado del backend y el refuerzo de permisos/RLS en Supabase alojado. La publicación solo se declara completada después de verificar el servicio remoto y su URL; el build local no la sustituye.

El proyecto independiente **Conta Fácil Pruebas** ya está creado en Supabase Free y su esquema está instalado. Ver [evidencia remota](docs/deployment/supabase-provisioning-evidence.md). La aplicación web aún requiere publicación en Render y configuración de secretos.

El README inicial del repositorio GitHub se conserva en [esta referencia](docs/reference/github-initial-readme.md). Su commit original permanece en el historial integrado.

## Mejoras funcionales y pruebas de navegador

Se cerraron los pendientes de sesión entre pestañas, logout vencido y búsqueda de servidor. Las actividades se actualizan después de guardar y las respuestas tardías se descartan al cambiar de vista, empresa o usuario. Ver [evidencia](docs/development/phase1-closure-evidence.md).

`npm run test:browser` ejecuta Chromium contra la aplicación compilada y servicios locales reales. Requiere Chromium en `/usr/bin/chromium`, otro ejecutable indicado por `CHROMIUM_PATH`, o el navegador instalado de Playwright. El runner no usa datos remotos y guarda resultados/capturas en `.local/`. Última batería: 50 pruebas de aplicación, 9 SQL y 10 de navegador aprobadas.
