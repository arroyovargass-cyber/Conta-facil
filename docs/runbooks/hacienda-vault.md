# Operación de la bóveda de Hacienda

Este incremento está verificado con material sintético local. No habilita XML,
firma fiscal, transmisión ni recepción. Las bandejas son revisiones internas.

## Puertas de habilitación

El perfil de inspección es `pkcs12-official-security-20261124`, definido en
`infra/openssl-inspector-profile.json`. Fija la revisión oficial OpenSSL
`906f55c2199f543702480c0499fb889df4fecb03`, versión **3.5.10-dev**.
Sigue siendo un snapshot de seguridad, no una publicación estable del proveedor.
El preparador comprueba la ascendencia de los doce parches oficiales revisados,
elimina únicamente sus directorios desechables de compilación/instalación y
compila desde cero. La atestación resultante relaciona perfil, revisión, versión
y SHA-256 del binario. Requiere confiar en la fuente y el sistema de build/despliegue;
no es una firma independiente que resista un servidor o artefacto comprometido.

Fuera de las pruebas automatizadas se admite exclusivamente ese perfil exacto,
con integridad comprobada **antes** de ejecutar el binario. La consulta de versión
y el parser reciben un entorno mínimo, sin claves de bóveda ni secretos de sesión.
Otros snapshots o modificaciones quedan bloqueados. No cambiar `NODE_ENV` para
eludir controles. La habilitación admite únicamente credenciales del ambiente
Hacienda de pruebas, bajo HTTPS y con raíz de bóveda independiente configurada.
Identidad tributaria, firma y transmisión siguen pendientes.

`HACIENDA_STAG_PROBE_ENABLED=false` es el valor predeterminado. La disponibilidad
operativa del IdP de STAG sigue sin confirmarse desde este entorno. Antes de
activarlo, reconfirmar los destinos/contrato oficiales y sus condiciones de
prueba. La aplicación no acepta URLs de proveedor enviadas por usuarios.

