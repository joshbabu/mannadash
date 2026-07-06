import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { SaveAddressDto } from './dto/save-address.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
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
}
