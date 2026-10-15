# Forno Bello

Tienda web de pizzería hecha con React y Vite. Firebase Firestore sirve el catálogo y registra cada solicitud de pedido antes de abrir WhatsApp; el portal `/staff` permite al personal gestionar pedidos, catálogo, promociones, configuración y usuarios.

## Funcionalidades

- **Tienda (`/`)**: catálogo por categorías con búsqueda por nombre o referencia, precio por tamaño, carrito con costo de envío y envío gratis desde un mínimo, y checkout que guarda la solicitud en Firestore y continúa por WhatsApp con el detalle y el total estimado.
- **Portal del personal (`/staff`)**: inicio de sesión con correo y contraseña.
  - `seller` (vendedor): consulta y actualiza el estado de los pedidos y ve el catálogo con sus precios.
  - `admin` (administrador): además gestiona productos y sus precios por tamaño, categorías, promociones, la configuración de la tienda y los perfiles del personal.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/App.jsx` | Tienda pública. |
| `src/StaffPortal.jsx` | Portal del personal. |
| `src/firebase.js` | Acceso a Firestore y Authentication. |
| `src/pricing.js` | Precio de un producto según el tamaño. |
| `firestore.rules` | Reglas de seguridad de Firestore. |
| `catalogo.json` | Catálogo inicial y vista previa sin Firebase. |
| `functions/` | Script de carga del catálogo y Cloud Function opcional `createOrder`. |
| `tests/` | Pruebas de las reglas de seguridad. |
| `e2e/` | Pruebas de la aplicación con Playwright. |
| `public/_redirects` | Regla de rutas para Netlify. |

## Desarrollo local

1. Instala Node.js 22.12 o posterior.
2. Instala dependencias:

   ```bash
   npm install
   ```

3. Copia `.env.example` a `.env` y completa la configuración de la aplicación web de Firebase.
4. Inicia Vite:

   ```bash
   npm run dev
   ```

Sin variables Firebase, la tienda muestra el catálogo local como vista previa y no permite enviar solicitudes. Con Firebase configurado y las reglas publicadas, el cliente guarda en Firestore una solicitud pendiente y después abre WhatsApp. No se requiere App Check ni Blaze para este flujo.

## Pruebas

Las pruebas usan los emuladores de Firebase con un proyecto `demo-forno-bello`; nunca leen ni escriben en el proyecto real. Requieren Java 11 o posterior para el emulador de Firestore (`firebase-tools` 13 es la última versión compatible con Java 11).

```bash
npm run test:rules   # reglas de seguridad de Firestore
npm run test:e2e     # tienda y portal en Chromium, escritorio y móvil
```

- **Reglas (`tests/firestore.rules.test.mjs`)**: comprueban qué puede leer y escribir cada perfil (anónimo, usuario sin rol, vendedor, administrador y perfiles desactivados). Las pruebas marcadas como `todo` documentan riesgos conocidos que las reglas aún no cubren y no hacen fallar la ejecución.
- **Aplicación (`e2e/`)**: recorren la tienda y el portal con la compilación de producción contra los emuladores de Firestore y Auth. WhatsApp, imágenes y fuentes externas se simulan. La primera vez instala el navegador:

  ```bash
  npx playwright install chromium
  ```

  Si una prueba falla, el informe con capturas y trazas queda en `playwright-report/`.

Ejecuta ambas antes de publicar cambios en las reglas o en la aplicación. En Windows, `tests/run-with-emulators.mjs` cierra el proceso del emulador que `firebase-tools` deja abierto al terminar.

## Preparar Firebase

1. Habilita la API de Cloud Firestore y verifica la base de datos `default`. En el proyecto actual, la base existente está en `nam5` (multirregión de EE. UU.) y no se puede mover. La ubicación de una base nueva es irreversible.
2. Registra una aplicación web en el proyecto y copia sus valores `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` y `appId` al archivo `.env`. La configuración web es pública; la protección de datos se aplica con las reglas.
3. En Firebase Console, habilita Authentication con el proveedor correo/contraseña. Los clientes no crean cuenta. Como el personal se da de alta manualmente, se recomienda deshabilitar el registro público en **Authentication > Settings > User actions**.
4. Publica las reglas incluidas en este proyecto; Firestore Rules no requiere habilitar Blaze:

   ```bash
   npx firebase-tools login
   npx firebase-tools use --add
   npx firebase-tools deploy --only firestore:rules
   ```

   Las reglas permiten al público leer solo categorías, productos y promociones activas. Los clientes anónimos pueden crear solicitudes de pedido con campos limitados, pero no pueden leer, editar ni borrar pedidos. Solo `admin` puede gestionar catálogo, promociones, configuración y perfiles de personal. `seller` puede leer pedidos y el catálogo activo, y cambiar el estado de los pedidos.

   Una solicitud admite hasta 15 líneas distintas (producto y tamaño) y 50 unidades por línea, porque Firestore evalúa como máximo 1000 expresiones por petición. `MAX_ORDER_LINES` en `src/firebase.js` debe coincidir con `validOrderItems` en `firestore.rules`.

5. Crea el primer administrador. Crea la cuenta en Authentication y, desde Firebase Console, un documento en `usuarios/{UID}` con `email` (string), `nombre` (string), `rol` (`admin`), `activo` (true), `creadoEn` (timestamp), `creadoPor` (string) y `actualizadoEn` (timestamp). Firebase Console usa privilegios administrativos y puede crear este perfil sin reglas. El administrador existente de este proyecto tiene un custom claim `admin` y puede registrar su perfil desde el panel si hace falta.
6. Para cargar o actualizar el catálogo, configura una cuenta de servicio con acceso a Firestore. Descarga su clave en una ubicación segura fuera del proyecto, configura `GOOGLE_APPLICATION_CREDENTIALS` con su ruta y ejecuta:

   ```bash
   npm run seed:catalog -- --dry-run
   npm run seed:catalog
   ```

   La primera orden solo valida el catálogo y no escribe en Firebase. En PowerShell, para cargarlo, configura la variable temporal:

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\ruta-segura\firebase-service-account.json"
   npm run seed:catalog
   Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS
   ```

   El script carga la tienda, categorías, productos y promoción inicial, y **sobrescribe** los documentos existentes con el contenido de `catalogo.json`, incluidos los cambios hechos desde el panel. Lee `VITE_FIREBASE_PROJECT_ID` desde `.env` y comprueba los datos antes de escribir. No subas la clave de servicio ni el archivo `.env` al repositorio.

