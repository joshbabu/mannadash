import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItemsService } from './menu-items.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItem } from './entities/menu-item.entity';
import { MenuItemVariantGroup } from './entities/menu-item-variant-group.entity';
import { MenuItemVariantOption } from './entities/menu-item-variant-option.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MenuItem, MenuItemVariantGroup, MenuItemVariantOption, Restaurant]),
    AuthModule,
    UploadsModule,
  ],
  providers: [MenuItemsService],
  controllers: [MenuItemsController],
})
export class MenuItemsModule {}
