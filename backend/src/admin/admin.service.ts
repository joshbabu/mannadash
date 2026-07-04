import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminLoginDto } from './dto/admin-login.dto';

/**
 * Single-admin auth via .env credentials — deliberately minimal for an early-stage internal tool
 * with one operator. Before adding a second admin/ops person, replace this with a real AdminUser
 * table (hashed passwords, one row per person) rather than stretching this further.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  login(dto: AdminLoginDto) {
    const expectedUsername = this.config.get<string>('ADMIN_USERNAME', '');
    const expectedPassword = this.config.get<string>('ADMIN_PASSWORD', '');

    if (!expectedUsername || !expectedPassword) {
      throw new UnauthorizedException('Admin login is not configured — set ADMIN_USERNAME / ADMIN_PASSWORD in .env');
    }

    if (dto.username !== expectedUsername || dto.password !== expectedPassword) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    const payload = { sub: 'admin', phone: 'admin', role: 'admin' as const };
    return {
      accessToken: this.jwtService.sign(payload),
      admin: { username: dto.username },
    };
  }
}
