# Custodia y rutas documentales: evidencia del incremento local

Fecha: 2026-11-16. Rama: `feat/fase-1`. Base: `501c6af`.

## Implementado

- Bóveda AES-256-GCM, IV aleatorio y contexto autenticado por empresa,
  ambiente, versión y tipo de secreto. Claves independientes de las sesiones;
  lectura de versiones previas durante rotación.
- Inspector PKCS#12 en worker desechable y proceso OpenSSL separado. Verifica
  MAC/PIN, llave RSA de 2048/4096 bits, certificado coincidente y vigente,
  y firma/verificación local. Retorna únicamente metadatos públicos. La identidad
  tributaria continúa pendiente; esto no verifica una firma fiscal XAdES.
- Límites de entrada, salida, tiempo y admisión: dos workers, cuatro en cola.
  Los PIN no se recortan. Se rechazan NUL/CR/LF y más de 1023 bytes UTF-8 para
  impedir truncamiento silencioso del lector de contraseña de OpenSSL.
- Scripts de preparación del inspector y generación local opcional de claves.
  El build verifica que el inspector requerido existe. La configuración de
  Render incluye preparación explícita; no se desplegó.
- Dos migraciones aplicadas exclusivamente a PostgreSQL local: metadatos y
  versiones cifradas privadas; rutas por empresa; tareas con resumen mínimo,
  sin importes ni líneas; permisos propios y RLS por destino.
- Restricciones sobre empresa, origen real, versión, ruta habilitada,
  departamento activo y elegibilidad del responsable sin exigirle sesión abierta.
  Los cambios del borrador invalidan la versión revisada de su tarea.
- Nuevos permisos inicialmente solo para administradores y seleccionables en
  roles personalizados; gestionar credenciales incluye `hacienda.read`.

## Verificación

- Suite completa tras correcciones y última regresión: 97 pruebas aprobadas;
  archivo de seguridad de Hacienda/rutas 8/8.
- pgTAP: 9/9 aprobadas.
- Navegador: 30/30 aprobadas en escritorio y móvil.
- TypeScript y build con servidor y worker compilados: correctos.
- Generador local de claves: preservación, idempotencia, permisos 0600 y rechazo
  de configuración parcial comprobados en archivos temporales.
- Revisión independiente de código, con segunda revisión de las correcciones:
  sin hallazgos críticos/importantes pendientes para esta base. No constituye
  revisión ni aprobación del módulo completo.

Se reprodujeron y corrigieron cuatro familias de fallos: aceptación de PKCS#12
sin MAC, truncamiento del PIN por OpenSSL, referencias al origen por departamento
simulado y rutas/responsables no elegibles. Las pruebas de regresión fallaron
antes de aplicar las correcciones y pasaron después.

## Límites y trabajo siguiente

Las tareas 1–2 del plan tienen este avance; quedan pruebas negativas extendidas
(fecha futura/expiración, contenedores ambiguos y límites extremos de ejecución)
y revisión de preparación para material real. Las tareas 3–7 siguen pendientes:
API de registro/desactivación de credenciales, adaptador IdP, asignación y gestión
de tareas, pantallas Hacienda/CxC/CxP y validación integral de esos flujos.

No hay endpoint de carga de credenciales ni conexión real de Hacienda habilitada.
El binario local usa el snapshot oficial **3.5.10-dev** del commit
`84dda7853c130429210b37bee9e5b62366ca8bce`, no una versión estable validada para
producción. Antes de recibir llaves reales se deben comprobar los parches
aplicables y la instalación objetivo. Solo se usó material sintético.

No se generaron/firman/transmitieron XML tributarios, no se recibieron facturas
reales, no se declararon aceptaciones de Hacienda ni se implementaron saldos,
cobros o pagos. CxP sigue sin fuente de comprobantes recibidos.

Sin cambios remotos en Supabase/ContaNova, publicación, push, merge o despliegue.