Fuentes: [OpenSSL 3.5, seguridad](https://openssl-library.org/news/vulnerabilities-3.5/index.html),
[PKCS12](https://docs.openssl.org/3.5/man1/openssl-pkcs12/),
[opciones de contraseña](https://docs.openssl.org/3.5/man1/openssl-passphrase-options/),
[Guía IdP de Hacienda](https://www.hacienda.go.cr/docs/Guia_IdP.pdf).

## Preparación local y build

Se requieren Node 24, Git, Perl, make y compilador C. `npm run openssl:prepare`
prepara el binario bajo `.local/openssl`; no modifica el del sistema. El build
comprueba el perfil y la integridad exactos y compila un worker separado. La
configuración de Render incluye esa preparación; el despliegue de activación
se verificó en el entorno publicado el 24/11/2026.

`npm run vault:local-keys` opera solo con configuración localhost. Agrega una
clave independiente cuando faltan ambas variables; preserva `.env` existente,
rechaza configuración parcial y no imprime claves. No incluir `.env` en Git,
ZIP, capturas, incidencias ni registros.

Variables del backend:

- `HACIENDA_KEYRING`: objeto JSON de identificador a 32 bytes en hexadecimal.
- `HACIENDA_ACTIVE_KEY_ID`: identificador usado para nuevos cifrados.
- `SESSION_KEY`: raíz diferente para sesiones; se rechaza reutilizarla en la bóveda.
- `HACIENDA_STAG_PROBE_ENABLED`: controla exclusivamente la prueba de acceso.

Sin keyring no hay sustituto aleatorio ni almacenamiento habilitado. Los
certificados, PIN y claves de API son valores distintos y no se devuelven.

## Copias, rotación y recuperación

Guardar por canales separados una copia de la base cifrada y las raíces de
bóveda necesarias. Conservar contexto de empresa/ambiente/versión/tipo y key_id:
el cifrado autenticado rechaza cambiar cualquiera de esos valores. Las raíces
no pertenecen al respaldo de código fuente. Un respaldo de base sin sus raíces
no permite recuperar secretos; perderlas los vuelve ilegibles.

Para rotar, incorporar la nueva raíz al keyring, mantener las anteriores que
necesiten las credenciales activas y cambiar el ID activo mediante el canal de
secretos del servidor. Reiniciar de forma controlada. Las nuevas versiones
usan la raíz nueva; no se reescribe el historial. Conservar por separado las
raíces históricas para restauración; no borrar una raíz mientras algún registro
que deba recuperarse dependa de ella. La implementación carga hasta diez raíces
simultáneamente; gestionar la retención de raíces antiguas de forma segura antes
de exceder ese límite.

La prueba `credential-vault.test.ts` restaura un ciphertext serializado con un
keyring suministrado por separado, y comprueba el fallo si falta la raíz
anterior. La integración lee una versión guardada antes de cambiar la raíz
activa y rechaza ciphertext manipulado. Esto no sustituye un simulacro completo
de restauración de PostgreSQL/hosting, que sigue pendiente para producción.

Desactivar en Conta Fácil conserva el historial y evita usar la versión activa.
**No revoca la llave ni las credenciales ante Hacienda.** La revocación oficial
se gestiona en su servicio correspondiente.

## Permisos y comportamiento

Hacienda exige membresía activa con alcance de empresa, MFA y el permiso
específico. Consultar metadatos requiere `hacienda.read`; gestionar incluye esa
lectura al crear roles personalizados. La prueba de conexión exige además
`hacienda.connection.test` y `hacienda.read`, pues retorna configuración pública.
Los responsables departamentales de CxC/CxP no reciben acceso a Hacienda.

Carga: JSON máximo 3 MiB, PKCS12 máximo 2 MiB, Base64 canónico. El PIN se conserva
sin recortar y admite hasta 1023 bytes UTF-8; NUL/CR/LF se rechazan para evitar
truncamiento del lector por descriptor de OpenSSL. No se exige que una llave
importada use el formato de generación nuevo en lugar de un PIN legado válido.
El inspector exige MAC, llave RSA 2048/4096, un certificado coincidente vigente
y prueba local de firma/verificación. No infiere identificación tributaria del
Subject. La identidad permanece pendiente.

La carga permite cinco intentos por empresa y diez por usuario en quince
minutos; la prueba de acceso cinco por empresa y usuario. Hay dos inspectores
en ejecución y cuatro en espera. Un conflicto 409 exige recargar revisión; no
reenviar automáticamente contra una versión nueva. Un fallo de PIN conserva la
versión anterior. No copiar valores sensibles al reportar errores.

La conexión comprueba autenticación y cierre de sesión por separado. Un cierre
no confirmado se muestra como tal. Autenticarse no significa que Hacienda haya
aceptado comprobantes. Las respuestas tardías de versiones sustituidas o
sesiones revocadas se descartan antes de guardar el estado.

El workflow serializa por empresa con un bloqueo que permite los KEY SHARE de
las claves foráneas de auditoría. Una edición concurrente del origen concluye y
el solicitante con versión anterior recibe 409; debe recargar y revisar.

## Bandejas departamentales

El alta de destinos es explícita y reutiliza nombres activos; no reactiva
usuarios/departamentos ni amplía membresías. Solo los permisos de configuración
permiten cambiar rutas. Los gestores del destino pueden consultar responsables
elegibles únicamente de su departamento autorizado.

Asignar conserva el departamento original del borrador y comparte solo un
resumen. Repetir la solicitud no duplica tareas. Cambiar una ruta afecta futuras
asignaciones; las históricas conservan su destino. Antes de desactivar un
departamento con ruta habilitada, cambiar o deshabilitar esa ruta. Las tareas
requieren revisar de nuevo cuando cambia la versión del origen. Resolver una
tarea no produce aceptación tributaria ni crea una deuda.

CxP permanece vacío hasta incorporar recepción validada de XML. No introducir
facturas ficticias ni interpretar esa bandeja como inexistencia de obligaciones.

Desactivar un destino retira el acceso de usuarios limitados a ese departamento,
aunque se conserven sus asignaciones históricas. Los permisos explícitos de toda
la empresa mantienen consulta/gestión histórica conforme a su autorización.
