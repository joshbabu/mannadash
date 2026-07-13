import { Injectable, Logger } from '@nestjs/common';
import { fetchStockPhoto } from './stock-photo.util';

// The same 15 categories as QUICK_CATEGORIES in the customer app's RestaurantListScreen —
// kept in sync manually since this is backend code and that's frontend, but the list is
// small and rarely changes. Uses the display label (plural), not the singular searchTerm
// override used for dish-name text search — photo search doesn't have the same substring-
// matching concern, "Cakes" finds perfectly good cake photos on its own.
const CATEGORY_LABELS = [
  'Biryani', 'Pizza', 'Burgers', 'Shawarma', 'Momos', 'Noodles', 'Dosa', 'Idli',
  'Pasta', 'Fries', 'Salad', 'Cakes', 'Pastry', 'Ice Cream', 'Shake',
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — these rarely change, and Unsplash's free
// tier has a real hourly rate limit, so re-fetching on every single page load across every
// customer would burn through it fast for zero benefit (the same 15 terms, over and over).

@Injectable()
export class CategoryPhotosService {
  private readonly logger = new Logger(CategoryPhotosService.name);
  private cache: { photos: Record<string, string | null>; fetchedAt: number } | null = null;
  private inFlight: Promise<Record<string, string | null>> | null = null;

  async getCategoryPhotos(): Promise<Record<string, string | null>> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.photos;
    }
    // Multiple simultaneous requests while the cache is cold (e.g. right after a deploy)
    // should share one fetch, not each independently hammer the photo APIs
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchAll();
    try {
      const photos = await this.inFlight;
      this.cache = { photos, fetchedAt: Date.now() };
      return photos;
    } finally {
      this.inFlight = null;
    }
  }

  private async fetchAll(): Promise<Record<string, string | null>> {
    const entries = await Promise.all(
      CATEGORY_LABELS.map(async (label) => {
        try {
          const url = await fetchStockPhoto(label);
          return [label, url] as const;
        } catch (err: any) {
          // Same never-throw contract as fetchStockPhoto itself — one bad lookup
          // shouldn't take down the whole category row for every customer
          this.logger.warn(`Category photo lookup failed for "${label}": ${err?.message}`);
          return [label, null] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
