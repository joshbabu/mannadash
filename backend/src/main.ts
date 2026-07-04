import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Wide open for local dev so the frontend (different port) can call the API —
  // restrict this to the actual deployed frontend origin(s) before production
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips properties not defined in the DTO
      transform: true, // converts query params / body to DTO types (e.g. string -> number)
      forbidNonWhitelisted: true,
    }),
  );
  // Enforces @Exclude() on entities (e.g. User.passwordHash) across every response,
  // including when the entity is nested inside another response like Order.customer.user
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
// auto-deploy test
// auto-deploy test 2
