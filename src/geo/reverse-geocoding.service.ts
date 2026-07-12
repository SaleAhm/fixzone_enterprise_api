import { Injectable, Logger } from '@nestjs/common';

export type ReverseGeocodeProvider = 'openstreetmap' | 'google' | 'mapbox';

export type ReverseGeocodeResult = {
  formattedAddress: string | null;
  country: string | null;
  state: string | null;
  lga: string | null;
  ward: string | null;
  city: string | null;
  street: string | null;
  provider: ReverseGeocodeProvider | 'none';
  confidence: number | null;
};

export type ReverseGeocodeRequest = {
  latitude: number;
  longitude: number;
  provider?: ReverseGeocodeProvider;
};

@Injectable()
export class ReverseGeocodingService {
  private readonly logger = new Logger(ReverseGeocodingService.name);

  async reverseGeocode(
    request: ReverseGeocodeRequest,
  ): Promise<ReverseGeocodeResult> {
    this.logger.debug({
      message: 'Reverse geocoding provider not configured; returning fallback',
      latitude: request.latitude,
      longitude: request.longitude,
      provider: request.provider ?? 'none',
    });

    return {
      formattedAddress: null,
      country: null,
      state: null,
      lga: null,
      ward: null,
      city: null,
      street: null,
      provider: 'none',
      confidence: null,
    };
  }
}
