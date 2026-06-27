import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as express from 'express';
import { Response } from 'express';

@Catch()
class JsonExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      response
        .status(status)
        .type('application/json')
        .json(
          typeof body === 'string'
            ? {
                statusCode: status,
                message: body,
                error: exception.name,
              }
            : body,
        );
      return;
    }

    response.status(500).type('application/json').json({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
    });
  }
}

export function configureApp(app: INestApplication) {
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-FixZone-Api', 'fixzone-enterprise-api');
    next();
  });

  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin:
      configuredOrigins.length > 0
        ? configuredOrigins
        : [/^http:\/\/localhost(?::\d+)?$/, /^http:\/\/127\.0\.0\.1(?::\d+)?$/],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new JsonExceptionFilter());
}
