import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MenuItem } from './entities/menu-item.entity';
import { MenuItemVariantGroup } from './entities/menu-item-variant-group.entity';
import { MenuItemVariantOption } from './entities/menu-item-variant-option.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { fetchStockPhoto } from './stock-photo.util';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ListMenuItemsQueryDto } from './dto/list-menu-items-query.dto';
import { CreateVariantGroupDto } from './dto/create-variant-group.dto';
import { UpdateVariantGroupDto } from './dto/update-variant-group.dto';

@Injectable()
export class MenuItemsService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly menuItemRepo: Repository<MenuItem>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(MenuItemVariantGroup)
    private readonly variantGroupRepo: Repository<MenuItemVariantGroup>,
    @InjectRepository(MenuItemVariantOption)
    private readonly variantOptionRepo: Repository<MenuItemVariantOption>,
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

  async findAll(query: ListMenuItemsQueryDto): Promise<(MenuItem & { isBestseller?: boolean })[]> {
    const qb = this.menuItemRepo
      .createQueryBuilder('menuItem')
      .leftJoinAndSelect('menuItem.restaurant', 'restaurant')
      .leftJoinAndSelect('menuItem.variantGroups', 'variantGroups')
      .leftJoinAndSelect('variantGroups.options', 'options')
      .orderBy('variantGroups.sortOrder', 'ASC')
      .addOrderBy('options.sortOrder', 'ASC');

    if (query.restaurantId) {
      qb.where('restaurant.id = :restaurantId', { restaurantId: query.restaurantId });
    }

    const items = await qb.getMany();

    // Only worth computing when scoped to one restaurant — a real "top 3 by units sold" signal,
    // not a fabricated badge. Skipped for unscoped/global lists to avoid unnecessary cost.
    if (query.restaurantId) {
      const bestsellerIds = await this.getBestsellerIds(query.restaurantId);
      return items.map((item) => ({ ...item, isBestseller: bestsellerIds.has(item.id) }));
    }
    return items;
  }

  private async getBestsellerIds(restaurantId: string): Promise<Set<string>> {
    const rows = await this.menuItemRepo.manager.query(
      `SELECT oi."menuItemId", SUM(oi.quantity) as total_sold
       FROM order_items oi
       JOIN orders o ON o.id = oi."orderId"
       WHERE o."restaurantId" = $1 AND o.status = 'delivered'
       GROUP BY oi."menuItemId"
       ORDER BY total_sold DESC
       LIMIT 3`,
      [restaurantId],
    );
    return new Set(rows.map((r: any) => r.menuItemId));
  }

  async findOne(id: string): Promise<MenuItem> {
    const item = await this.menuItemRepo.findOne({
      where: { id },
      relations: { restaurant: true, variantGroups: { options: true } },
    });
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

  /**
   * Variant groups (Size, Spice Level, Add-ons) — created with their options in one call,
   * matching how the dashboard form actually submits: define the group, list its choices,
   * save once. Ownership is checked by the controller (same pattern as menu item mutations).
   */
  async createVariantGroup(menuItemId: string, dto: CreateVariantGroupDto): Promise<MenuItemVariantGroup> {
    const menuItem = await this.findOne(menuItemId);
    const group = this.variantGroupRepo.create({
      menuItem,
      name: dto.name,
      required: dto.required ?? false,
      selectionType: dto.selectionType ?? ('single' as any),
      sortOrder: menuItem.variantGroups?.length ?? 0,
      options: dto.options.map((o, i) =>
        this.variantOptionRepo.create({ label: o.label, priceDelta: o.priceDelta, sortOrder: i }),
      ),
    });
    return this.variantGroupRepo.save(group);
  }

  async findVariantGroup(groupId: string): Promise<MenuItemVariantGroup> {
    const group = await this.variantGroupRepo.findOne({
      where: { id: groupId },
      relations: { menuItem: { restaurant: true }, options: true },
    });
    if (!group) {
      throw new NotFoundException(`Variant group ${groupId} not found`);
    }
    return group;
  }

  /**
   * Full-replace update: options with an id are edited in place (preserving their id, so
   * any OrderItemOption FK pointing at them stays valid), options without an id are new,
   * and any existing option not present in the payload is deleted. Omitting `options`
   * entirely leaves the option list untouched — e.g. a pure rename of the group.
   */
  async updateVariantGroup(groupId: string, dto: UpdateVariantGroupDto): Promise<MenuItemVariantGroup> {
    const group = await this.findVariantGroup(groupId);
    if (dto.name !== undefined) group.name = dto.name;
    if (dto.required !== undefined) group.required = dto.required;
    if (dto.selectionType !== undefined) group.selectionType = dto.selectionType as any;

    if (dto.options) {
      const keepIds = new Set(dto.options.filter((o) => o.id).map((o) => o.id));
      const toRemove = group.options.filter((existing) => !keepIds.has(existing.id));
      if (toRemove.length) {
        await this.variantOptionRepo.remove(toRemove);
      }
      group.options = dto.options.map((o, i) => {
        const existing = o.id ? group.options.find((g) => g.id === o.id) : undefined;
        return this.variantOptionRepo.create({
          ...(existing ? { id: existing.id } : {}),
          label: o.label,
          priceDelta: o.priceDelta,
          sortOrder: i,
        });
      });
    }

    return this.variantGroupRepo.save(group);
  }

  async removeVariantGroup(groupId: string): Promise<void> {
    const result = await this.variantGroupRepo.delete(groupId);
    if (result.affected === 0) {
      throw new NotFoundException(`Variant group ${groupId} not found`);
    }
  }
}
