# API Usuarios

[![CI](https://github.com/franciscogdeveloper/api-usuarios/actions/workflows/ci.yml/badge.svg)](https://github.com/franciscogdeveloper/api-usuarios/actions/workflows/ci.yml)

API REST de usuarios con NestJS 12, TypeScript (strict), PostgreSQL 17, Prisma 6, autenticación JWT (access + refresh) y roles (`USER`, `ADMIN`).

## Requisitos

- Node.js 24+
- Docker (para PostgreSQL)
- npm

## Setup

```bash
docker compose up -d            # PostgreSQL en localhost:5432 (bases api_usuarios y api_usuarios_test)
cp .env.example .env            # y edita los secretos JWT
npm install
npx prisma migrate dev          # aplica las migraciones y genera el cliente
npx prisma db seed              # crea/actualiza el admin (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/docs` (JSON en `/docs-json`)

## Variables de entorno

`DATABASE_URL`, `PORT`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Se validan al arrancar (ver `src/config/env.validation.ts`).

## Endpoints

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/auth/register` | Público | Crea un usuario `USER`; devuelve tokens y usuario (201) |
| POST | `/api/auth/login` | Público | Devuelve tokens y usuario (200) |
| POST | `/api/auth/refresh` | Público (requiere refresh token en el body) | Rota el par de tokens (200) |
| POST | `/api/auth/logout` | Autenticado | Revoca el refresh token (204) |
| GET | `/api/users/me` | Autenticado | Perfil propio |
| PATCH | `/api/users/me` | Autenticado | Actualiza `name` y/o `password` |
| GET | `/api/users?page=1&limit=20` | ADMIN | Lista paginada (`limit` máx. 100) |
| GET | `/api/users/:id` | ADMIN | Detalle |
| PATCH | `/api/users/:id` | ADMIN | Actualiza `name`, `email`, `role`, `password` |
| DELETE | `/api/users/:id` | ADMIN | Elimina (204) |
| POST | `/api/users/:id/unlock` | ADMIN | Desbloquea una cuenta bloqueada (204) |

Reglas de password: mínimo 8 caracteres, al menos una mayúscula y un número. Los emails se normalizan (trim + minúsculas). Un admin no puede borrarse ni quitarse el rol `ADMIN` a sí mismo (400).

## Ejemplos curl

```bash
B=http://localhost:3000/api

# Registro
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","name":"Ana","password":"Secret123"}'

# Login (guarda accessToken y refreshToken de la respuesta)
curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"Secret123"}'

# Perfil
curl -s $B/users/me -H "Authorization: Bearer $ACCESS"

# Renovar tokens (el refresh anterior deja de servir)
curl -s -X POST $B/auth/refresh -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}"

# Logout
curl -i -X POST $B/auth/logout -H "Authorization: Bearer $ACCESS"

# Listado como admin
curl -s "$B/users?page=1&limit=10" -H "Authorization: Bearer $ADMIN_ACCESS"
```

## Protección contra fuerza bruta

Dos capas independientes:

1. **Throttling por IP** (`@nestjs/throttler`, `ThrottlerGuard` es el primer guard global). Al superar el límite responde 429 con el header `Retry-After`.
2. **Bloqueo de cuenta**: tras `MAX_LOGIN_ATTEMPTS` fallos de password consecutivos la cuenta queda bloqueada `LOCKOUT_MINUTES` minutos. Mientras dura, `POST /auth/login` responde 429 ("Cuenta bloqueada temporalmente. Intenta más tarde.") con `Retry-After` en segundos, sin verificar el password. Un login correcto reinicia el contador; un bloqueo expirado cuenta como desbloqueado.

| Variable | Default | Descripción |
|---|---|---|
| `THROTTLE_LIMIT` | 100 | Peticiones por IP y ventana (global) |
| `THROTTLE_TTL_MS` | 60000 | Ventana global en ms |
| `LOGIN_THROTTLE_LIMIT` | 5 | `POST /auth/login` por minuto e IP |
| `REGISTER_THROTTLE_LIMIT` | 3 | `POST /auth/register` por minuto e IP |
| `MAX_LOGIN_ATTEMPTS` | 5 | Fallos antes de bloquear la cuenta |
| `LOCKOUT_MINUTES` | 15 | Duración del bloqueo |

Un admin puede desbloquear una cuenta con `POST /api/users/:id/unlock` (204; 404 si no existe). Cambiar el password de un usuario con `PATCH /api/users/:id` también lo desbloquea.

## Integración continua

El workflow `.github/workflows/ci.yml` (GitHub Actions) se ejecuta en cada push a `main` y en cada pull request hacia `main`. Levanta un PostgreSQL 17 como servicio y, en orden:

1. instala dependencias (`npm ci`) y genera el cliente de Prisma;
2. crea `.env.test` a partir de `.env.test.example`;
3. ejecuta `npm run lint`, `npm run build`, `npm test` (unitarios) y `npm run test:e2e` (que aplica las migraciones en la base de test).

Si cualquier paso falla, el check `Lint, build y tests` queda en rojo. Una ejecución nueva sobre la misma rama cancela la anterior.

## Despliegue con Docker

El `Dockerfile` es multi-stage y `docker-compose.prod.yml` levanta la API junto a su PostgreSQL (proyecto `api-usuarios-prod`, separado del compose de desarrollo).

```bash
# 1) Crear .env.prod (ignorado por git) y reemplazar cada CHANGE_ME
cp .env.prod.example .env.prod
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # úsalo para secretos y POSTGRES_PASSWORD
# (POSTGRES_PASSWORD debe coincidir con el de DATABASE_URL)

