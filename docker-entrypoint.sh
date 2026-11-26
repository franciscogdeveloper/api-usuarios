#!/bin/sh
# Aplica las migraciones pendientes y arranca la API.
# `set -e`: si la migración falla, el contenedor no arranca con un esquema roto.
set -e

node_modules/.bin/prisma migrate deploy

# exec reemplaza el shell por Node (PID 1) para recibir SIGTERM correctamente.
exec node dist/main
