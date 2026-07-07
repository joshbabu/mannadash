import { Logger } from '@nestjs/common';

const logger = new Logger('StockPhotoFetcher');

/**
 * Searches Wikimedia Commons (a huge public-domain/CC-licensed image library) for a photo
 * matching the given dish name, and returns a thumbnail URL — or null if nothing decent was
 * found. No API key needed, unlike Unsplash/Pexels/etc., so nothing extra to configure.
 *
 * This is a genuine best-effort default, not a guarantee of a perfect match — a restaurant can
 * always override it with their own real photo via the manual upload endpoint.
 */
export async function fetchStockPhoto(dishName: string): Promise<string | null> {
  try {
    const searchTerm = encodeURIComponent(`${dishName} food dish`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${searchTerm}&gsrlimit=1&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // don't let a slow lookup block order-taking
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    const firstPage = Object.values(pages)[0] as any;
    return firstPage?.imageinfo?.[0]?.thumburl || null;
  } catch (err) {
    // Never let a failed photo lookup break menu item creation — just skip it, the item still
    // gets created, falling back to the generic placeholder icon in the UI
    logger.warn(`Stock photo lookup failed for "${dishName}": ${err?.message}`);
    return null;
  }
}
