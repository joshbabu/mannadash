import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '../customers/entities/user.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { DeliveryPartner } from '../delivery-partners/entities/delivery-partner.entity';

const SALT_ROUNDS = 10;

// Unambiguous alphabet — no 0/O, 1/l/I — because this password gets read out over a
// phone call or typed from a WhatsApp message
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateTempPassword(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[Math.floor(Math.random() * TEMP_ALPHABET.length)];
  return out;
}

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
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Restaurant) private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(DeliveryPartner) private readonly riderRepo: Repository<DeliveryPartner>,
  ) {}

  /**
   * Admin-assisted password reset — the fallback that works with zero external services.
   * The admin passes the temp password to the user out-of-band (call/WhatsApp) and the
   * user changes it from their app. When WhatsApp-OTP self-service lands, this stays as
   * the support path behind it.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const repo: Repository<any> =
      dto.role === 'customer' ? this.userRepo : dto.role === 'restaurant' ? this.restaurantRepo : this.riderRepo;

    const account = await repo.findOne({ where: { phone: dto.phone } });
    if (!account) {
      throw new NotFoundException(`No ${dto.role} found with phone ${dto.phone}`);
    }

    const tempPassword = generateTempPassword();
    account.passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
    await repo.save(account);

    // name fields differ per entity: users/riders have .name, restaurants have .name too —
    // include it so the admin can confirm they reset the RIGHT account before sharing
    return { role: dto.role, phone: dto.phone, name: account.name, tempPassword };
  }

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
