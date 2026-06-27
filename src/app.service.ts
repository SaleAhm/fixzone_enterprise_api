import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  health() {
    return {
      status: 'ok',
      service: 'fixzone-enterprise-api',
      apiPrefix: '/api',
    };
  }
}
