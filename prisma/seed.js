const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const defaultMenuItems = [
  {
    name: 'Cheese Burger',
    price: 850,
    category: 'burger',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80',
    model: '/Burger.glb'
  },
  {
    name: 'Loaded Pizza',
    price: 1290,
    category: 'pizza',
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80',
    model: '/Pizza.glb'
  },
  {
    name: 'Crispy Fries',
    price: 490,
    category: 'fries',
    image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500&q=80',
    model: '/Fries.glb'
  }
];

function makeId(value) {
  const base = String(value || 'item')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'item';
  return base + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000);
}

async function main() {
  const categoryIds = Array.from(new Set(defaultMenuItems.map((item) => item.category)));
  for (const id of categoryIds) {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      await prisma.category.create({ data: { id, name: id } });
    }
  }

  const menuCount = await prisma.menuItem.count();
  if (!menuCount) {
    for (const item of defaultMenuItems) {
      await prisma.menuItem.create({
        data: {
          id: makeId(item.name),
          name: item.name,
          price: item.price,
          categoryId: item.category,
          imageUrl: item.image,
          modelUrl: item.model
        }
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
