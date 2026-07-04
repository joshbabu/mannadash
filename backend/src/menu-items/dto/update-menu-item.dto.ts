import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateMenuItemDto } from './create-menu-item.dto';

// Items don't move between restaurants once created, so restaurantId is excluded from updates
export class UpdateMenuItemDto extends PartialType(
  OmitType(CreateMenuItemDto, ['restaurantId'] as const),
) {}