7. (Opcional) Para reemplazar las solicitudes pendientes por pedidos calculados y verificados en servidor con Admin SDK, configura App Check y la Cloud Function `createOrder`. El despliegue de funciones requiere el plan Blaze:

   ```bash
   npx firebase-tools deploy --only functions
   ```

## Publicar

**Netlify** (despliegue actual): usa `npm run build` como comando de compilación y `dist` como directorio de publicación. Define las variables `VITE_FIREBASE_*` de `.env.example` en **Site configuration > Environment variables**; sin ellas, la tienda publicada queda en vista previa local. El archivo `public/_redirects` mantiene las rutas de React, como `/staff`, disponibles al abrirlas directamente.

**Firebase Hosting** (alternativa):

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Portal del personal

- **Usuarios**: crea primero la cuenta en Authentication, copia su UID y regístralo en **Usuarios** con el mismo correo y el rol. La contraseña nunca se pide en el panel; **Enviar restablecimiento de contraseña** hace que Firebase envíe el enlace al titular. **Quitar acceso** desactiva el perfil de inmediato, conserva el registro y los pedidos, y permite reactivarlo después. Para dar de baja completamente una cuenta, desactívala o elimínala también en Firebase Console. Un administrador no puede editar ni quitarse el acceso a sí mismo.
- **Productos**: cada producto tiene un precio por cada tamaño definido en **Tienda**. Deja vacío un tamaño para no ofrecerlo en ese producto; se exige al menos un precio. Al agregar un tamaño en **Tienda**, aparece un campo nuevo en el formulario de productos.
- **Categorías**: no se puede borrar una categoría que tenga productos; primero reasígnalos o elimínalos.
- **Promociones**: son informativas; se muestran en la tienda pero no aplican descuentos automáticos.
- **Pedidos**: se muestran en cola FIFO, del más antiguo al más reciente. Las solicitudes de la tienda llegan como `pendiente_revision` con los productos solicitados y sin precios verificados; el personal confirma el total con el cliente por WhatsApp. Estados: pendiente de revisión, confirmado, en preparación, en camino, entregado, cerrado y cancelado. Cuando un pedido está entregado o cerrado, solo un administrador puede volver a cambiar su estado, y los entregados dejan de mostrarse al vendedor.

