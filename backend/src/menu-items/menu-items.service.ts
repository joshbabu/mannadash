import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MenuItem } from './entities/menu-item.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { fetchStockPhoto } from './stock-photo.util';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ListMenuItemsQueryDto } from './dto/list-menu-items-query.dto';

@Injectable()
export class MenuItemsService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly menuItemRepo: Repository<MenuItem>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
  ) {}

  async create(dto: CreateMenuItemDto): Promise<MenuItem> {
    const { restaurantId, ...rest } = dto;

    const restaurant = await this.restaurantRepo.findOne({ where: { id: restaurantId } });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${restaurantId} not found`);
    }

    // Default to a real, relevant photo automatically rather than a blank generic icon —
    // the restaurant can still override this any time via the manual upload endpoint.
    const imageUrl = rest.imageUrl || (await fetchStockPhoto(rest.name)) || undefined;

    const menuItem = this.menuItemRepo.create({ ...rest, imageUrl, restaurant });
    return this.menuItemRepo.save(menuItem);
  }

  async findAll(query: ListMenuItemsQueryDto): Promise<MenuItem[]> {
    const qb = this.menuItemRepo.createQueryBuilder('menuItem').leftJoinAndSelect('menuItem.restaurant', 'restaurant');

    if (query.restaurantId) {
      qb.where('restaurant.id = :restaurantId', { restaurantId: query.restaurantId });
    }

    return qb.getMany();
  }

  async findOne(id: string): Promise<MenuItem> {
    const item = await this.menuItemRepo.findOne({ where: { id }, relations: { restaurant: true } });
    if (!item) {
      throw new NotFoundException(`Menu item ${id} not found`);
    }
    return item;
  }

  async update(id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const item = await this.findOne(id); // throws 404 if missing
    Object.assign(item, dto);
    return this.menuItemRepo.save(item);
  }

  // Convenience for the restaurant dashboard's "86 this item" toggle — doesn't need a full update payload
  async setAvailability(id: string, isAvailable: boolean): Promise<MenuItem> {
    const item = await this.findOne(id);
    item.isAvailable = isAvailable;
    return this.menuItemRepo.save(item);
  }

  async remove(id: string): Promise<void> {
    const result = await this.menuItemRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Menu item ${id} not found`);
    }
  }
}
