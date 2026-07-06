import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { MenuItemsService } from './menu-items.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ListMenuItemsQueryDto } from './dto/list-menu-items-query.dto';
import { UploadImageDto } from './dto/upload-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadsService } from '../uploads/uploads.service';

class SetAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

@Controller('menu-items')
export class MenuItemsController {
  constructor(
    private readonly menuItemsService: MenuItemsService,
    private readonly uploadsService: UploadsService,
  ) {}

  // Owner-only — can only add items to their own restaurant
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateMenuItemDto) {
    if (req.user.userId !== dto.restaurantId) {
      throw new ForbiddenException('You can only add menu items to your own restaurant');
    }
    return this.menuItemsService.create(dto);
  }

  @Get()
  findAll(@Query() query: ListMenuItemsQueryDto) {
    return this.menuItemsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuItemsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuItemDto) {
    const item = await this.menuItemsService.findOne(id);
    if (item.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only update your own restaurant\'s menu items');
    }
    return this.menuItemsService.update(id, dto);
  }

  // Quick toggle for restaurant dashboard, avoids sending a full update payload just to flip one flag
  @UseGuards(JwtAuthGuard)
  @Patch(':id/availability')
  async setAvailability(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAvailabilityDto) {
    const item = await this.menuItemsService.findOne(id);
    if (item.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only update your own restaurant\'s menu items');
    }
    return this.menuItemsService.setAvailability(id, dto.isAvailable);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/image')
  async uploadImage(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadImageDto) {
    const item = await this.menuItemsService.findOne(id);
    if (item.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only update your own restaurant\'s menu items');
    }
    const imageUrl = await this.uploadsService.uploadMenuItemImage(dto.imageBase64);
    return this.menuItemsService.update(id, { imageUrl });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const item = await this.menuItemsService.findOne(id);
    if (item.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only delete your own restaurant\'s menu items');
    }
    return this.menuItemsService.remove(id);
  }
}
