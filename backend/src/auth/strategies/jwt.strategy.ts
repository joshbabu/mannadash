import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string; // user id
  phone: string;
  role?: 'customer' | 'restaurant' | 'rider';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev_only_change_me_in_production'),
    });
  }

  // Whatever this returns becomes `request.user` in guarded routes
  async validate(payload: JwtPayload) {
    return { userId: payload.sub, phone: payload.phone, role: payload.role };
  }
}
