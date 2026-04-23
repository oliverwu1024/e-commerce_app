import { faker } from '@faker-js/faker';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const IMAGE_KEYWORDS: Record<string, string> = {
  Phones: 'smartphone',
  Laptops: 'laptop',
  Desktops: 'desktop-computer',
  Tablets: 'tablet',
  Consoles: 'game-console',
  Cameras: 'camera',
  Audio: 'headphones',
  Accessories: 'keyboard',
  'PC Parts': 'computer-hardware',
};

function placeholderImageUrl(category: string): string {
  const keyword = IMAGE_KEYWORDS[category] ?? 'electronics';
  const lock = faker.number.int({ min: 1, max: 100000 });
  return `https://loremflickr.com/600/400/${keyword}?lock=${lock}`;
}

async function main() {
  const listings = await prisma.listing.findMany({
    select: { id: true, category: true, images: { select: { id: true } } },
  });

  console.log(`Found ${listings.length} listings.`);

  let inserted = 0;
  let updated = 0;

  for (const listing of listings) {
    if (listing.images.length === 0) {
      await prisma.listingImage.create({
        data: {
          listingId: listing.id,
          url: placeholderImageUrl(listing.category),
          displayOrder: 0,
        },
      });
      inserted++;
    } else {
      for (const img of listing.images) {
        await prisma.listingImage.update({
          where: { id: img.id },
          data: { url: placeholderImageUrl(listing.category) },
        });
        updated++;
      }
    }
  }

  console.log(`Inserted ${inserted} new images, refreshed ${updated} existing.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
