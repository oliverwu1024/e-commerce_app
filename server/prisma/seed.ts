import { faker } from '@faker-js/faker';
import { PrismaClient, Condition, ListingStatus, OrderStatus } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Realistic product catalogue
// ---------------------------------------------------------------------------

type ProductEntry = {
  title: string;
  brand: string;
  subcategory?: string;
  platform?: string;
  basePrice: number; // "Like New" price
};

type CategoryData = {
  products: ProductEntry[];
  descriptionTemplate: (p: ProductEntry, condition: Condition) => string;
};

const conditionMultiplier: Record<Condition, number> = {
  LIKE_NEW: 1.0,
  GOOD: 0.8,
  FAIR: 0.6,
  POOR: 0.4,
};

const categories: Record<string, CategoryData> = {
  Phones: {
    products: [
      { title: 'iPhone 15 Pro Max', brand: 'Apple', platform: 'iOS', basePrice: 1600 },
      { title: 'iPhone 14 Pro', brand: 'Apple', platform: 'iOS', basePrice: 1200 },
      { title: 'iPhone 13', brand: 'Apple', platform: 'iOS', basePrice: 800 },
      { title: 'Samsung Galaxy S24 Ultra', brand: 'Samsung', platform: 'Android', basePrice: 1500 },
      { title: 'Samsung Galaxy S23', brand: 'Samsung', platform: 'Android', basePrice: 900 },
      { title: 'Google Pixel 8 Pro', brand: 'Google', platform: 'Android', basePrice: 1100 },
      { title: 'Google Pixel 7a', brand: 'Google', platform: 'Android', basePrice: 500 },
      { title: 'OnePlus 12', brand: 'OnePlus', platform: 'Android', basePrice: 850 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Comes with original box and charger.',
        'No scratches on the screen.',
        'Battery health above 85%.',
        'Includes a case and screen protector.',
        'Factory reset, ready to use.',
      ])} ${faker.lorem.sentence()}`,
  },

  Laptops: {
    products: [
      { title: 'MacBook Air M2 13"', brand: 'Apple', platform: 'macOS', basePrice: 1500 },
      { title: 'MacBook Pro M3 14"', brand: 'Apple', platform: 'macOS', basePrice: 2400 },
      { title: 'Dell XPS 15', brand: 'Dell', platform: 'Windows', basePrice: 1300 },
      { title: 'ThinkPad X1 Carbon Gen 11', brand: 'Lenovo', platform: 'Windows', basePrice: 1400 },
      { title: 'ASUS ROG Zephyrus G14', brand: 'ASUS', platform: 'Windows', basePrice: 1600 },
      { title: 'HP Spectre x360', brand: 'HP', platform: 'Windows', basePrice: 1200 },
      { title: 'Framework Laptop 16', brand: 'Framework', platform: 'Linux', basePrice: 1400 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Great for development and everyday use.',
        'Powerful enough for video editing.',
        'Lightweight and portable.',
        'Excellent keyboard and trackpad.',
        'Upgraded RAM and SSD.',
      ])} ${faker.lorem.sentence()}`,
  },

  Desktops: {
    products: [
      { title: 'Mac Mini M2', brand: 'Apple', platform: 'macOS', basePrice: 700 },
      { title: 'Mac Studio M2 Max', brand: 'Apple', platform: 'macOS', basePrice: 2500 },
      { title: 'Custom Gaming PC (RTX 4070)', brand: 'Custom', platform: 'Windows', basePrice: 1400 },
      { title: 'Dell OptiPlex 7010', brand: 'Dell', platform: 'Windows', basePrice: 600 },
      { title: 'HP Pavilion Desktop', brand: 'HP', platform: 'Windows', basePrice: 550 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Runs quietly and stays cool.',
        'Perfect for a home office setup.',
        'Includes monitor, keyboard and mouse.',
        'Recently cleaned and repasted.',
      ])} ${faker.lorem.sentence()}`,
  },

  Tablets: {
    products: [
      { title: 'iPad Pro 12.9" M2', brand: 'Apple', platform: 'iOS', basePrice: 1300 },
      { title: 'iPad Air M1', brand: 'Apple', platform: 'iOS', basePrice: 700 },
      { title: 'Samsung Galaxy Tab S9', brand: 'Samsung', platform: 'Android', basePrice: 850 },
      { title: 'Microsoft Surface Pro 9', brand: 'Microsoft', platform: 'Windows', basePrice: 1100 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Perfect for note-taking and drawing.',
        'Comes with stylus and keyboard cover.',
        'Great media consumption device.',
        'Battery lasts all day.',
      ])} ${faker.lorem.sentence()}`,
  },

  'PC Parts': {
    products: [
      { title: 'NVIDIA RTX 4090', brand: 'NVIDIA', subcategory: 'GPU', basePrice: 2200 },
      { title: 'NVIDIA RTX 4070 Ti', brand: 'NVIDIA', subcategory: 'GPU', basePrice: 900 },
      { title: 'AMD RX 7900 XTX', brand: 'AMD', subcategory: 'GPU', basePrice: 1000 },
      { title: 'AMD Ryzen 9 7950X', brand: 'AMD', subcategory: 'CPU', basePrice: 550 },
      { title: 'Intel Core i9-14900K', brand: 'Intel', subcategory: 'CPU', basePrice: 600 },
      { title: 'Intel Core i5-13600K', brand: 'Intel', subcategory: 'CPU', basePrice: 280 },
      { title: 'Corsair Vengeance 32GB DDR5', brand: 'Corsair', subcategory: 'RAM', basePrice: 120 },
      { title: 'Samsung 990 Pro 2TB NVMe', brand: 'Samsung', subcategory: 'Storage', basePrice: 200 },
      { title: 'ASUS ROG Strix B650E-F', brand: 'ASUS', subcategory: 'Motherboard', basePrice: 300 },
      { title: 'Corsair RM850x PSU', brand: 'Corsair', subcategory: 'PSU', basePrice: 140 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Never overclocked.',
        'Used for about a year, works perfectly.',
        'Upgraded so no longer needed.',
        'Comes in original packaging.',
        'Pulled from a working build.',
      ])} ${faker.lorem.sentence()}`,
  },

  Consoles: {
    products: [
      { title: 'PlayStation 5', brand: 'Sony', basePrice: 650 },
      { title: 'PlayStation 5 Digital Edition', brand: 'Sony', basePrice: 500 },
      { title: 'Xbox Series X', brand: 'Microsoft', basePrice: 600 },
      { title: 'Xbox Series S', brand: 'Microsoft', basePrice: 350 },
      { title: 'Nintendo Switch OLED', brand: 'Nintendo', basePrice: 400 },
      { title: 'Steam Deck 512GB', brand: 'Valve', basePrice: 550 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Comes with one controller.',
        'Includes 3 games.',
        'Barely used, mostly sat in the TV cabinet.',
        'Adult-owned, no kids.',
        'Firmware up to date.',
      ])} ${faker.lorem.sentence()}`,
  },

  Cameras: {
    products: [
      { title: 'Sony A7 IV', brand: 'Sony', basePrice: 2800 },
      { title: 'Canon EOS R6 Mark II', brand: 'Canon', basePrice: 2700 },
      { title: 'Fujifilm X-T5', brand: 'Fujifilm', basePrice: 1900 },
      { title: 'Nikon Z6 III', brand: 'Nikon', basePrice: 2500 },
      { title: 'GoPro Hero 12', brand: 'GoPro', basePrice: 450 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Low shutter count.',
        'Body only, no lens included.',
        'Includes kit lens and bag.',
        'Perfect for content creators.',
        'Barely taken out of the house.',
      ])} ${faker.lorem.sentence()}`,
  },

  Audio: {
    products: [
      { title: 'AirPods Pro 2', brand: 'Apple', basePrice: 350 },
      { title: 'Sony WH-1000XM5', brand: 'Sony', basePrice: 400 },
      { title: 'Bose QuietComfort Ultra', brand: 'Bose', basePrice: 450 },
      { title: 'Sennheiser HD 660S2', brand: 'Sennheiser', basePrice: 500 },
      { title: 'Audio-Technica ATH-M50x', brand: 'Audio-Technica', basePrice: 180 },
      { title: 'JBL Charge 5', brand: 'JBL', basePrice: 180 },
      { title: 'Sonos Era 300', brand: 'Sonos', basePrice: 500 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Amazing sound quality.',
        'Noise cancellation works perfectly.',
        'Includes all original accessories.',
        'Ear pads recently replaced.',
        'Bluetooth pairs instantly.',
      ])} ${faker.lorem.sentence()}`,
  },

  Accessories: {
    products: [
      { title: 'Apple Watch Series 9', brand: 'Apple', basePrice: 550 },
      { title: 'Samsung Galaxy Watch 6', brand: 'Samsung', basePrice: 350 },
      { title: 'Logitech MX Master 3S', brand: 'Logitech', basePrice: 120 },
      { title: 'Razer BlackWidow V4', brand: 'Razer', basePrice: 180 },
      { title: 'Elgato Stream Deck MK.2', brand: 'Elgato', basePrice: 180 },
      { title: 'Anker 737 Power Bank', brand: 'Anker', basePrice: 120 },
      { title: 'CalDigit TS4 Thunderbolt Dock', brand: 'CalDigit', basePrice: 400 },
    ],
    descriptionTemplate: (p, cond) =>
      `${p.title} in ${cond.replace('_', ' ').toLowerCase()} condition. ${faker.helpers.arrayElement([
        'Works flawlessly.',
        'Barely used, like new in box.',
        'Great add-on for any setup.',
        'Selling because I upgraded.',
      ])} ${faker.lorem.sentence()}`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const australianCities = [
  'Sydney, NSW',
  'Melbourne, VIC',
  'Brisbane, QLD',
  'Perth, WA',
  'Adelaide, SA',
  'Canberra, ACT',
  'Hobart, TAS',
  'Gold Coast, QLD',
  'Newcastle, NSW',
  'Wollongong, NSW',
];

function randomCondition(): Condition {
  return faker.helpers.arrayElement([
    Condition.LIKE_NEW,
    Condition.GOOD,
    Condition.FAIR,
    Condition.POOR,
  ]);
}

function priceForCondition(basePrice: number, condition: Condition): number {
  const jitter = faker.number.float({ min: -0.05, max: 0.05 });
  const raw = basePrice * (conditionMultiplier[condition] + jitter);
  return Math.round(raw / 5) * 5; // round to nearest $5
}

function randomDate(daysAgo: number): Date {
  return faker.date.recent({ days: daysAgo });
}

function placeholderImageUrl(title: string): string {
  return `https://placehold.co/600x400?text=${encodeURIComponent(title.slice(0, 30))}`;
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Clearing existing data...');
  await prisma.review.deleteMany();
  await prisma.order.deleteMany();
  await prisma.savedListing.deleteMany();
  await prisma.listingImage.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();

  // --- Users ---------------------------------------------------------------
  console.log('Creating users...');
  const usersData = Array.from({ length: 10 }, () => ({
    email: faker.internet.email().toLowerCase(),
    username: faker.internet.username().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    password: '$2b$10$dummyhashedpasswordforseeding000000000000000000', // placeholder
    name: faker.person.fullName(),
    location: faker.helpers.arrayElement(australianCities),
    bio: faker.lorem.sentence(),
    createdAt: randomDate(90),
  }));

  const users = await Promise.all(
    usersData.map((u) => prisma.user.create({ data: u }))
  );
  console.log(`  Created ${users.length} users`);

  // --- Listings ------------------------------------------------------------
  console.log('Creating listings...');
  const allListings: Awaited<ReturnType<typeof prisma.listing.create>>[] = [];

  for (const [categoryName, catData] of Object.entries(categories)) {
    for (const product of catData.products) {
      const condition = randomCondition();
      const price = priceForCondition(product.basePrice, condition);
      const seller = faker.helpers.arrayElement(users);

      const listing = await prisma.listing.create({
        data: {
          title: product.title,
          description: catData.descriptionTemplate(product, condition),
          price,
          category: categoryName,
          subcategory: product.subcategory ?? null,
          platform: product.platform ?? null,
          brand: product.brand,
          condition,
          status: ListingStatus.ACTIVE,
          sellerId: seller.id,
          createdAt: randomDate(60),
          images: {
            create: [
              { url: placeholderImageUrl(product.title), displayOrder: 0 },
            ],
          },
        },
      });
      allListings.push(listing);
    }
  }

  // Add some duplicate products (different sellers/conditions) to reach ~80
  const extraCount = Math.max(0, 80 - allListings.length);
  for (let i = 0; i < extraCount; i++) {
    const categoryName = faker.helpers.arrayElement(Object.keys(categories));
    const catData = categories[categoryName];
    const product = faker.helpers.arrayElement(catData.products);
    const condition = randomCondition();
    const price = priceForCondition(product.basePrice, condition);
    const seller = faker.helpers.arrayElement(users);

    const listing = await prisma.listing.create({
      data: {
        title: product.title,
        description: catData.descriptionTemplate(product, condition),
        price,
        category: categoryName,
        subcategory: product.subcategory ?? null,
        platform: product.platform ?? null,
        brand: product.brand,
        condition,
        status: ListingStatus.ACTIVE,
        sellerId: seller.id,
        createdAt: randomDate(60),
        images: {
          create: [
            { url: placeholderImageUrl(product.title), displayOrder: 0 },
          ],
        },
      },
    });
    allListings.push(listing);
  }
  console.log(`  Created ${allListings.length} listings`);

  // --- Orders & sold listings ----------------------------------------------
  console.log('Creating orders and reviews...');
  // Mark ~15 listings as sold and create orders + reviews for them
  const shuffled = faker.helpers.shuffle([...allListings]);
  const toSell = shuffled.slice(0, 15);

  let orderCount = 0;
  let reviewCount = 0;

  for (const listing of toSell) {
    // Pick a buyer that is NOT the seller
    const possibleBuyers = users.filter((u) => u.id !== listing.sellerId);
    const buyer = faker.helpers.arrayElement(possibleBuyers);

    // Mark listing as sold
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: ListingStatus.SOLD },
    });

    const order = await prisma.order.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        amount: listing.price,
        status: OrderStatus.PAID,
        createdAt: randomDate(30),
      },
    });
    orderCount++;

    // ~70% chance of leaving a review
    if (Math.random() < 0.7) {
      await prisma.review.create({
        data: {
          orderId: order.id,
          reviewerId: buyer.id,
          sellerId: listing.sellerId,
          rating: faker.helpers.weightedArrayElement([
            { value: 5, weight: 40 },
            { value: 4, weight: 30 },
            { value: 3, weight: 15 },
            { value: 2, weight: 10 },
            { value: 1, weight: 5 },
          ]),
          comment: faker.helpers.arrayElement([
            'Great seller, item exactly as described!',
            'Fast shipping, would buy again.',
            'Item was in better condition than expected.',
            'Good communication throughout.',
            'Took a while to ship but item was fine.',
            'Decent deal, minor wear not mentioned.',
            'Happy with the purchase overall.',
            'Product works perfectly, thank you!',
            'Arrived well packaged.',
            null, // some reviews have no comment
          ]),
          createdAt: randomDate(20),
        },
      });
      reviewCount++;
    }
  }

  console.log(`  Created ${orderCount} orders`);
  console.log(`  Created ${reviewCount} reviews`);

  // --- Saved listings (wishlist) -------------------------------------------
  console.log('Creating saved listings...');
  let savedCount = 0;
  for (const user of users) {
    const numSaved = faker.number.int({ min: 0, max: 5 });
    const activeListings = allListings.filter(
      (l) => l.sellerId !== user.id && l.status === 'ACTIVE'
    );
    const toSave = faker.helpers.shuffle(activeListings).slice(0, numSaved);
    for (const listing of toSave) {
      await prisma.savedListing.create({
        data: { userId: user.id, listingId: listing.id },
      });
      savedCount++;
    }
  }
  console.log(`  Created ${savedCount} saved listings`);

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
