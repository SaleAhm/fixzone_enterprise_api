import { Injectable } from '@nestjs/common';

export type PasswordResetDeliveryRequest = {
  userId: string;
  token: string;
  expiresAt: Date;
};

export type PasswordResetDeliveryResult = {
  delivered: boolean;
  status: 'DELIVERY_UNAVAILABLE' | 'DELIVERY_ACCEPTED';
};

@Injectable()
export class PasswordResetDeliveryService {
  deliver(
    request: PasswordResetDeliveryRequest,
  ): Promise<PasswordResetDeliveryResult> {
    void request;
    return Promise.resolve({
      delivered: false,
      status: 'DELIVERY_UNAVAILABLE',
    });
  }
}
