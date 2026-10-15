# Forno Bello

Tienda web de React y Vite. Firebase Firestore sirve el catálogo y registra cada solicitud de pedido antes de abrir WhatsApp.

## Desarrollo local

1. Instala Node.js 22.12 o posterior.
2. Instala dependencias:

   ```bash
   npm install
   ```

3. Completa `.env` con la configuración de la aplicación web de Firebase.
4. Inicia Vite:

   ```bash
   npm run dev
   ```

Sin variables Firebase, la tienda muestra el catálogo local como vista previa y no permite enviar solicitudes. Con Firebase configurado y las reglas publicadas, el cliente guarda en Firestore una solicitud pendiente y después abre WhatsApp. No se requiere App Check ni Blaze para este flujo.

## Preparar Firebase

1. Habilita la API de Cloud Firestore y verifica la base de datos `default`. En el proyecto actual, la base existente está en `nam5` (multirregión de EE. UU.) y no se puede mover. La ubicación de una base nueva es irreversible.
2. Registra una aplicación web en el proyecto y copia sus valores `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` y `appId` al archivo `.env`. La configuración web es pública; la protección de datos se aplica con reglas y funciones de servidor.
3. En Firebase Console, habilita Authentication con el proveedor correo/contraseña. Los clientes no crean cuenta. Para el personal, crea primero cada cuenta de correo en Authentication. Después, desde `/staff` > **Usuarios**, agrega su UID, correo y rol. La contraseña nunca se pide en el panel; selecciona **Enviar restablecimiento de contraseña** para que Firebase envíe el enlace al titular de la cuenta.
4. Publica las reglas incluidas en este proyecto; Firestore Rules no requiere habilitar Blaze:

   ```bash
   npx firebase-tools login
   npx firebase-tools use --add
   npx firebase-tools deploy --only firestore:rules
   ```

   Las reglas permiten al público leer solo categorías, productos y promociones activas. Los clientes anónimos pueden crear solicitudes de pedido con campos limitados, pero no pueden leer, editar ni borrar pedidos. Solo `admin` puede gestionar catálogo, promociones, configuración y perfiles de personal. `seller` puede leer pedidos y catálogo activo. Las solicitudes públicas quedan `pendiente_revision`: solo guardan IDs de producto, tamaño y cantidad; no se confía en precios ni totales enviados por el navegador y el personal debe verificarlos en el catálogo antes de confirmar el precio con el cliente.

   En un proyecto nuevo, inicializa el primer perfil administrador desde Firebase Console en Firestore, en `usuarios/{UID}`. Crea la cuenta en Authentication y un documento con campos `email` (string), `nombre` (string), `rol` (`admin`), `activo` (true), `creadoEn` (timestamp), `creadoPor` (string) y `actualizadoEn` (timestamp). Firebase Console utiliza privilegios administrativos y puede crear este perfil inicial sin reglas. El administrador existente de este proyecto ya tiene un custom claim `admin` y puede registrar su perfil en el panel si hace falta.

   Para agregar una persona, crea su cuenta en Authentication, copia el UID de Firebase Console y registra en el panel exactamente ese UID y correo. Las cuentas deben crearse primero porque el panel no tiene permisos para crear ni borrar usuarios de Authentication. **Quitar acceso** desactiva el perfil de Firestore inmediatamente, conserva el registro y los pedidos, y permite reactivar el acceso después. Para dar de baja completamente una cuenta, desactívala o elimínala también en Firebase Console.

5. (Opcional) Para reemplazar las solicitudes pendientes por pedidos calculados y verificados en servidor con Admin SDK, configura App Check y Cloud Functions. El despliegue de funciones requiere el plan Blaze:

   ```bash
   npx firebase-tools deploy --only functions
   ```

