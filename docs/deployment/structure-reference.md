# Conta Fácil: proyecto independiente y referencia de ContaNova

Decisión del usuario: 2026-11-14. Se descarta el enlace operativo con ContaNova. Su revisión de estructura sirve como referencia; no se importan datos, usuarios, credenciales, permisos ni migraciones de ese proyecto.

## Ideas reutilizables

| Estructura observada en ContaNova | Aplicación en Conta Fácil | Etapa |
| --- | --- | --- |
| empresas | tenants como entidad central; cada registro empresarial lleva tenant_id | Fase 1 |
| usuarios | Supabase Auth para identidad y profiles para datos de usuario | Fase 1 |
| usuario_empresa | memberships como autorización explícita, con roles y alcance departamental | Fase 1 |
| cuentas | catálogo de cuentas por empresa enlazado al mismo tenant_id, sin crear otra entidad de empresa | Fase 5 |
| asientos y asiento_detalle | futura separación cabecera/líneas, con referencia al comprobante fuente y la empresa | Fase 5 |
| saldos_iniciales | futura apertura contable con trazabilidad; no sustituye documentos ni auditoría | Fase 5 |

La estructura observada permite reconocer relaciones generales; no prueba que sus políticas de seguridad, validaciones o reglas contables sean correctas. No se copiarán sin revisión. Conta Fácil mantiene sus controles ya implementados: RLS, autorización en backend, relaciones compuestas por empresa y pruebas de aislamiento.

## Prioridad de desarrollo

Cerrar la base multiempresa y desplegarla para pruebas. Después completar y validar emisión 4.4, recepción y mensajes del receptor. La contabilidad permanece aplazada hasta superar esas etapas. Estas ideas no agregan tablas contables ni cambian la facturación en esta entrega.

## Estado real

- No se aplicó ninguna de las tres migraciones de Conta Fácil en ContaNova; la revisión automática bloqueó el primer intento y no se reintentó por otro canal.
- ContaNova fue reactivado durante su evaluación y se deja en su estado actual. No se pausa ni elimina como parte de este cambio de dirección.
- El nuevo proyecto todavía no se ha creado: falta elegir la organización y comprobar el costo cero.
- Render sigue pendiente de conexión; la sesión GitHub anterior no permitía crear el repositorio privado. Son requisitos separados de la base de datos.
