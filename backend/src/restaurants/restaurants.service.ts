import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Restaurant, RestaurantStatus } from './entities/restaurant.entity';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { Offer } from '../offers/entities/offer.entity';
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
    @InjectRepository(MenuItem)
    private readonly menuItemRepo: Repository<MenuItem>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
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
    const coords = await this.restaurantRepo.manager.query(
      `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM restaurants WHERE id = $1`,
      [id],
    );
    if (coords[0]) {
      restaurant.latitude = Number(coords[0].lat);
      restaurant.longitude = Number(coords[0].lng);
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
      legalEntityName: r.legalEntityName,
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
  async findNearby(query: NearbyQueryDto): Promise<(Restaurant & { distanceMeters: number; matchedDishes?: string[] })[]> {
    const { lat, lng, radius = 5000, dish } = query;

    let matchingRestaurantIds: string[] | null = null;
    let dishesByRestaurant = new Map<string, string[]>();
    if (dish?.trim()) {
      // Case-insensitive substring match against currently-available dishes only — showing
      // a restaurant for something it's sold out of right now would be misleading, not
      // helpful. Spaces stripped from BOTH sides before comparing — "Icecream" (as
      // someone genuinely typed it) needs to match a search for "Ice Cream" (the
      // category button's natural-reading label), and this is a recurring class of
      // problem for compound food words generally (Butter Milk/Buttermilk, Pan Cake/
      // Pancake), not something worth special-casing one word at a time.
      const matches = await this.menuItemRepo
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.restaurant', 'restaurant')
        .where(`REPLACE(LOWER(item.name), ' ', '') LIKE :q`, { q: `%${dish.trim().toLowerCase().replace(/\s+/g, '')}%` })
        .andWhere('item.isAvailable = true')
        .getMany();
      matchingRestaurantIds = [...new Set(matches.map((m) => m.restaurant.id))];
      for (const m of matches) {
        const list = dishesByRestaurant.get(m.restaurant.id) ?? [];
        list.push(m.name);
        dishesByRestaurant.set(m.restaurant.id, list);
      }
      // No restaurant nearby serves this dish right now — short-circuit rather than run
      // the geo query at all, and definitely never fall through to "show everything"
      if (matchingRestaurantIds.length === 0) return [];
    }

    const qb = this.restaurantRepo
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
      .orderBy('"distanceMeters"', 'ASC');

    if (matchingRestaurantIds) {
      qb.andWhere('restaurant.id IN (:...ids)', { ids: matchingRestaurantIds });
    }

    const results = await qb.getRawAndEntities();
    const candidateIds = results.entities.map((e) => e.id);

    // Price range and "has an offer" — computed for the candidate set only (post geo/
    // approval/open filtering), not every restaurant in the table, and via their own
    // aggregate queries rather than per-row subqueries in the main geo query above.
    let priceRangeByRestaurant = new Map<string, { minPrice: number; maxPrice: number }>();
    let offerRestaurantIds = new Set<string>();
    if (candidateIds.length > 0) {
      const priceRows = await this.menuItemRepo
        .createQueryBuilder('item')
        .select('item.restaurantId', 'restaurantId')
        .addSelect('MIN(item.price)', 'minPrice')
        .addSelect('MAX(item.price)', 'maxPrice')
        .where('item.restaurantId IN (:...ids)', { ids: candidateIds })
        .andWhere('item.isAvailable = true')
        .groupBy('item.restaurantId')
        .getRawMany();
      for (const row of priceRows) {
        priceRangeByRestaurant.set(row.restaurantId, {
          minPrice: parseFloat(row.minPrice),
          maxPrice: parseFloat(row.maxPrice),
        });
      }

      // Deliberately simplified vs. the full per-customer eligibility engine in
      // OffersService (day-of-week, time-of-day, usage limits, audience) — running that
      // for every restaurant on a list view would be expensive and is more precision
      // than a list badge needs. "Has an offer" here means a real, currently-active,
      // automatic (no-code) offer within its date window, if it has one — the exact
      // discount is still confirmed honestly at checkout via the existing preview
      // endpoint, same as every other offer in the app already works.
      const todayStr = new Date().toISOString().slice(0, 10);
      const offerRows = await this.offerRepo
        .createQueryBuilder('offer')
        .select('offer.restaurantId', 'restaurantId')
        .where('offer.restaurantId IN (:...ids)', { ids: candidateIds })
        .andWhere('offer.active = true')
        .andWhere('offer.code IS NULL')
        .andWhere('(offer.startDate IS NULL OR offer.startDate <= :today)', { today: todayStr })
        .andWhere('(offer.endDate IS NULL OR offer.endDate >= :today)', { today: todayStr })
        .getRawMany();
      offerRestaurantIds = new Set(offerRows.map((r) => r.restaurantId));
    }

    // Merge the computed distance ONTO the entity instance (Object.assign) rather than
    // spreading into a plain object. This distinction is security-critical: the global
    // ClassSerializerInterceptor only strips @Exclude fields (passwordHash, pan, bank
    // details) from class instances — a spread copy is a plain object and leaked all of
    // them from this public endpoint until it was caught in Phase 4.
    return results.entities.map((entity, i) =>
      Object.assign(entity, {
        distanceMeters: Math.round(parseFloat(results.raw[i].distanceMeters)),
        ...(dishesByRestaurant.has(entity.id) ? { matchedDishes: [...new Set(dishesByRestaurant.get(entity.id))] } : {}),
        ...(priceRangeByRestaurant.has(entity.id) ? { priceRange: priceRangeByRestaurant.get(entity.id) } : {}),
        hasActiveOffer: offerRestaurantIds.has(entity.id),
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
