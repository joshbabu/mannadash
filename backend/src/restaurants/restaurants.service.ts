import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Restaurant, RestaurantStatus } from './entities/restaurant.entity';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { NearbyQueryDto } from './dto/nearby-query.dto';
import { RestaurantSignupDto } from './dto/restaurant-signup.dto';
import { RestaurantLoginDto } from './dto/restaurant-login.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    private readonly jwtService: JwtService,
  ) {}

  async create(dto: CreateRestaurantDto): Promise<Restaurant> {
    const { latitude, longitude, ...rest } = dto;

    // Build via query builder so we can pass a raw PostGIS point expression
    const insertResult = await this.restaurantRepo
      .createQueryBuilder()
      .insert()
      .into(Restaurant)
      .values({
        ...rest,
        location: () => `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`,
      } as any)
      .returning('*')
      .execute();

    // Re-fetch as a real Restaurant instance: raw[0] is a plain object, and the global
    // ClassSerializerInterceptor only strips @Exclude fields (pan, bank details, passwordHash)
    // from class instances — returning raw[0] directly would leak them in the create response.
    return this.findOne(insertResult.raw[0].id);
  }

  async findAll(): Promise<Restaurant[]> {
    return this.restaurantRepo.find();
  }

  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.restaurantRepo.findOne({ where: { id } });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
    return restaurant;
  }

  // Explicit plain object (not the entity) so the @Exclude decorators on pan/bank fields don't
  // strip the very values this admin/owner-only endpoint exists to return.
  async getKyc(id: string) {
    const r = await this.findOne(id);
    return {
      restaurantId: r.id,
      ownerName: r.ownerName,
      ownerEmail: r.ownerEmail,
      whatsappNumber: r.whatsappNumber,
      fssaiNumber: r.fssaiNumber,
      fssaiExpiry: r.fssaiExpiry,
      pan: r.pan,
      gstin: r.gstin,
      bankIfsc: r.bankIfsc,
      bankAccountNumber: r.bankAccountNumber,
    };
  }

  async update(id: string, dto: UpdateRestaurantDto): Promise<Restaurant> {
    await this.findOne(id); // throws 404 if missing

    const { latitude, longitude, ...rest } = dto;

    const qb = this.restaurantRepo.createQueryBuilder().update(Restaurant).where('id = :id', { id });

    const setValues: Record<string, any> = { ...rest };
    if (latitude !== undefined && longitude !== undefined) {
      setValues.location = () => `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`;
    }

    await qb.set(setValues).execute();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.restaurantRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
  }

  // Dev/admin-only for now — no admin auth exists yet, same pattern as DeliveryPartnersService.verify
  async setStatus(id: string, status: RestaurantStatus): Promise<Restaurant> {
    const restaurant = await this.findOne(id);
    restaurant.status = status;
    return this.restaurantRepo.save(restaurant);
  }

  // Called by OrdersService whenever a new rating comes in — keeps ratingAvg/ratingCount in sync
  async setRatingStats(id: string, ratingAvg: number, ratingCount: number): Promise<void> {
    await this.restaurantRepo.update(id, { ratingAvg, ratingCount });
  }

  /**
   * Find approved, open restaurants within `radius` meters of the given point,
   * ordered nearest-first. This is the core "restaurants near me" query.
   */
  async findNearby(query: NearbyQueryDto): Promise<(Restaurant & { distanceMeters: number })[]> {
    const { lat, lng, radius = 5000 } = query;

    const results = await this.restaurantRepo
      .createQueryBuilder('restaurant')
      .addSelect(
        `ST_Distance(restaurant.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`,
        'distanceMeters',
      )
      .where(
        `ST_DWithin(restaurant.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :radius)`,
      )
      .andWhere('restaurant.status = :status', { status: 'approved' })
      .andWhere('restaurant.isOpen = true')
      .setParameters({ lat, lng, radius })
      .orderBy('"distanceMeters"', 'ASC')
      .getRawAndEntities();

    // Merge the computed distance ONTO the entity instance (Object.assign) rather than
    // spreading into a plain object. This distinction is security-critical: the global
    // ClassSerializerInterceptor only strips @Exclude fields (passwordHash, pan, bank
    // details) from class instances — a spread copy is a plain object and leaked all of
    // them from this public endpoint until it was caught in Phase 4.
    return results.entities.map((entity, i) =>
      Object.assign(entity, {
        distanceMeters: Math.round(parseFloat(results.raw[i].distanceMeters)),
      }),
    );
  }

  /**
   * Lets an owner "claim" a restaurant that was already created (e.g. via an application/onboarding
   * step using `create()` above) by setting a password on it. One password per restaurant for MVP —
   * if you need multiple staff logins per restaurant later, split this into a separate Owner entity.
   */
  async signup(dto: RestaurantSignupDto) {
    const restaurant = await this.findOne(dto.restaurantId);

    if (restaurant.passwordHash) {
      throw new ConflictException('This restaurant has already been claimed by an owner');
    }

    restaurant.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    await this.restaurantRepo.save(restaurant);

    return this.buildAuthResponse(restaurant);
  }

  async login(dto: RestaurantLoginDto) {
    const restaurant = await this.restaurantRepo.findOne({ where: { phone: dto.phone } });
    if (!restaurant || !restaurant.passwordHash) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    const matches = await bcrypt.compare(dto.password, restaurant.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    return this.buildAuthResponse(restaurant);
  }

  private buildAuthResponse(restaurant: Restaurant) {
    const payload = { sub: restaurant.id, phone: restaurant.phone, role: 'restaurant' };
    return {
      accessToken: this.jwtService.sign(payload),
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        phone: restaurant.phone,
        status: restaurant.status,
      },
    };
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const account = await this.restaurantRepo.findOne({ where: { id } });
    if (!account || !account.passwordHash) throw new UnauthorizedException('Account not found or not yet claimed');
    const matches = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!matches) throw new UnauthorizedException('Current password is incorrect');
    account.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.restaurantRepo.save(account);
    return { changed: true };
  }
}
