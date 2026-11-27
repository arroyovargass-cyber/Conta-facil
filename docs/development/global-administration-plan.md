# Administración global de Conta Ágil

Base revisada: `db177b1`. Graphify indexa ese commit; sus resultados SQL históricos
se contrastan con las funciones vigentes en Supabase y con el árbol de trabajo.

## Decisiones y alcance

La solicitud del propietario define el diseño: `SUPER_ADMIN_GLOBAL` reside en
el registro privado de operadores ya existente, vinculado al usuario autenticado.
No se crea otro catálogo de administradores ni se codifica una cuenta en el
frontend. La autoridad global funciona sin membresía empresarial, exige sesión
válida y MFA y solo admite permisos registrados. Se conservan los permisos y
las restricciones departamentales de los usuarios ordinarios.

Se corrigen los puntos que aún exigen membresía: listados/edición de empresas,
RLS central, catálogos, Hacienda, bandejas y autorización del trabajador. La
responsabilidad nominal de una bandeja sigue siendo una asignación empresarial,
distinta de la autoridad del propietario para administrarla. No se alteran sus
relaciones ni el historial fiscal. Se conserva la membresía auxiliar que el alta
existente asigna al creador; la autoridad global no depende de ella.

El alta inicializa de forma atómica la configuración general existente,
sucursal/terminal propias, departamentos de facturación/CxC/CxP y parámetros en
estado pendiente. No confirma numeración de emisión, régimen fiscal, impuestos,
credenciales ni inscripción. No implementa contabilidad, estados financieros,
proveedores ni recepción automática todavía ausentes.

## Ejecución y verificación

- [x] Reproducir falta de acceso global con cuenta local MFA sin membresías;
      comparar con Supabase alojado en modo de solo lectura.
- [x] Añadir pruebas de sesión/rol, acceso a empresa existente/nueva, edición,
      catálogo, borradores, configuración independiente e inicialización/reintentos.
- [x] Añadir migraciones aditivas sobre operadores y helpers existentes; verificar
      que usuarios secundarios no puedan promoverse ni modificar el rol global.
- [x] Corregir consultas de servidor y exponer el rol de la cuenta desde sesión;
      conservar validaciones y componentes, sin rediseñar pantallas.
- [x] Probar lectura/escritura autorizada, rechazos cruzados, MFA, revocación,
      cierre/reingreso y trabajador con el rol restringido sin USAGE en `auth`.
- [x] Probar botones en navegador con empresas sintéticas; no enviar a Hacienda.
- [x] Ejecutar regresiones, build y SQL/RLS; actualizar AGENTS.md e informe de
      resultados, con módulos pendientes y límites de la comprobación remota.

La solicitud autoriza el rol del propietario. Las pruebas de escritura se hacen
localmente. Cualquier publicación o aplicación remota adicional se prepara como
resultado concreto y revisable antes de solicitar autorización específica.
