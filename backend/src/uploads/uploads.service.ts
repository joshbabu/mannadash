import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID', '');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY', '');
    this.bucketName = this.config.get<string>('R2_MENU_IMAGES_BUCKET', '');
    this.publicBaseUrl = this.config.get<string>('R2_MENU_IMAGES_PUBLIC_URL', '');

    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucketName || !this.publicBaseUrl) {
      // Same pattern as RazorpayService — don't crash the whole app just because image uploads
      // aren't configured yet. Only fail when someone actually tries to upload something.
      this.logger.warn(
        'R2 image upload env vars not fully set — menu photo uploads will fail until configured in .env',
      );
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /**
   * Uploads a base64-encoded image to the public menu-images R2 bucket and returns its public URL.
   * Accepts a data URI (e.g. "data:image/jpeg;base64,...") or raw base64 — either works.
   */
  async uploadMenuItemImage(base64Data: string): Promise<string> {
    if (!this.client) {
      throw new BadRequestException(
        'Image uploads are not configured yet — set the R2_* image env vars in .env',
      );
    }

    const matches = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
    const contentType = matches ? matches[1] : 'image/jpeg';
    const rawBase64 = matches ? matches[2] : base64Data;
    const buffer = Buffer.from(rawBase64, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Image is too large — please use one under 5MB');
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const key = `menu-items/${randomUUID()}.${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return `${this.publicBaseUrl}/${key}`;
  }
}
