import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Convierte "a,b , c" en ['a', 'b', 'c'] (ignora entradas vacías). */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  // Detrás de un proxy (Render) la IP real viene en X-Forwarded-For. Con
  // "trust proxy" Express la expone en req.ip, que es lo que usa el throttler.
  // 0 = no confiar en ningún proxy (local); 1 = un proxy delante (Render).
  app.set('trust proxy', config.get<number>('TRUST_PROXY', 0));

  // CORS para el frontend (SPA en otro dominio). Sin orígenes configurados no
  // se habilita. Los tokens van en Authorization, no en cookies: sin credentials.
  const origins = parseOrigins(config.get<string>('CORS_ORIGINS', ''));
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      exposedHeaders: ['Retry-After'],
    });
  }

  app.setGlobalPrefix('api', { exclude: ['docs', 'docs-json'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Usuarios')
    .setDescription('API REST de usuarios con JWT y roles')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
