import { PartialType } from '@nestjs/mapped-types';
import { CreateRestaurantDto } from './create-restaurant.dto';

// status is intentionally excluded — owners shouldn't be able to self-approve.
// See RestaurantsController.setStatus for the admin-only path that changes status.
export class UpdateRestaurantDto extends PartialType(CreateRestaurantDto) {}