## Esquema de Firestore

- `configuracion/tienda`: nombre, identidad, WhatsApp, tamaños, moneda y tarifas de envío.
- `categorias/{slug}`: nombre, posición y estado de publicación. Los productos guardan `categoriaId`, evitando duplicar nombres de categoría.
- `productos/{id}`: nombre, descripción, referencia, imagen, `precios`, `categoriaId`, popularidad y estado activo. El documento usa el ID estable del catálogo como clave.
  - `precios` es un mapa de tamaño a precio en COP, por ejemplo `{"Personal": 22000, "Mediana": 32000, "Familiar": 45000}`. Un tamaño sin precio no se ofrece para ese producto.
  - Los productos cargados antes de los precios por tamaño solo tienen `precio` y lo usan en todos los tamaños hasta que se editan en `/staff`; al guardarlos, el panel reemplaza `precio` por `precios`.
  - En `catalogo.json`, cada producto puede usar `precios` o `precio` (que se carga como precio único).
- `promociones/{id}`: título, descripción, tipo, estado y orden.
- `pedidos/{id}`: datos del cliente (`cliente.nombre`, `cliente.telefono`), `items` (solo `productoId`, `tamano` y `cantidad`), método de pago, notas, `estado`, `preciosVerificados: false`, `creadoEn` y `estadoActualizadoEn`. Los precios y totales que ve el cliente son estimados y no se guardan como valores confiables. El cliente no necesita cuenta; los pedidos solo son legibles por `admin` y `seller`.
- `usuarios/{uid}`: perfil de acceso con `email`, `nombre`, `rol` (`admin` o `seller`), `activo`, `creadoEn`, `creadoPor` y `actualizadoEn`. No contiene contraseñas. Un perfil inactivo prevalece sobre los custom claims de versiones previas, que siguen admitidos si todavía no existe un perfil para ese UID.

No se mantienen contadores de pedidos en el documento de tienda, para evitar contención por escrituras. La calificación y el número de pedidos de la portada son contenido de marketing que se edita en **Tienda**.

## Seguridad y riesgos conocidos

Las pruebas `todo` de `npm run test:rules` documentan estos puntos:

- **Spam de solicitudes**: Firestore Rules no puede limitar la frecuencia de solicitudes anónimas. Para tráfico público, activa App Check con aplicación obligatoria en Firestore (no requiere Blaze) o migra el guardado a la Cloud Function `createOrder`. Supervisa el uso de Firestore.
- **Productos y tamaños de una solicitud**: las reglas validan el formato, pero no comprueban que el producto exista o esté activo ni que el tamaño pertenezca a la tienda; el personal debe revisarlo antes de confirmar.
- **Datos del catálogo**: las reglas no validan el esquema de lo que guarda un administrador; el panel valida precios, imágenes HTTPS y WhatsApp antes de guardar.
