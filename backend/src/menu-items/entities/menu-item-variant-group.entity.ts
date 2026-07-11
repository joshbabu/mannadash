import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { MenuItemVariantOption } from './menu-item-variant-option.entity';

export enum VariantSelectionType {
  SINGLE = 'single', // radio — Size: pick exactly one
  MULTIPLE = 'multiple', // checkboxes — Add-ons: pick zero or more
}

/**
 * A customization axis on a dish — "Size" (Small/Medium/Large) or "Spice Level"
 * (Mild/Medium/Hot), each owning its own set of MenuItemVariantOption choices.
 * A dish can have several of these (Size AND Spice Level independently).
 */
@Entity('menu_item_variant_groups')
export class MenuItemVariantGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  menuItem: MenuItem;

  @Column()
  name: string;

  // Required groups force a choice before the item can be added to cart (e.g. Size is
  // usually required; a "Toppings" add-on group usually isn't).
  @Column({ default: false })
  required: boolean;

  @Column({ type: 'varchar', default: VariantSelectionType.SINGLE })
  selectionType: VariantSelectionType;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => MenuItemVariantOption, (option) => option.group, { cascade: true })
  options: MenuItemVariantOption[];
}
