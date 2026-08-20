import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { uploadPath } from './storage/upload-root';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  configureApp(app);
  app.use(
    '/uploads/demo',
    express.static(uploadPath('demo'), {
      dotfiles: 'deny',
      index: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