6. Para cargar o actualizar el catálogo inicial, configura una cuenta de servicio con acceso a Firestore. Descarga su clave en una ubicación segura fuera del proyecto, configura `GOOGLE_APPLICATION_CREDENTIALS` con su ruta y ejecuta:

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

   El script carga la tienda, categorías, productos y promoción inicial. Lee `VITE_FIREBASE_PROJECT_ID` desde `.env` y comprueba los datos antes de escribir. No subas la clave de servicio ni el archivo `.env` al repositorio.

7. Para publicar en Firebase Hosting:

   ```bash
   npm run build
   npx firebase-tools deploy --only hosting
   ```

   Para publicar en Netlify, usa `npm run build` como comando de compilación y `dist` como directorio de publicación. El archivo `public/_redirects` mantiene las rutas de React, como `/staff`, disponibles al abrirlas directamente.

## Esquema de Firestore

- `configuracion/tienda`: nombre, identidad, WhatsApp, tamaños, moneda y tarifas de envío.
- `categorias/{slug}`: nombre, posición y estado de publicación. Los productos guardan `categoriaId`, evitando duplicar nombres de categoría.
- `productos/{id}`: nombre, descripción, referencia, imagen, precio en COP, `categoriaId`, popularidad y estado activo. El documento usa el ID estable del catálogo como clave.
- `promociones/{id}`: descripción, tipo, estado, orden y condiciones declarativas. La promoción inicial es informativa: el catálogo no especifica un valor de descuento.
- `pedidos/{id}`: la tienda guarda solicitudes pendientes con datos de contacto, `items` (solo `productoId`, `tamano`, `cantidad`), pago, notas, `estado: pendiente_revision`, `preciosVerificados: false` y fecha. La consola los muestra en cola FIFO, del más antiguo al más reciente. Los precios y totales del resumen del cliente son estimados y no se guardan como valores confiables. La función opcional de servidor puede guardar pedidos verificados en un esquema más completo.
- Estados del pedido: administradores y vendedores pueden actualizar pedidos, incluidos los estados entregado y cerrado. Una vez que un vendedor marque un pedido como entregado o cerrado, solo un administrador podrá volver a modificar su estado. Los pedidos entregados dejan de mostrarse en la consola del vendedor, pero permanecen disponibles para el administrador. El cambio de estado no verifica ni altera los precios.
- `pedidos/{id}.cliente`: nombre y teléfono ingresados al pedir. El cliente no necesita cuenta; esta información se guarda dentro del pedido y solo es legible por `admin` y `seller`.
- `Firebase Authentication`: cuentas de correo y contraseña únicamente para el personal. El UID de Authentication enlaza con el perfil de autorización; no se crea cuenta ni perfil para el cliente. Los custom claims de versiones previas siguen admitidos si todavía no existe un perfil Firestore para ese UID.
- `usuarios/{uid}`: perfil de acceso administrativo en Firestore con `email`, `nombre`, `rol` (`admin` o `seller`), `activo`, `creadoEn`, `creadoPor` y `actualizadoEn`. No contiene contraseñas ni datos sensibles de autenticación. Un perfil inactivo prevalece sobre claims antiguos para revocar el acceso.

No se mantienen contadores de pedidos en el documento de tienda, para evitar contención por escrituras. El número de pedidos mostrado en la portada es contenido de marketing y se actualiza por separado.

El portal `/staff` presenta el catálogo y los pedidos al personal. Las solicitudes nuevas se marcan como `pendiente_revision` y muestran los productos solicitados sin precio; el personal debe consultar el catálogo y confirmar el total en WhatsApp. Como Firestore Rules no puede limitar la frecuencia de solicitudes anónimas, este flujo es susceptible a spam y uso abusivo; para comercios con tráfico público, configura App Check y migra el guardado a una Cloud Function con validación en servidor. Publica las reglas antes de habilitar las solicitudes y supervisa el uso de Firestore. Administradores gestionan perfiles, catálogo, promociones y configuración; vendedores pueden consultar pedidos y catálogo. Las cuentas de Authentication se crean y eliminan por separado en Firebase Console; el panel solo revoca o concede acceso a la aplicación.
