# Forno Bello

Tienda web de React y Vite. Firebase Firestore sirve el catálogo y registra cada pedido antes de abrir WhatsApp.

## Desarrollo local

1. Instala Node.js 22.12 o posterior.
2. Instala dependencias:

   ```bash
   npm install
   ```

3. Completa `.env` con la configuración de la aplicación web y `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` para proteger pedidos con Firebase App Check. Crea una clave de sitio web de reCAPTCHA Enterprise para los dominios local y de Hosting, registra esa clave como proveedor de App Check para la aplicación web en Firebase Console y usa la clave de sitio en `.env`.
4. Inicia Vite:

   ```bash
   npm run dev
   ```

Sin variables Firebase, la tienda muestra el catálogo local como vista previa; no permite confirmar pedidos. Con Firebase configurado, la tienda lee Firestore. Para habilitar el botón de pedido también debe configurarse App Check con la clave de reCAPTCHA Enterprise.

## Preparar Firebase

1. Habilita la API de Cloud Firestore y verifica la base de datos `default`. En el proyecto actual, la base existente está en `nam5` (multirregión de EE. UU.) y no se puede mover. La función se despliega en `us-central1`, una región cercana para reducir la latencia entre servicios. Una base nueva debe crearse en la región que corresponda antes de cargar datos; la ubicación es irreversible.
2. Registra una aplicación web en el proyecto y copia sus valores `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` y `appId` al archivo `.env`. La configuración web es pública; la protección de datos se aplica con reglas y funciones de servidor.
3. En Google Cloud Fraud Defense, crea una clave web de reCAPTCHA Enterprise para `localhost` y los dominios de Hosting. En Firebase Console > App Check, registra la app web con esa clave como proveedor de reCAPTCHA Enterprise. Copia la clave de sitio pública a `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` en `.env` y reinicia Vite. La función de crear pedidos exige un token App Check válido.
4. En Firebase Console, habilita Authentication con el proveedor correo/contraseña. Los clientes no crean cuenta. Para el personal, crea primero cada cuenta de correo en Authentication. Después, desde `/staff` > **Usuarios**, agrega su UID, correo y rol. La contraseña nunca se pide en el panel; selecciona **Enviar restablecimiento de contraseña** para que Firebase envíe el enlace al titular de la cuenta.
5. Publica las reglas incluidas en este proyecto; Firestore Rules no requiere habilitar Blaze:

   ```bash
   npx firebase-tools login
   npx firebase-tools use --add
   npx firebase-tools deploy --only firestore:rules
   ```

   Las reglas permiten al público leer solo categorías, productos y promociones activas. Solo `admin` puede crear, editar o borrar catálogo, promociones, configuración y perfiles de personal. `seller` puede leer pedidos y catálogo activo, pero no modificarlos. Los clientes anónimos no pueden leer ni escribir pedidos directamente. Las reglas de Firebase protegen cada operación de personal y cada usuario puede leer su propio perfil.

   En un proyecto nuevo, inicializa el primer perfil administrador desde Firebase Console en Firestore, en `usuarios/{UID}`. Crea la cuenta en Authentication y un documento con campos `email` (string), `nombre` (string), `rol` (`admin`), `activo` (true), `creadoEn` (timestamp), `creadoPor` (string) y `actualizadoEn` (timestamp). Firebase Console utiliza privilegios administrativos y puede crear este perfil inicial sin reglas. El administrador existente de este proyecto ya tiene un custom claim `admin` y puede registrar su perfil en el panel si hace falta.

   Para agregar una persona, crea su cuenta en Authentication, copia el UID de Firebase Console y registra en el panel exactamente ese UID y correo. Las cuentas deben crearse primero porque el panel no tiene permisos para crear ni borrar usuarios de Authentication. **Quitar acceso** desactiva el perfil de Firestore inmediatamente, conserva el registro y los pedidos, y permite reactivar el acceso después. Para dar de baja completamente una cuenta, desactívala o elimínala también en Firebase Console.

6. Para desplegar pedidos con Admin SDK, configura Cloud Functions. El proyecto debe tener Blaze para desplegar funciones:

   ```bash
   npx firebase-tools deploy --only functions
   ```

7. Para cargar o actualizar el catálogo inicial, configura una cuenta de servicio con acceso a Firestore. Descarga su clave en una ubicación segura fuera del proyecto, configura `GOOGLE_APPLICATION_CREDENTIALS` con su ruta y ejecuta:

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

8. Para publicar en Firebase Hosting:

   ```bash
   npm run build
   npx firebase-tools deploy --only hosting
   ```

## Esquema de Firestore

- `configuracion/tienda`: nombre, identidad, WhatsApp, tamaños, moneda y tarifas de envío. La función usa este documento como fuente de verdad de los mínimos para pedidos y envío gratuito.
- `categorias/{slug}`: nombre, posición y estado de publicación. Los productos guardan `categoriaId`, evitando duplicar nombres de categoría.
- `productos/{id}`: nombre, descripción, referencia, imagen, precio en COP, `categoriaId`, popularidad y estado activo. El documento usa el ID estable del catálogo como clave.
- `promociones/{id}`: descripción, tipo, estado, orden y condiciones declarativas. La promoción inicial es informativa: el catálogo no especifica un valor de descuento.
- `pedidos/{id}`: datos de contacto y líneas con `productoId`, nombre, referencia, `tamano`, `cantidad`, `precioUnitario` y `totalLinea`, además de subtotal, envío, total, pago, estado, origen, notas y fecha. Solo la función de servidor escribe pedidos; los clientes públicos no pueden consultarlos.
- `pedidos/{id}.cliente`: nombre y teléfono ingresados al pedir. El cliente no necesita cuenta; esta información se guarda dentro del pedido y solo es legible por `admin` y `seller`.
- `Firebase Authentication`: cuentas de correo y contraseña únicamente para el personal. El UID de Authentication enlaza con el perfil de autorización; no se crea cuenta ni perfil para el cliente. Los custom claims de versiones previas siguen admitidos si todavía no existe un perfil Firestore para ese UID.
- `usuarios/{uid}`: perfil de acceso administrativo en Firestore con `email`, `nombre`, `rol` (`admin` o `seller`), `activo`, `creadoEn`, `creadoPor` y `actualizadoEn`. No contiene contraseñas ni datos sensibles de autenticación. Un perfil inactivo prevalece sobre claims antiguos para revocar el acceso.

No se mantienen contadores de pedidos en el documento de tienda, para evitar contención por escrituras. El número de pedidos mostrado en la portada es contenido de marketing y se actualiza por separado.

El portal `/staff` presenta el catálogo y los pedidos al personal. Administradores pueden gestionar perfiles internos en `usuarios/{uid}` y administrar productos, categorías, promociones y configuración; vendedores solo tienen vistas de lectura de pedidos y productos. La administración de perfiles usa Firebase Authentication para el inicio de sesión y Firestore Rules para proteger lecturas y escrituras, sin Cloud Functions. Las cuentas de Authentication se crean y eliminan por separado en Firebase Console; el panel solo revoca o concede el acceso a la aplicación. Firebase envía correos para restablecer contraseñas. La cuenta del administrador que inició sesión no se puede editar ni eliminar a sí misma. Los pedidos históricos se conservan cuando se retira un perfil. La confirmación de pedidos sigue necesitando la Cloud Function para validar precios y guardarlos con Admin SDK. Publica las reglas antes de habilitar el portal.