# 2) Construir y levantar (las migraciones se aplican al arrancar el contenedor)
docker compose -f docker-compose.prod.yml up -d --build

# 3) Crear/actualizar el admin inicial (ADMIN_EMAIL / ADMIN_PASSWORD de .env.prod)
docker compose -f docker-compose.prod.yml exec api npm run db:seed:prod

# 4) Probar
curl http://localhost:8080/api/health     # {"status":"ok","db":"up"}
# Swagger: http://localhost:8080/docs

# Apagar (y borrar el volumen de datos con -v)
docker compose -f docker-compose.prod.yml down -v
```

- **Multi-stage:** `deps` instala todo, `build` compila TypeScript, `prod-deps` instala solo dependencias de producción y `runtime` copia únicamente `dist/`, `node_modules` de producción, `prisma/` y `package.json`. La imagen final no lleva TypeScript, tests ni herramientas de desarrollo.
- **Debian slim, no alpine:** Prisma y argon2 usan binarios nativos para glibc; así se evitan problemas con musl.
- **Usuario no root:** el contenedor corre como `node`, con privilegios mínimos.
- **Arranque:** `docker-entrypoint.sh` ejecuta `prisma migrate deploy` y luego `node dist/main`. El `HEALTHCHECK` consulta `/api/health`, que comprueba la base de datos.
- La base de datos no expone puertos al host; la API se publica en el 8080.

## Tests

Antes de correr los e2e, crea tu archivo de entorno de test (está en `.gitignore`):

```bash
cp .env.test.example .env.test
```

```bash
npm test            # unitarios (Vitest, mocks con vi.fn())
npm run test:e2e    # e2e con Supertest contra la base api_usuarios_test
npm run lint
npm run build
```

Los e2e requieren PostgreSQL levantado (`docker compose up -d`). Cargan `.env.test`, comprueban que `DATABASE_URL` apunte a una base `*_test` (si no, abortan), ejecutan `prisma migrate deploy` en un `globalSetup` y limpian la tabla `users` antes de cada test. Nunca usan la base de desarrollo.

## Notas de diseño

- **Rotación de refresh tokens:** cada `/auth/refresh` emite un par nuevo y guarda el hash del nuevo refresh; el anterior queda inválido. Reusar un refresh viejo devuelve 401. El refresh incluye un `jti` aleatorio para que dos tokens emitidos en el mismo segundo sean distintos.
- **Hash del refresh con argon2:** en la base solo se guarda `refreshTokenHash` (argon2), nunca el token. Logout y cambio de password lo ponen en `null`, cerrando las sesiones.
- **Guards globales:** `JwtAuthGuard` y `RolesGuard` se registran con `APP_GUARD`. Todo es privado por defecto; `@Public()` abre una ruta y `@Roles(...)` restringe por rol.
- **Login:** responde siempre 401 "Credenciales inválidas" y, si el usuario no existe, verifica contra un hash dummy para no revelar por tiempo si el email existe.
- **Respuestas seguras:** las consultas usan `publicUserSelect`, así que `password` y `refreshTokenHash` nunca salen de la capa de datos pública.
- **Configuración compartida:** `configureApp()` (`src/app.setup.ts`) aplica prefijo, `ValidationPipe` y Swagger tanto en `main.ts` como en los e2e.
