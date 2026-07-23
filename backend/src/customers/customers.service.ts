import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
  ) {}

  private async findByUserId(userId: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { user: { id: userId } } });
    if (!customer) {
      throw new NotFoundException('Customer profile not found for this account');
    }
    return customer;
  }

  async getAddresses(userId: string) {
    const customer = await this.findByUserId(userId);
    return customer.savedLocations || [];
  }

  async addAddress(userId: string, dto: SaveAddressDto) {
    const customer = await this.findByUserId(userId);
    const newAddress = { id: crypto.randomUUID(), ...dto };
    customer.savedLocations = [...(customer.savedLocations || []), newAddress];
    await this.customerRepo.save(customer);
    return customer.savedLocations;
  }

  async removeAddress(userId: string, addressId: string) {
    const customer = await this.findByUserId(userId);
    customer.savedLocations = (customer.savedLocations || []).filter((a: any) => a.id !== addressId);
    await this.customerRepo.save(customer);
    return customer.savedLocations;
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const customer = await this.findByUserId(userId);
    const list = customer.savedLocations || [];
    const index = list.findIndex((a: any) => a.id === addressId);
    if (index === -1) {
      throw new NotFoundException('Saved address not found');
    }
    // dto arrives as a real UpdateAddressDto instance (ValidationPipe's transform: true +
    // this project's ES2023 target means every declared field — even ones the caller never
    // sent — exists on the instance, explicitly set to undefined). Spreading it directly
    // would let those undefined fields null out existing values on a partial update, so only
    // the keys actually present in the request body get merged in.
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const updated = { ...list[index], ...patch };
    customer.savedLocations = [...list.slice(0, index), updated, ...list.slice(index + 1)];
    await this.customerRepo.save(customer);
    return customer.savedLocations;
  }

  async getFavoriteRestaurants(userId: string) {
    const customer = await this.findByUserId(userId);
    const ids = customer.favoriteRestaurantIds || [];
    if (ids.length === 0) return [];
    // In() with an empty array is invalid SQL, hence the guard above. Order isn't
    // guaranteed to match favoriteRestaurantIds' order — acceptable for a favorites
    // list, not worth a second pass to re-sort for now.
    return this.restaurantRepo.find({ where: { id: In(ids) } });
  }

  async addFavorite(userId: string, restaurantId: string) {
    const customer = await this.findByUserId(userId);
    const current = customer.favoriteRestaurantIds || [];
    // Idempotent — favoriting an already-favorited restaurant just returns the same list,
    // doesn't create a duplicate entry
    if (!current.includes(restaurantId)) {
      customer.favoriteRestaurantIds = [...current, restaurantId];
      await this.customerRepo.save(customer);
    }
    return customer.favoriteRestaurantIds;
  }

  async removeFavorite(userId: string, restaurantId: string) {
    const customer = await this.findByUserId(userId);
    customer.favoriteRestaurantIds = (customer.favoriteRestaurantIds || []).filter((id) => id !== restaurantId);
    await this.customerRepo.save(customer);
    return customer.favoriteRestaurantIds;
  }
}
