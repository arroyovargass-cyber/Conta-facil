# Fase 2B1 — vista previa exacta de IVA y diagnóstico fiscal

Fecha:2026-11-14. Desarrollo local, sin publicación ni emisión fiscal. No requiere migraciones, nuevas dependencias, certificados ni credenciales de Hacienda.

## Comportamiento implementado

Desde un borrador guardado, «Vista previa de impuestos» permite confirmar el escenario de factura nacional CRC/al contado/IVA general13%, sin descuentos/exoneraciones/otros impuestos. El backend usa únicamente cabecera y líneas persistidas con autorización de lectura. No cambia documentos, versiones, archivos ni auditoría comercial.

El cálculo exacto admite resultados representables en cinco decimales. Cantidades deben tener hasta tres decimales significativos:0.10000 es0.1, mientras0.00001 queda bloqueado. Importes por línea y acumulados no exceden9999999999999.99999. No usa flotantes, truncamiento ni redondeos no confirmados. Si alguna línea queda fuera del perfil, no entrega totales parciales.

Ejemplo reproducible: precio1000 y cantidad1 → baseCRC1000, IVA130, total1130. Precio0.2 y cantidad0.1 → base0.02, IVA0.0026,total0.0226. Base0.00001 requiere más precisión para IVA y genera `ROUNDING_POLICY_PENDING`. El cero comercial se calcula matemáticamente, sin certificar tratamiento de regalías u operaciones gratuitas.

Los resultados se separan de los impedimentos fiscales: esquema pendiente de revisión, firma ausente, XML inhabilitado, perfil estructurado/actividad/clasificación sin confirmar e identificación comercial incompleta o pendiente de verificación. Un CABYS libre o una identificación escrita no certifican clasificación/inscripción. No se consulta configuración tributaria ni catálogo para ampliar permisos del lector.

Los lectores autorizados pueden calcular incluso archivados, sin permiso de gestión ni MFA adicional al exigido por sus roles. La ruta conserva sesión, Origin, CSRF y RLS. Objetos ajenos404, versión antigua409, contrato/perfil/confirmación inválidos400. USD genera diagnóstico bloqueado; nunca se convierte a CRC.

## Consistencia y experiencia

Una sola sentencia SQL recupera versión, cabecera y líneas de la misma instantánea, con cantidad/precio convertidos a texto antes del JSON. El navegador nunca envía totales para que el servidor los acepte.

El panel se invalida al editar, abrir otro borrador, cerrar, guardar o cambiar de empresa/sesión. Una generación del editor y el control de montaje descartan respuestas tardías, incluidos errores409 antiguos. Cambios locales sin guardar bloquean el cálculo;409 conserva el formulario y ofrece recarga explícita. La confirmación es temporal. No hay formulariosHTML anidados ni controles fiscales dentro del fieldset deshabilitado para lectores.

## Verificación ejecutada

- Aplicación:81 pruebas aprobadas (21 archivos), incluidas seis del motor y siete nuevas de HTTP/Auth/RLS.
- PostgreSQL: nueve aserciones pgTAP aprobadas; no se alteró el esquema en este incremento.
- Build: TypeScript, frontend Vite y backend compilados correctamente.
- Navegador:30 casos aprobados (15 por tamaño), incluidos22 de fases anteriores y ocho del nuevo panel; dos casos adicionales de recaptura del panel aprobados. Chromium escritorio/Pixel7 emulado; no equivale a teléfono físico ni auditoría completa de accesibilidad.

Se observó RED por módulo de dominio ausente y por nueva ruta404; posteriormente pasaron las pruebas correspondientes. El panel ausente produjo siete fallos de navegador observados antes de su disponibilidad; el último caso móvil de409 se ejecutó después de actualizar los recursos compilados y ya pasó. La verificación final usa el árbol completo estable.

Los casos de integración comprueban lector departamental sin `tax.read`/gestión, empresas/departamentos distintos, revocación, sesión/CSRF/Origin, contrato estricto, archivados, decimales, ausencia de efectos comerciales y cabecera/líneas coherentes bajo cambios concurrentes. Los casos de navegador incluyen confirmación, precisión/USD, lectura, campos sin guardar, accesibilidad por teclado y respuestas retenidas al modificar/cambiar editor/empresa.

La suite de navegador restaura el contador del IP local después del grupo nuevo mediante el setup existente, protegido por localhost; evita agotar el límite real de30 accesos al sumar escenarios. No cambia el límite del producto. Las pruebas de integración de rate limit siguen activas.

## Revisión independiente

Un revisor independiente (`gpt-6-astra`) inspeccionó el rango `40149a7..35b89b4` contra diseño, plan, ledger y los cinco focos de revisión, sin modificar archivos. No encontró hallazgos críticos, importantes ni menores; no hubo correcciones ni observaciones diferidas. Destacó instantánea SQL única, cantidades/precios como texto, aritmética exacta y límites, ausencia de totales parciales, lectura departamental sin ampliación tributaria y generaciones de editor.

El revisor no certificó legalidad del perfil/CABYS/redondeo/vigencia del XSD, infraestructura productiva, repetición independiente de las suites ni documentos/artefactos de cierre posteriores a su rango. Son límites aceptados: la fiscalidad y publicación continúan bloqueadas, las pruebas fueron ejecutadas por el implementador y los artefactos se auditan al cerrar. Este dictamen no constituye certificación tributaria ni aprobación para producción.

## Decisiones y límites

- Se conserva la rama y ejecución directa aprobadas. No se publican cambios ni se modifica ContaNova/Supabase remoto.
- El contador de acceso se restablece solo para fixtures locales del grupo de navegador. Coste: esas pruebas UI no miden agotamiento del contador; la integración específica sí lo verifica.
- La consulta fiscal no persiste eventos comerciales ni demanda permisos de gestión: su único efecto de infraestructura es el control de sesión ya existente. La confirmación no se conserva y debe repetirse al reabrir.
- XML, firma, transmisión y verificación normativa quedan bloqueados explícitamente. La vista previa no determina si el IVA13% corresponde legalmente al producto.

Para el siguiente incremento siguen pendientes confirmar el XSD vigente/dependencias, política de redondeo, campos fiscales estructurados y catálogos; ver [matriz normativa](phase2b-normative-matrix.md). La aplicación sigue local: el último estado documentado de publicación es403 de escritura de GitHub y Render sin conectar. No se reintentó publicación durante esta entrega.

## Artefactos y auditoría

Capturas del panel con datos ficticios, sin QR, credenciales o tokens. ZIP de fuente con package.json/render.yaml en raíz; no incluye .env, .local, .superpowers, node_modules ni salidas de build. Se verifican los valores actuales de secretos locales contra archivos publicables, además de `git diff --check`.
