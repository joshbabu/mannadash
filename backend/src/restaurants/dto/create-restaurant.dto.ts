import { IsBoolean, IsDateString, IsEmail, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { IsWeeklyHours } from './is-weekly-hours.validator';
import type { WeeklyHours } from '../operating-hours.util';

export class CreateRestaurantDto {
  @IsString()
  ownerName: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  cuisineType: string;

  @IsString()
  address: string;

  // Plain lat/lng from the client — service converts this to a PostGIS point
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsString()
  phone: string;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;

  @IsOptional()
  @IsNumber()
  commissionRate?: number;

  @IsOptional()
  @IsInt()
  avgPrepTimeMins?: number;

  // HH:MM 24-hour format, e.g. "09:00" and "22:00" — both optional, omit for "always open"
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'openTime must be in HH:MM 24-hour format' })
  openTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'closeTime must be in HH:MM 24-hour format' })
  closeTime?: string;

  // === Onboarding wizard fields — every one optional, so the pre-wizard flat form (and every
  // existing test) keeps working unchanged ===

  @IsOptional()
  @IsEmail({}, { message: 'ownerEmail must be a valid email address' })
  ownerEmail?: string;

  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'whatsappNumber must be a 10-digit Indian mobile number' })
  whatsappNumber?: string;

  // { monday: { open: 'HH:MM', close: 'HH:MM' } | null, ... } — see IsWeeklyHours for the rules
  @IsOptional()
  @IsWeeklyHours()
  weeklyHours?: WeeklyHours;

  // FSSAI licence numbers are exactly 14 digits
  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'fssaiNumber must be a 14-digit FSSAI licence number' })
  fssaiNumber?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fssaiExpiry must be an ISO date (YYYY-MM-DD)' })
  fssaiExpiry?: string;

  @IsOptional()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'pan must be a valid PAN (e.g. AAMCR7443M)' })
  pan?: string;

  @IsOptional()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'gstin must be a valid 15-character GSTIN' })
  gstin?: string;

  @IsOptional()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'bankIfsc must be a valid IFSC code (e.g. HDFC0001234)' })
  bankIfsc?: string;

  @IsOptional()
  @Matches(/^\d{9,18}$/, { message: 'bankAccountNumber must be 9–18 digits' })
  bankAccountNumber?: string;

  @IsOptional()
  @IsBoolean()
  isVegOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  costForTwo?: number;
}
