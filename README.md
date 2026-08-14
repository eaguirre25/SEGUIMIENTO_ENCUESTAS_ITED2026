# Observatorio de seguimiento LimeSurvey

Repositorio previsto: [eaguirre25/SEGUIMIENTO_ENCUESTAS_ITED2026](https://github.com/eaguirre25/SEGUIMIENTO_ENCUESTAS_ITED2026). La configuración de producción ya contempla el origen de GitHub Pages `https://eaguirre25.github.io`.

Aplicación de lectura para seguir el operativo de estudiantes sin exponer credenciales ni respuestas personales. La arquitectura separa la captura del visor:

```text
LimeSurvey Cloud
  → RemoteControl 2 (JSON-RPC)
  → Cloudflare Worker (normalización, acceso protegido y caché de 20 s)
  → GET /api/dashboard
  → dashboard estático Vite + TypeScript + MapLibre + capa oficial de escuelas
```

El Worker abre una sesión, exporta respuestas completas e incompletas con `export_responses` y libera la session key en un bloque `finally`. El navegador nunca se conecta a LimeSurvey. El HTML público no contiene datos: el Worker exige usuario y contraseña antes de entregar métricas o ubicaciones.

Producción:

- Visor: `https://eaguirre25.github.io/SEGUIMIENTO_ENCUESTAS_ITED2026/`
- API: `https://limesurvey-dashboard-api-production.limesurvey-dashboard-worker.workers.dev/api/dashboard`

## Estructura

```text
frontend/
  src/data/demo.json       Contrato vacío para desarrollo sin datos ficticios
  src/main.ts              UI, autenticación, actualización, tabla y mapa
  src/data/state-schools.json    Capa de escuelas estatales
  src/data/private-schools.json  Capas privadas consolidadas y deduplicadas
  src/style.css            Sistema visual responsive oscuro
  vite.config.ts           Desarrollo y base de GitHub Pages
worker/
  src/index.ts             Endpoint, autenticación, CORS y caché
  src/limesurvey.ts        Cliente JSON-RPC y ciclo de sesión
  src/normalize.ts         Normalización y agregado seguro
  src/question-map.ts      Único mapa de QCodes/columnas
  test/normalize.test.ts   Pruebas de contrato y privacidad
  wrangler.jsonc           Configuración de Cloudflare
.github/workflows/         CI y despliegues automáticos
```

## QCodes de la encuesta de estudiantes

Los códigos se verificaron contra RemoteControl 2 y están centralizados en [`worker/src/question-map.ts`](worker/src/question-map.ts):

- `SCHOOL`: `Q996592` o `Q996548`, según la rama respondida.
- `STATE_SCHOOL`: `Q996548`; se extrae el número escrito para unirlo con `nro_escuel` de la capa oficial.
- `PRIVATE_SCHOOL`: `Q996592`.
- `MANAGEMENT_TYPE`: `Q996591` (`Estatal`/`Privada`); no se usa como nombre de escuela.
- `SCHOOL_IDENTIFIER`: `Q996545` (reservado; todavía no agrupa ni se expone).
- `COURSE_YEAR`: `Q449329`.
- `LATITUDE`: `Q996543[SQ002]`.
- `LONGITUDE`: `Q996543[SQ003]`.
- `COMPLETION`: metadato estándar `submitdate`.

El ID `977929` está en `worker/wrangler.jsonc` como variable no sensible. Si cambia la encuesta, hay que volver a verificar estos códigos antes de desplegar.

## Desarrollo rápido sin datos reales

Requiere Node.js 22 o superior.

```bash
npm install
copy frontend\.env.example frontend\.env.local
npm run dev --workspace frontend
```

En PowerShell, `Copy-Item frontend/.env.example frontend/.env.local` es equivalente. La configuración usa `VITE_DATA_MODE=api`; mientras el Worker no esté ejecutándose muestra un estado explícito sin inventar respuestas. Abrir `http://localhost:5173`.

## Configurar Cloudflare desde cero

1. Crear una cuenta en [Cloudflare](https://dash.cloudflare.com/sign-up).
2. Instalar dependencias (`npm install` ya instala Wrangler en el proyecto).
3. Autenticarse:

   ```bash
   cd worker
   npx wrangler login
   ```

4. Revisar `name`, `LIMESURVEY_STUDENT_SURVEY_ID` y `DASHBOARD_ALLOWED_ORIGIN` en `worker/wrangler.jsonc`. Para producción, el origen debe ser exacto, por ejemplo `https://organizacion.github.io`; no se usa `*`.
5. Cargar los secretos del entorno de producción, sin pegarlos en archivos versionados:

   ```bash
   npx wrangler secret put LIMESURVEY_RPC_URL --env production
   npx wrangler secret put LIMESURVEY_USERNAME --env production
   npx wrangler secret put LIMESURVEY_PASSWORD --env production
   npx wrangler secret put DASHBOARD_USERNAME --env production
   npx wrangler secret put DASHBOARD_PASSWORD --env production
   ```

   Para `LIMESURVEY_RPC_URL`, ingresar:

   ```text
   https://programaited.limesurvey.net/index.php/admin/remotecontrol
   ```

6. Para desarrollo local, crear manualmente `worker/.dev.vars` (está ignorado por Git) con:

   ```dotenv
   LIMESURVEY_RPC_URL="https://programaited.limesurvey.net/index.php/admin/remotecontrol"
   LIMESURVEY_USERNAME="usuario-local"
   LIMESURVEY_PASSWORD="contraseña-local"
   DASHBOARD_USERNAME="usuario-del-panel"
   DASHBOARD_PASSWORD="contraseña-del-panel"
   ```

7. Ejecutar el Worker:

   ```bash
   cd worker
   npx wrangler dev
   ```

8. Probar el endpoint desde otra terminal:

   ```bash
   curl -u usuario-del-panel:contraseña-del-panel http://localhost:8787/api/dashboard
   ```

9. Configurar el frontend real en `frontend/.env.local`:

   ```dotenv
   VITE_DATA_MODE=api
   VITE_API_BASE_URL=http://localhost:8787
   ```

10. Ejecutar `npm run dev --workspace frontend` desde la raíz.

Los orígenes `localhost` se aceptan en desarrollo cuando `DASHBOARD_ALLOWED_ORIGIN` también apunta a localhost. En producción solo se refleja el origen configurado.

## Despliegue manual prioritario: GitHub Pages + Worker

### Worker

Desde la raíz:

```bash
npm run test --workspace worker
npm run deploy --workspace worker
```

Wrangler muestra una URL similar a `https://limesurvey-dashboard-api.<subdominio>.workers.dev`. Guardarla.

### Frontend en GitHub Pages

1. Crear el repositorio y subir este proyecto.
2. En GitHub, abrir **Settings → Pages → Source** y elegir **GitHub Actions**.
3. La página se publica en modo API y permanece sin datos mientras el Worker no esté configurado. Cuando esté listo, en **Settings → Secrets and variables → Actions → Variables** crear `VITE_API_BASE_URL` con la URL del Worker, sin `/api/dashboard`.
4. La configuración `env.production` ya permite el origen `https://eaguirre25.github.io`; solo hay que cambiarlo si se utiliza otro dominio.
5. Cada push a `main` que afecte `frontend/` ejecuta `.github/workflows/deploy-pages.yml`.

El build detecta automáticamente el nombre del repositorio para establecer la ruta base de GitHub Pages. Para compilar manualmente:

```bash
cd frontend
set VITE_DATA_MODE=api
set VITE_API_BASE_URL=https://limesurvey-dashboard-api.<subdominio>.workers.dev
npm run build
```

En PowerShell, usar `$env:VITE_DATA_MODE='api'` y `$env:VITE_API_BASE_URL='…'`.

## Despliegue automático del Worker después de cada push

El workflow `.github/workflows/deploy-worker.yml` ya está preparado.

1. En Cloudflare, ir a **My Profile → API Tokens → Create Token** y generar un token con permiso para editar Workers Scripts.
2. En GitHub, crear los secretos de Actions `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
3. Los secretos de LimeSurvey se cargan una sola vez con `wrangler secret put ... --env production` y permanecen en Cloudflare; no deben duplicarse en GitHub.
4. Cada push a `main` que afecte `worker/` ejecuta tests y despliega.

Como alternativa visual, en Cloudflare se puede usar **Workers & Pages → Create → Import a repository**, seleccionar el repositorio, elegir `worker` como directorio raíz y `npx wrangler deploy` como comando. Los tres secretos deben agregarse en la configuración del Worker.

## Alternativa B: frontend y Worker en Cloudflare

Mantener el Worker como está y publicar `frontend/dist` en Cloudflare Pages:

```bash
npm run build --workspace frontend
cd frontend
npx wrangler pages deploy dist --project-name limesurvey-observatorio
```

En Cloudflare Pages también puede conectarse GitHub usando `frontend` como raíz, `npm run build` como comando y `dist` como salida. Definir `VITE_DATA_MODE=api` y `VITE_API_BASE_URL` en las variables de build. Actualizar `DASHBOARD_ALLOWED_ORIGIN` con el dominio final de Pages.

## Variables y secretos

| Nombre | Tipo | Dónde | Ejemplo/uso |
|---|---|---|---|
| `LIMESURVEY_RPC_URL` | secreto | Cloudflare Secret | endpoint RemoteControl |
| `LIMESURVEY_USERNAME` | secreto | Cloudflare Secret | usuario RPC |
| `LIMESURVEY_PASSWORD` | secreto | Cloudflare Secret | contraseña RPC |
| `DASHBOARD_USERNAME` | secreto | Cloudflare Secret | usuario del visor |
| `DASHBOARD_PASSWORD` | secreto | Cloudflare Secret | contraseña del visor |
| `LIMESURVEY_STUDENT_SURVEY_ID` | variable | `wrangler.jsonc` | `977929` |
| `DASHBOARD_ALLOWED_ORIGIN` | variable | `wrangler.jsonc` | origen exacto del frontend |
| `VITE_DATA_MODE` | build frontend | `.env.local`/CI | `demo` o `api` |
| `VITE_API_BASE_URL` | build frontend | `.env.local`/CI | URL del Worker |

Las variables que empiezan por `VITE_` son públicas por diseño; nunca colocar credenciales en ellas.

## Contrato y privacidad

`GET /api/dashboard` exige autenticación y solo entrega fecha de generación, ID de encuesta y agregados por escuela y tipo de gestión. No devuelve coordenadas individuales, ID individual, domicilio, edad, género, respuestas abiertas, credenciales ni session key. Las respuestas sin escuela continúan contando en el total general, pero no aparecen como establecimientos en el mapa.

El mapa muestra exclusivamente establecimientos con encuestas aplicadas y ubicación institucional comprobada. Cada escuela se representa con un ícono de edificio y el mapa de calor pondera la cantidad agregada de respuestas del establecimiento.

El nombre se normaliza con `trim`, espacios consecutivos y una clave en minúsculas. Se conserva como etiqueta la primera variante limpia observada. No se hace fuzzy matching.

## Verificación

Desde la raíz:

```bash
npm test
npm run typecheck
npm run build
```

Las pruebas cubren normalización de escuela, completitud, cursos 1–7, porcentajes, coordenadas, contrato final, privacidad y la identidad `completas + incompletas = total`.

## Cómo agregar docentes, conducción y familias

La salida ya anida métricas bajo `roles.student`. Para sumar nuevas encuestas sin rehacer el panel:

1. Añadir IDs no sensibles por rol en `Env` y `wrangler.jsonc`.
2. Crear un mapa de QCodes por encuesta con la misma semántica (`SCHOOL`, completitud y coordenadas cuando existan).
3. Extraer cada encuesta con una sesión RPC gestionada por el mismo cliente.
4. Generalizar `buildDashboard` para recibir el rol y acumular en `roles.teacher`, `roles.leadership` o `roles.family`.
5. Mantener como clave común el nombre normalizado hasta disponer de identificador institucional; luego migrar a `SCHOOL_IDENTIFIER`.
6. Añadir las secciones de rol al detalle de escuela. El mapa debe continuar exponiendo únicamente escuela y coordenadas.

Este proyecto no modifica encuestas: todas las operaciones RemoteControl implementadas son de autenticación, lectura/exportación y cierre de sesión.
