import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { ShiftBooking } from './entities/shift-booking.entity';
import { RiderIncentive } from './entities/rider-incentive.entity';
import { Announcement } from './entities/announcement.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { CreateShiftDto } from './dto/create-shift.dto';
import { CreateIncentiveDto } from './dto/create-incentive.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class RiderProgramsService {
  constructor(
    @InjectRepository(Shift) private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(ShiftBooking) private readonly shiftBookingRepo: Repository<ShiftBooking>,
    @InjectRepository(RiderIncentive) private readonly incentiveRepo: Repository<RiderIncentive>,
    @InjectRepository(Announcement) private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
  ) {}

  // ==================== Shifts ====================

  async createShift(dto: CreateShiftDto): Promise<Shift> {
    if (new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }
    if (dto.maxPayPerHour < dto.minPayPerHour) {
      throw new BadRequestException('maxPayPerHour must be at least minPayPerHour');
    }
    const shift = this.shiftRepo.create(dto);
    return this.shiftRepo.save(shift);
  }

  // Upcoming = hasn't ended yet, so a shift that's currently in progress still shows.
  // riderId is optional: the admin panel lists the same shifts without needing a "did I
  // book this" flag, which only makes sense from a rider's perspective.
  async listUpcomingShifts(riderId?: string) {
    const shifts = await this.shiftRepo.find({
      where: { active: true, endAt: MoreThanOrEqual(new Date()) },
      order: { startAt: 'ASC' },
    });

    // All bookings for the fetched shifts in one query, rather than N+1 per shift
    const bookingsByShift = await this.shiftBookingRepo
      .createQueryBuilder('booking')
      .leftJoin('booking.shift', 'shift')
      .leftJoin('booking.deliveryPartner', 'partner')
      .select(['booking.id', 'shift.id', 'partner.id'])
      .where('shift.id IN (:...ids)', { ids: shifts.length ? shifts.map((s) => s.id) : ['00000000-0000-0000-0000-000000000000'] })
      .getMany();

    return shifts.map((s) => {
      const forThisShift = bookingsByShift.filter((b) => b.shift?.id === s.id);
      return {
        id: s.id,
        label: s.label,
        startAt: s.startAt,
        endAt: s.endAt,
        minPayPerHour: Number(s.minPayPerHour),
        maxPayPerHour: Number(s.maxPayPerHour),
        bookedCount: forThisShift.length,
        bookedByMe: riderId ? forThisShift.some((b) => b.deliveryPartner?.id === riderId) : false,
      };
    });
  }

  async bookShift(shiftId: string, riderId: string) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
    if (!shift || !shift.active) {
      throw new NotFoundException('Shift not found');
    }
    if (new Date(shift.startAt) <= new Date()) {
      throw new BadRequestException('This shift has already started — too late to book it');
    }
    try {
      const booking = this.shiftBookingRepo.create({
        shift: { id: shiftId } as Shift,
        deliveryPartner: { id: riderId } as any,
      });
      await this.shiftBookingRepo.save(booking);
    } catch (err: any) {
      // 23505 = Postgres unique_violation — the DB-level index is what actually prevents a
      // double-booking race (two rapid taps), this catch just turns that into a clean 400
      // instead of a raw 500.
      if (err.code === '23505') {
        throw new BadRequestException('You already booked this shift');
      }
      throw err;
    }
    return { booked: true };
  }

  async unbookShift(shiftId: string, riderId: string) {
    const result = await this.shiftBookingRepo
      .createQueryBuilder()
      .delete()
      .where('"shiftId" = :shiftId AND "deliveryPartnerId" = :riderId', { shiftId, riderId })
      .execute();
    if (!result.affected) {
      throw new NotFoundException("You haven't booked this shift");
    }
    return { booked: false };
  }

  // ==================== Rider incentives ====================

  async createIncentive(dto: CreateIncentiveDto): Promise<RiderIncentive> {
    if (new Date(dto.validTo) <= new Date(dto.validFrom)) {
      throw new BadRequestException('validTo must be after validFrom');
    }
    const incentive = this.incentiveRepo.create(dto);
    return this.incentiveRepo.save(incentive);
  }

  async listAllIncentives() {
    return this.incentiveRepo.find({ order: { createdAt: 'DESC' } });
  }

  async deactivateIncentive(id: string) {
    const incentive = await this.incentiveRepo.findOne({ where: { id } });
    if (!incentive) throw new NotFoundException('Incentive not found');
    incentive.active = false;
    return this.incentiveRepo.save(incentive);
  }

  // Progress is always computed live from real delivered orders — never stored, so it can
  // never drift from what the rider actually did.
  async getMyIncentives(riderId: string) {
    const now = new Date();
    const active = await this.incentiveRepo.find({
      where: { active: true, validFrom: LessThanOrEqual(now), validTo: MoreThanOrEqual(now) },
      order: { validTo: 'ASC' },
    });

    return Promise.all(
      active.map(async (incentive) => {
        // Real delivered-order count within this incentive's window — via query builder
        // since it needs both a lower and upper bound on the same deliveredAt column.
        // Alias is "ord", not "order" — "order" is a reserved SQL keyword (as in ORDER BY)
        // and broke on any reference to it that wasn't quoted, which is exactly what
        // happened here: TypeORM quotes the alias in the generated FROM clause automatically,
        // but the raw WHERE fragments below wrote it unquoted in places, causing a real
        // "syntax error at or near order" in production, not just a style nit.
        const currentOrdersInWindow = await this.orderRepo
          .createQueryBuilder('ord')
          .where('ord."deliveryPartnerId" = :riderId', { riderId })
          .andWhere('ord.status = :status', { status: OrderStatus.DELIVERED })
          .andWhere('ord."deliveredAt" BETWEEN :from AND :to', { from: incentive.validFrom, to: incentive.validTo })
          .getCount();

        return {
          id: incentive.id,
          title: incentive.title,
          targetOrders: incentive.targetOrders,
          bonusAmount: Number(incentive.bonusAmount),
          validFrom: incentive.validFrom,
          validTo: incentive.validTo,
          currentOrders: currentOrdersInWindow,
          achieved: currentOrdersInWindow >= incentive.targetOrders,
        };
      }),
    );
  }

  // ==================== Announcements ====================

  async createAnnouncement(dto: CreateAnnouncementDto): Promise<Announcement> {
    const announcement = this.announcementRepo.create(dto);
    return this.announcementRepo.save(announcement);
  }

  async listActiveAnnouncements() {
    return this.announcementRepo.find({ where: { active: true }, order: { createdAt: 'DESC' } });
  }

  async listAllAnnouncements() {
    return this.announcementRepo.find({ order: { createdAt: 'DESC' } });
  }

  async deactivateAnnouncement(id: string) {
    const announcement = await this.announcementRepo.findOne({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    announcement.active = false;
    return this.announcementRepo.save(announcement);
  }
}
