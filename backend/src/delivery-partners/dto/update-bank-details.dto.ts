import { Matches } from 'class-validator';

export class UpdateBankDetailsDto {
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'bankIfsc must be a valid 11-character IFSC code (e.g. HDFC0001234)' })
  bankIfsc: string;

  @Matches(/^\d{9,18}$/, { message: 'bankAccountNumber must be 9-18 digits' })
  bankAccountNumber: string;
}
