import { Logger } from '@nestjs/common';

const logger = new Logger('StockPhotoFetcher');

/**
 * Tries Unsplash first (real, professional food photography — needs a free API key), then falls
 * back to Wikimedia Commons (lower quality but needs no key at all) if Unsplash isn't configured
 * or comes back empty. Either way, never throws — a failed lookup just means no photo, not a
 * broken menu item.
 *
 * Note: Unsplash's terms ask for photographer attribution when displaying their photos publicly.
 * This MVP doesn't show that yet — worth adding (a small "Photo: Unsplash" credit) before relying
 * on this for a real public launch, not just internal testing.
 */
export async function fetchStockPhoto(dishName: string): Promise<string | null> {
  const unsplashResult = await fetchFromUnsplash(dishName);
  if (unsplashResult) return unsplashResult;

  return fetchFromWikimedia(dishName);
}

async function fetchFromUnsplash(dishName: string): Promise<string | null> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return null; // not configured — silently skip to the free fallback

  try {
    const searchTerm = encodeURIComponent(`${dishName} food`);
    const url = `https://api.unsplash.com/search/photos?query=${searchTerm}&per_page=1&orientation=squarish`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.urls?.small || null;
  } catch (err) {
    logger.warn(`Unsplash lookup failed for "${dishName}": ${err?.message}`);
    return null;
  }
}

async function fetchFromWikimedia(dishName: string): Promise<string | null> {
  try {
    const searchTerm = encodeURIComponent(`${dishName} food dish`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${searchTerm}&gsrlimit=1&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    const firstPage = Object.values(pages)[0] as any;
    return firstPage?.imageinfo?.[0]?.thumburl || null;
  } catch (err) {
    logger.warn(`Wikimedia fallback lookup failed for "${dishName}": ${err?.message}`);
    return null;
  }
}
