import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as express from 'express';
import { NextFunction, Request, Response } from 'express';

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
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  if (process.env.TRUST_PROXY === 'true') {
    expressApp.set('trust proxy', 1);
  }

  app.use(
    express.json({
      limit: '8mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        if (req.originalUrl?.includes('/payments/webhooks/paystack')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-FixZone-Api', 'fixzone-enterprise-api');
    next();
  });

  const configuredOrigins = expandCorsOrigins(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

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

function expandCorsOrigins(origins: string[]) {
  return [
    ...new Set(
      origins.flatMap((origin) => {
        const variants = [origin];
        try {
          const url = new URL(origin);
          if (url.hostname === 'securezonegroup.com') {
            variants.push(`${url.protocol}//www.securezonegroup.com`);
          }
          if (url.hostname === 'www.securezonegroup.com') {
            variants.push(`${url.protocol}//securezonegroup.com`);
          }
        } catch {
          // Keep non-URL origins unchanged; Nest also supports origin patterns.
        }
        return variants;
      }),
    ),
  ];
}
