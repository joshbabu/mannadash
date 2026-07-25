import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DeliveryPartner } from './entities/delivery-partner.entity';
import { DeliveryPartnerSignupDto } from './dto/signup.dto';
import { DeliveryPartnerLoginDto } from './dto/login.dto';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';
import { Referral } from '../rider-programs/entities/referral.entity';

const SALT_ROUNDS = 10;
const REFERRAL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to misread aloud

@Injectable()
export class DeliveryPartnersService {
  constructor(
    @InjectRepository(DeliveryPartner)
    private readonly riderRepo: Repository<DeliveryPartner>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    private readonly jwtService: JwtService,
  ) {}

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      let code = '';
      for (let i = 0; i < 6; i += 1) {
        code += REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)];
      }
      const existing = await this.riderRepo.findOne({ where: { referralCode: code } });
      if (!existing) return code;
    }
    // Astronomically unlikely with a 33^6 space, but fail loudly rather than silently
    // save a rider with a colliding/undefined code if it somehow happens.
    throw new Error('Could not generate a unique referral code after 10 attempts');
  }

  async signup(dto: DeliveryPartnerSignupDto) {
    const existing = await this.riderRepo.findOne({ where: { phone: dto.phone } });
    if (existing) {
      throw new ConflictException('An account with this phone number already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const referralCode = await this.generateUniqueReferralCode();
    const rider = await this.riderRepo.save(
      this.riderRepo.create({
        name: dto.name,
        phone: dto.phone,
        passwordHash,
        vehicleType: dto.vehicleType,
        referralCode,
        // Riders start unverified and unavailable — an admin/ops step (not built yet) should verify
        // documents before they can go online. See `verify()` below for the manual override used in dev.
        isVerified: false,
        isAvailable: false,
      }),
    );

    // A supplied referral code that doesn't match any rider (typo, expired, made up) just
    // means no Referral row gets created — it deliberately never blocks signup itself.
    if (dto.referralCode) {
      const referrer = await this.riderRepo.findOne({ where: { referralCode: dto.referralCode.toUpperCase() } });
      if (referrer && referrer.id !== rider.id) {
        await this.referralRepo.save(this.referralRepo.create({ referrer, referee: rider }));
      }
    }

    return this.buildAuthResponse(rider);
  }

  async login(dto: DeliveryPartnerLoginDto) {
    const rider = await this.riderRepo.findOne({ where: { phone: dto.phone } });
    if (!rider) {
      throw new UnauthorizedException('Invalid phone number or password');
    }
    const matches = await bcrypt.compare(dto.password, rider.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid phone number or password');
    }
    return this.buildAuthResponse(rider);
  }

  private buildAuthResponse(rider: DeliveryPartner) {
    const payload = { sub: rider.id, phone: rider.phone, role: 'rider' };
    return {
      accessToken: this.jwtService.sign(payload),
      rider: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        isVerified: rider.isVerified,
        isAvailable: rider.isAvailable,
      },
    };
  }

  async findOne(id: string): Promise<DeliveryPartner> {
    const rider = await this.riderRepo.findOne({ where: { id } });
    if (!rider) {
      throw new NotFoundException(`Delivery partner ${id} not found`);
    }
    return rider;
  }

  async findAll(): Promise<DeliveryPartner[]> {
    return this.riderRepo.find();
  }

  // Dev/admin-only for now — no admin auth exists yet, matches the pattern used for restaurant approval
  async verify(id: string): Promise<DeliveryPartner> {
    const rider = await this.findOne(id);
    rider.isVerified = true;
    return this.riderRepo.save(rider);
  }

  async updateLocation(riderId: string, lat: number, lng: number): Promise<{ updated: true }> {
    await this.riderRepo
      .createQueryBuilder()
      .update(DeliveryPartner)
      .set({ currentLocation: () => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)` } as any)
      .where('id = :riderId', { riderId })
      .execute();
    return { updated: true };
  }

  async setAvailability(riderId: string, isAvailable: boolean): Promise<DeliveryPartner> {
    const rider = await this.findOne(riderId);
    if (isAvailable && !rider.isVerified) {
      throw new BadRequestException('Rider must be verified before going online');
    }
    rider.isAvailable = isAvailable;
    return this.riderRepo.save(rider);
  }

  // Called by OrdersService whenever a new rating comes in — keeps ratingAvg/ratingCount in sync
  async setRatingStats(id: string, ratingAvg: number, ratingCount: number): Promise<void> {
    await this.riderRepo.update(id, { ratingAvg, ratingCount });
  }

  /**
   * Find the nearest verified, available rider to a given point (typically the restaurant's location).
   * Returns null if none are within range — caller decides how to handle that (retry, widen radius, alert ops).
   */
  async findNearestAvailable(lat: number, lng: number, radiusMeters = 8000): Promise<DeliveryPartner | null> {
    const result = await this.riderRepo
      .createQueryBuilder('rider')
      .where('rider.isAvailable = true')
      .andWhere('rider.isVerified = true')
      .andWhere('rider.currentLocation IS NOT NULL')
      .andWhere(`ST_DWithin(rider.currentLocation, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :radius)`)
      .setParameters({ lat, lng, radius: radiusMeters })
      .orderBy(`ST_Distance(rider.currentLocation, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`, 'ASC')
      .getOne();

    return result ?? null;
  }

  /**
   * Lists every available, verified rider within range, nearest first — gives the restaurant
   * visibility into who's actually online before they assign, instead of the automatic
   * nearest-match being a total black box.
   */
  async listAvailableNearby(
    lat: number,
    lng: number,
    radiusMeters = 8000,
  ): Promise<(DeliveryPartner & { distanceMeters: number })[]> {
    const results = await this.riderRepo
      .createQueryBuilder('rider')
      .addSelect(`ST_Distance(rider.currentLocation, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`, 'distanceMeters')
      .where('rider.isAvailable = true')
      .andWhere('rider.isVerified = true')
      .andWhere('rider.currentLocation IS NOT NULL')
      .andWhere(`ST_DWithin(rider.currentLocation, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :radius)`)
      .setParameters({ lat, lng, radius: radiusMeters })
      .orderBy('"distanceMeters"', 'ASC')
      .getRawAndEntities();

    return results.entities.map((entity, i) => ({
      ...entity,
      distanceMeters: Math.round(parseFloat(results.raw[i].distanceMeters)),
    }));
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const account = await this.riderRepo.findOne({ where: { id } });
    if (!account || !account.passwordHash) throw new UnauthorizedException('Account not found or not yet claimed');
    const matches = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!matches) throw new UnauthorizedException('Current password is incorrect');
    account.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.riderRepo.save(account);
    return { changed: true };
  }

  // @Exclude() on the entity keeps these out of every normal find/findOne response — these
  // two are the only paths that ever expose or change them, and only for the rider's own
  // account (see the `me/bank-details` routes in the controller, not an :id param).
  async getBankDetails(riderId: string) {
    const rider = await this.riderRepo.findOne({ where: { id: riderId } });
    if (!rider) throw new NotFoundException('Rider not found');
    return { bankIfsc: rider.bankIfsc, bankAccountNumber: rider.bankAccountNumber };
  }

  async updateBankDetails(riderId: string, dto: UpdateBankDetailsDto) {
    const rider = await this.riderRepo.findOne({ where: { id: riderId } });
    if (!rider) throw new NotFoundException('Rider not found');
    rider.bankIfsc = dto.bankIfsc;
    rider.bankAccountNumber = dto.bankAccountNumber;
    await this.riderRepo.save(rider);
    return { bankIfsc: rider.bankIfsc, bankAccountNumber: rider.bankAccountNumber };
  }
}
