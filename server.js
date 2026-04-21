const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { prisma } = require('./lib/prisma');
const { uploadBuffer, isCloudinaryConfigured } = require('./lib/cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  const required = ['DATABASE_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error('Missing required env vars: ' + missing.join(', '));
  }
}

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');

app.use('/public', express.static(publicDir));
// Serve frontend files from this folder
app.use(express.static(__dirname));

const defaultMenuItems = [
  {
    id: 'burger',
    name: 'Cheese Burger',
    price: 850,
    category: 'burger',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80',
    model: '/Burger.glb'
  },
  {
    id: 'pizza',
    name: 'Loaded Pizza',
    price: 1290,
    category: 'pizza',
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80',
    model: '/Pizza.glb'
  },
  {
    id: 'fries',
    name: 'Crispy Fries',
    price: 490,
    category: 'fries',
    image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500&q=80',
    model: '/Fries.glb'
  }
];

function makeId(value) {
  const base = String(value || 'item').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
  return base + '-' + Date.now().toString(36);
}

function normalizeCategoryId(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function mapMenuItem(record) {
  return {
    id: record.id,
    name: record.name,
    price: record.price,
    category: record.categoryId,
    image: record.imageUrl || '',
    model: record.modelUrl || '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapOrder(record) {
  return {
    id: record.id,
    tableNumber: record.tableNumber,
    items: record.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price
    })),
    total: record.total,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function uploadAsset(file, fieldname) {
  if (!file) return '';
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_* environment variables.');
  }
  return uploadBuffer(file.buffer, {
    folder: fieldname === 'image' ? 'food-ar/images' : 'food-ar/models',
    resource_type: fieldname === 'image' ? 'image' : 'raw',
    public_id: makeId(file.originalname || fieldname)
  });
}

async function ensureSeedData() {
  const existingCategories = await prisma.category.count();
  if (!existingCategories) {
    const uniqueCategoryIds = Array.from(
      new Set(defaultMenuItems.map((item) => normalizeCategoryId(item.category)).filter(Boolean))
    );
    await prisma.$transaction(
      uniqueCategoryIds.map((id) =>
        prisma.category.create({
          data: { id, name: id }
        })
      )
    );
  }

  const existingMenu = await prisma.menuItem.count();
  if (!existingMenu) {
    await prisma.$transaction(
      defaultMenuItems.map((item) =>
        prisma.menuItem.create({
          data: {
            id: makeId(item.name),
            name: item.name,
            price: Number(item.price) || 0,
            categoryId: normalizeCategoryId(item.category),
            imageUrl: item.image || '',
            modelUrl: item.model || ''
          }
        })
      )
    );
  }
}

app.get('/api/menu', async (req, res) => {
  try {
    await ensureSeedData();
    const items = await prisma.menuItem.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, items: items.map(mapMenuItem) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to load menu items' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    await ensureSeedData();
    const items = await prisma.category.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, items });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to load categories' });
  }
});

app.post('/api/categories', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const id = normalizeCategoryId(name);

  if (!name || !id) {
    return res.status(400).json({ success: false, message: 'Category name is required' });
  }

  try {
    const exists = await prisma.category.findUnique({ where: { id } });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Category already exists' });
    }
    const item = await prisma.category.create({ data: { id, name } });
    res.json({ success: true, item });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to add category' });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  const categoryId = normalizeCategoryId(req.params.id);
  try {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const inUse = await prisma.menuItem.count({ where: { categoryId } });
    if (inUse) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category because it is used by one or more menu items'
      });
    }

    const removed = await prisma.category.delete({ where: { id: categoryId } });
    res.json({ success: true, item: removed });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to delete category' });
  }
});

app.post('/api/menu', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'model', maxCount: 1 }]), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const categoryId = normalizeCategoryId(category);
  const price = Number(body.price);

  if (!name || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ success: false, message: 'Invalid menu item payload' });
  }

  try {
    const categoryExists = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!categoryExists) {
      return res.status(400).json({ success: false, message: 'Selected category does not exist' });
    }

    const imageFile = req.files && req.files.image && req.files.image[0];
    const modelFile = req.files && req.files.model && req.files.model[0];
    const image = imageFile ? await uploadAsset(imageFile, 'image') : String(body.image || '').trim();
    const model = modelFile ? await uploadAsset(modelFile, 'model') : String(body.model || '').trim();

    const item = await prisma.menuItem.create({
      data: {
        id: makeId(name),
        name,
        price,
        categoryId,
        imageUrl: image,
        modelUrl: model
      }
    });
    res.json({ success: true, item: mapMenuItem(item) });
  } catch (err) {
    res.status(500).json({ success: false, message: err && err.message ? err.message : 'Unable to save menu item' });
  }
});

app.put('/api/menu/:id', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'model', maxCount: 1 }]), async (req, res) => {
  const itemId = String(req.params.id || '').trim();
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const categoryId = normalizeCategoryId(category);
  const price = Number(body.price);

  if (!name || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ success: false, message: 'Invalid menu item payload' });
  }

  try {
    const existingItem = await prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!existingItem) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    const categoryExists = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!categoryExists) {
      return res.status(400).json({ success: false, message: 'Selected category does not exist' });
    }

    const imageFile = req.files && req.files.image && req.files.image[0];
    const modelFile = req.files && req.files.model && req.files.model[0];
    const nextImage = imageFile ? await uploadAsset(imageFile, 'image') : String(body.image || '').trim();
    const nextModel = modelFile ? await uploadAsset(modelFile, 'model') : String(body.model || '').trim();

    const updatedItem = await prisma.menuItem.update({
      where: { id: itemId },
      data: {
        name,
        price,
        categoryId,
        imageUrl: nextImage || existingItem.imageUrl || '',
        modelUrl: nextModel || existingItem.modelUrl || ''
      }
    });
    res.json({ success: true, item: mapMenuItem(updatedItem) });
  } catch (err) {
    res.status(500).json({ success: false, message: err && err.message ? err.message : 'Unable to save menu item' });
  }
});

app.delete('/api/menu/:id', async (req, res) => {
  const itemId = String(req.params.id || '').trim();
  try {
    const existingItem = await prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!existingItem) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }
    const removedItem = await prisma.menuItem.delete({ where: { id: itemId } });
    res.json({ success: true, item: mapMenuItem(removedItem) });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to delete menu item' });
  }
});

app.get('/api/waiters', async (req, res) => {
  try {
    const items = await prisma.waiter.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, items });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to load waiters' });
  }
});

app.post('/api/waiters', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const shift = String(body.shift || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Waiter name is required' });
  }
  try {
    const item = await prisma.waiter.create({
      data: {
        id: makeId(name),
        name,
        phone,
        shift: shift || 'General'
      }
    });
    res.json({ success: true, item });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to add waiter' });
  }
});

app.get('/api/tables', async (req, res) => {
  try {
    const items = await prisma.tableEntity.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, items });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to load tables' });
  }
});

app.post('/api/tables', async (req, res) => {
  const body = req.body || {};
  const tableNumber = String(body.tableNumber || '').trim();
  const capacity = Number(body.capacity);
  const area = String(body.area || '').trim();
  const status = String(body.status || 'available').trim();
  if (!tableNumber) {
    return res.status(400).json({ success: false, message: 'Table number is required' });
  }
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return res.status(400).json({ success: false, message: 'Capacity must be greater than 0' });
  }
  try {
    const item = await prisma.tableEntity.create({
      data: {
        id: makeId('table-' + tableNumber),
        tableNumber,
        capacity,
        area: area || 'Main Hall',
        status: status || 'available'
      }
    });
    res.json({ success: true, item });
  } catch (_) {
    res.status(500).json({ success: false, message: 'Unable to add table' });
  }
});

// Create new order
app.post('/api/orders', async (req, res) => {
  const { tableNumber, items, total } = req.body || {};

  if (!tableNumber || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: 'Invalid order payload' });
  }

  try {
    const order = await prisma.order.create({
      data: {
        tableNumber: String(tableNumber),
        total: Number(total) || 0,
        status: 'pending',
        items: {
          create: items.map((item) => ({
            name: String(item.name || 'Item'),
            qty: Number(item.qty) || 1,
            price: Number(item.price) || 0
          }))
        }
      },
      include: { items: true }
    });
    console.log('New order:', order.id);
    res.json({ ok: true, order: mapOrder(order) });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Unable to create order' });
  }
});

// List all orders (for dashboard)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ ok: true, orders: orders.map(mapOrder) });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Unable to load orders' });
  }
});

// Get single order (for user status polling)
app.get('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Invalid order id' });
  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });
    res.json({ ok: true, order: mapOrder(order) });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Unable to load order' });
  }
});

// Update order status (pending → in_process → delivered → completed)
app.patch('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = ['pending', 'in_process', 'delivered', 'completed'];
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Invalid order id' });
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, message: 'Invalid status' });
  }
  try {
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Order not found' });
    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true }
    });
    console.log('Order updated:', order.id, status);
    res.json({ ok: true, order: mapOrder(order) });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Unable to update order' });
  }
});

// Admin dashboard (SPA-style) with real Orders + dummy sections
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Innovify XR – Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f3f4f6;
      color: #111827;
      min-height: 100vh;
    }
    .layout {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      min-height: 100vh;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: sticky; top: 0; z-index: 20; display: flex; overflow-x: auto; }
    }
    .sidebar {
      background: #111827;
      color: #e5e7eb;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px 8px;
    }
    .sidebar-logo-badge {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, #f97316, #ea580c);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      color: #111827;
    }
    .sidebar-logo-text {
      font-size: 16px;
      font-weight: 600;
    }
    .nav-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6b7280;
      margin: 4px 8px;
    }
    .nav-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    @media (max-width: 900px) {
      .nav-list {
        flex-direction: row;
        overflow-x: auto;
      }
    }
    .nav-item-btn {
      width: 100%;
      border: none;
      background: transparent;
      color: inherit;
      padding: 8px 10px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
    }
    .nav-item-btn span.icon {
      width: 20px;
      text-align: center;
      font-size: 15px;
    }
    .nav-item-btn.active {
      background: #f97316;
      color: #111827;
    }
    .nav-item-btn:not(.active):hover {
      background: rgba(31, 41, 55, 0.8);
    }
    .sidebar-footer {
      margin-top: auto;
      font-size: 11px;
      color: #6b7280;
      padding: 4px 8px;
    }
    .main {
      padding: 16px 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .topbar-title {
      font-size: 22px;
      font-weight: 600;
    }
    .topbar-search {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .topbar-search input {
      border-radius: 999px;
      border: 1px solid #d1d5db;
      padding: 8px 12px;
      font-size: 13px;
      min-width: 180px;
    }
    .topbar-user {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .topbar-avatar {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #111827;
      color: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
    }
    .content {
      display: none;
      gap: 16px;
    }
    .content.active {
      display: grid;
    }
    .content-dashboard {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    }
    .content-orders {
      grid-template-columns: minmax(0, 1fr);
    }
    .card {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
    }
    .pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .orders-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .order-column-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      padding: 4px 8px;
      border-radius: 999px;
    }
    .order-column-title.pending { background: #fee2e2; color: #b91c1c; }
    .order-column-title.inprocess { background: #fef3c7; color: #b45309; }
    .order-column-title.delivered { background: #dcfce7; color: #15803d; }
    .order-column-title.completed { background: #e5e7eb; color: #374151; }
    .order-card {
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      padding: 8px 10px;
      background: #ffffff;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .order-card-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .order-card-items {
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .order-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #6b7280;
    }
    .status-chip {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
    }
    .status-chip.pending { background: #fef3c7; color: #b45309; }
    .status-chip.in_process { background: #fef3c7; color: #b45309; }
    .status-chip.delivered { background: #dcfce7; color: #15803d; }
    .status-chip.completed { background: #e5e7eb; color: #374151; }
    .status-chip.done { background: #dcfce7; color: #15803d; }
    .order-card-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .order-card-btn {
      padding: 4px 10px;
      border-radius: 8px;
      border: none;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .order-card-btn.next {
      background: #f97316;
      color: #fff;
    }
    .order-card-btn.next:hover { opacity: 0.9; }
    .toast-wrap {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      pointer-events: none;
    }
    .toast {
      padding: 10px 16px;
      border-radius: 10px;
      background: #111827;
      color: #f9fafb;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: 0;
      transition: opacity 0.2s;
    }
    .toast.show { opacity: 1; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 6px;
    }
    th, td {
      padding: 8px 8px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
    }
    th { background: #f9fafb; font-weight: 500; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .muted {
      font-size: 12px;
      color: #6b7280;
    }
    .placeholder-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .placeholder-tile {
      border-radius: 14px;
      border: 1px dashed #d1d5db;
      padding: 14px 16px;
      background: #f9fafb;
      font-size: 13px;
      color: #6b7280;
    }
    .placeholder-title {
      font-weight: 600;
      margin-bottom: 4px;
      color: #111827;
    }
    .watermark {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 100px;
      height: 100px;
      opacity: 1;
      pointer-events: none;
      z-index: 100;
    }
    .watermark img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="watermark" aria-hidden="true">
    <img src="/Brand.png" alt="">
  </div>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-badge">IXR</div>
        <div class="sidebar-logo-text">Innovify XR</div>
      </div>
      <div class="nav-section-title">Main</div>
      <ul class="nav-list">
        <li><button class="nav-item-btn active" data-section="dashboard"><span class="icon">🏠</span>Dashboard</button></li>
        <li><button class="nav-item-btn" data-section="orders"><span class="icon">🧾</span>Orders</button></li>
        <li><button class="nav-item-btn" data-section="menu"><span class="icon">📋</span>Menu Management</button></li>
        <li><button class="nav-item-btn" data-section="ar-dishes"><span class="icon">🕶️</span>AR Dishes</button></li>
        <li><button class="nav-item-btn" data-section="waiters"><span class="icon">🧑‍🍳</span>Waiters</button></li>
        <li><button class="nav-item-btn" data-section="tables"><span class="icon">🍽️</span>Tables</button></li>
        <li><button class="nav-item-btn" data-section="customers"><span class="icon">👥</span>Customers</button></li>
        <li><button class="nav-item-btn" data-section="analytics"><span class="icon">📈</span>Analytics</button></li>
        <li><button class="nav-item-btn" data-section="settings"><span class="icon">⚙️</span>Settings</button></li>
      </ul>
      <div class="sidebar-footer">
        Demo admin • Only Orders data is live.
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="topbar-title" id="topbar-title">Dashboard</div>
          <div class="muted" id="topbar-subtitle">Overview of tables and orders.</div>
        </div>
        <div class="topbar-search">
          <input type="search" placeholder="Search orders or tables…" />
          <div class="topbar-user">
            <span class="topbar-avatar">AD</span>
            <span>Admin</span>
          </div>
        </div>
      </div>

      <!-- Dashboard content -->
      <section class="content content-dashboard active" id="section-dashboard">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Orders Management</div>
            <span class="pill">Live</span>
          </div>
          <div class="muted">New, in-process, delivered and completed orders at a glance.</div>
          <div id="orders-board" style="margin-top:12px;"></div>
        </div>
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Menu Management</div>
            <button style="border:none;border-radius:999px;background:#f97316;color:white;font-size:12px;padding:6px 10px;cursor:pointer;">Add New Dish</button>
          </div>
          <div class="muted">Demo list – static for now.</div>
          <ul style="list-style:none;padding:8px 0 0;margin:0;font-size:13px;">
            <li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;">
              <span>Cheese Burger</span><span>Rs 850</span>
            </li>
            <li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;">
              <span>Loaded Pizza</span><span>Rs 1290</span>
            </li>
            <li style="display:flex;justify-content:space-between;padding:6px 0;">
              <span>Crispy Fries</span><span>Rs 490</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Orders table -->
      <section class="content content-orders" id="section-orders">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Orders List</div>
            <span class="muted" id="orders-count-label">0 orders</span>
          </div>
          <div id="orders-table-root"></div>
        </div>
      </section>

      <!-- Menu management -->
      <section class="content" id="section-menu">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Menu Management</div>
            <button type="button" id="menu-toggle-form" style="border:none;border-radius:999px;background:#f97316;color:white;font-size:12px;padding:6px 10px;cursor:pointer;">Add New Item</button>
          </div>
          <div class="muted">Add food items and AR models for user app.</div>
          <form id="menu-form" style="display:none;margin-top:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f9fafb;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Food Name
                <input name="name" type="text" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Price
                <input name="price" type="number" min="0" step="1" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Category
                <select name="category" id="menu-category-select" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;background:white;"></select>
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Image Upload
                <input name="image" type="file" accept="image/*" required style="padding:8px 6px;border:1px solid #d1d5db;border-radius:8px;background:white;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">AR Model Upload (.glb/.usdz)
                <input name="model" type="file" accept=".glb,.usdz,model/gltf-binary" style="padding:8px 6px;border:1px solid #d1d5db;border-radius:8px;background:white;" />
              </label>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button type="submit" style="border:none;border-radius:8px;background:#111827;color:white;padding:8px 12px;cursor:pointer;font-size:12px;">Save</button>
              <button type="button" id="menu-cancel-form" style="border:1px solid #d1d5db;border-radius:8px;background:white;color:#111827;padding:8px 12px;cursor:pointer;font-size:12px;">Cancel</button>
            </div>
          </form>
          <div id="menu-list-root" style="margin-top:12px;"></div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;">
            <div class="card-title-row">
              <div class="card-title">Categories</div>
            </div>
            <form id="category-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
              <input name="name" type="text" placeholder="e.g. pasta" required style="flex:1;min-width:180px;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              <button type="submit" style="border:none;border-radius:8px;background:#111827;color:white;padding:8px 12px;cursor:pointer;font-size:12px;">Add Category</button>
            </form>
            <div id="category-list-root" style="margin-top:10px;"></div>
          </div>
        </div>
      </section>

      <section class="content" id="section-ar-dishes">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">AR Dishes (Demo)</div>
          </div>
          <div class="placeholder-grid">
            <div class="placeholder-tile">
              <div class="placeholder-title">3D Models</div>
              Upload, test and approve 3D models for AR.
            </div>
            <div class="placeholder-tile">
              <div class="placeholder-title">Placement Presets</div>
              Configure default scale and height per dish.
            </div>
          </div>
        </div>
      </section>

      <section class="content" id="section-waiters">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Waiter Management</div>
            <button type="button" id="waiter-toggle-form" style="border:none;border-radius:999px;background:#f97316;color:white;font-size:12px;padding:6px 10px;cursor:pointer;">Add Waiter</button>
          </div>
          <form id="waiter-form" style="display:none;margin-top:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f9fafb;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Name
                <input name="name" type="text" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Phone
                <input name="phone" type="text" placeholder="03xx..." style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Shift
                <input name="shift" type="text" placeholder="Morning" style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button type="submit" style="border:none;border-radius:8px;background:#111827;color:white;padding:8px 12px;cursor:pointer;font-size:12px;">Save</button>
              <button type="button" id="waiter-cancel-form" style="border:1px solid #d1d5db;border-radius:8px;background:white;color:#111827;padding:8px 12px;cursor:pointer;font-size:12px;">Cancel</button>
            </div>
          </form>
          <div id="waiter-list-root" style="margin-top:12px;"></div>
        </div>
      </section>

      <section class="content" id="section-tables">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Tables Management</div>
            <button type="button" id="table-toggle-form" style="border:none;border-radius:999px;background:#f97316;color:white;font-size:12px;padding:6px 10px;cursor:pointer;">Add Table</button>
          </div>
          <form id="table-form" style="display:none;margin-top:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f9fafb;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Table Number
                <input name="tableNumber" type="text" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Capacity
                <input name="capacity" type="number" min="1" required style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
              <label style="font-size:12px;color:#374151;display:flex;flex-direction:column;gap:4px;">Area
                <input name="area" type="text" placeholder="Main Hall" style="padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;" />
              </label>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button type="submit" style="border:none;border-radius:8px;background:#111827;color:white;padding:8px 12px;cursor:pointer;font-size:12px;">Save</button>
              <button type="button" id="table-cancel-form" style="border:1px solid #d1d5db;border-radius:8px;background:white;color:#111827;padding:8px 12px;cursor:pointer;font-size:12px;">Cancel</button>
            </div>
          </form>
          <div id="table-list-root" style="margin-top:12px;"></div>
        </div>
      </section>

      <section class="content" id="section-customers">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Customers (Demo)</div>
          </div>
          <div class="placeholder-grid">
            <div class="placeholder-tile">
              <div class="placeholder-title">Customer List</div>
              Loyalty, visit history and feedback will appear here.
            </div>
            <div class="placeholder-tile">
              <div class="placeholder-title">Segments</div>
              Group customers for targeted campaigns.
            </div>
          </div>
        </div>
      </section>

      <section class="content" id="section-analytics">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Analytics (Demo)</div>
          </div>
          <div class="placeholder-grid">
            <div class="placeholder-tile">
              <div class="placeholder-title">Today</div>
              Total orders, AR launches and revenue widgets can go here.
            </div>
            <div class="placeholder-tile">
              <div class="placeholder-title">Trends</div>
              Graphs for popular dishes and busy hours.
            </div>
          </div>
        </div>
      </section>

      <section class="content" id="section-settings">
        <div class="card">
          <div class="card-title-row">
            <div class="card-title">Settings (Demo)</div>
          </div>
          <div class="placeholder-grid">
            <div class="placeholder-tile">
              <div class="placeholder-title">Restaurant Profile</div>
              Name, logo and contact information.
            </div>
            <div class="placeholder-tile">
              <div class="placeholder-title">AR Settings</div>
              Configure device compatibility and defaults.
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
  <div class="toast-wrap" id="toast-wrap">
    <div class="toast" id="admin-toast"></div>
  </div>
  <script>
    const navButtons = document.querySelectorAll('.nav-item-btn');
    const sections = {
      dashboard: document.getElementById('section-dashboard'),
      orders: document.getElementById('section-orders'),
      menu: document.getElementById('section-menu'),
      'ar-dishes': document.getElementById('section-ar-dishes'),
      waiters: document.getElementById('section-waiters'),
      tables: document.getElementById('section-tables'),
      customers: document.getElementById('section-customers'),
      analytics: document.getElementById('section-analytics'),
      settings: document.getElementById('section-settings')
    };
    const titleEl = document.getElementById('topbar-title');
    const subtitleEl = document.getElementById('topbar-subtitle');

    const menuListRoot = document.getElementById('menu-list-root');
    const menuForm = document.getElementById('menu-form');
    const menuToggleFormBtn = document.getElementById('menu-toggle-form');
    const menuCancelFormBtn = document.getElementById('menu-cancel-form');
    const menuFormSubmitBtn = menuForm ? menuForm.querySelector('button[type="submit"]') : null;
    const menuNameInput = menuForm ? menuForm.querySelector('input[name="name"]') : null;
    const menuPriceInput = menuForm ? menuForm.querySelector('input[name="price"]') : null;
    const menuImageInput = menuForm ? menuForm.querySelector('input[name="image"]') : null;
    const menuModelInput = menuForm ? menuForm.querySelector('input[name="model"]') : null;
    const categoryForm = document.getElementById('category-form');
    const categoryListRoot = document.getElementById('category-list-root');
    const menuCategorySelect = document.getElementById('menu-category-select');
    let currentEditingMenuId = null;
    let currentMenuItems = [];

    const waiterListRoot = document.getElementById('waiter-list-root');
    const waiterForm = document.getElementById('waiter-form');
    const waiterToggleFormBtn = document.getElementById('waiter-toggle-form');
    const waiterCancelFormBtn = document.getElementById('waiter-cancel-form');

    const tableListRoot = document.getElementById('table-list-root');
    const tableForm = document.getElementById('table-form');
    const tableToggleFormBtn = document.getElementById('table-toggle-form');
    const tableCancelFormBtn = document.getElementById('table-cancel-form');

    function setMenuFormMode(editing) {
      if (!menuToggleFormBtn || !menuFormSubmitBtn || !menuImageInput) return;
      if (editing) {
        menuToggleFormBtn.textContent = 'Edit Item';
        menuFormSubmitBtn.textContent = 'Update';
        menuImageInput.removeAttribute('required');
      } else {
        menuToggleFormBtn.textContent = 'Add New Item';
        menuFormSubmitBtn.textContent = 'Save';
        menuImageInput.setAttribute('required', 'required');
      }
    }

    function resetMenuFormState() {
      currentEditingMenuId = null;
      if (menuForm) {
        menuForm.reset();
        menuForm.style.display = 'none';
      }
      setMenuFormMode(false);
    }

    function renderMenuList(items) {
      if (!menuListRoot) return;
      if (!items.length) {
        menuListRoot.innerHTML = '<div class="muted">No menu item yet.</div>';
        return;
      }
      const rows = items.map((item) => {
        const img = item.image ? '<img src="' + item.image + '" alt="" style="width:48px;height:48px;border-radius:10px;object-fit:cover;border:1px solid #e5e7eb;" />' : '<div style="width:48px;height:48px;border-radius:10px;background:#e5e7eb;"></div>' ;
        return '<tr>' +
          '<td>' + img + '</td>' +
          '<td>' + (item.name || '-') + '</td>' +
          '<td>' + (item.category || '-') + '</td>' +
          '<td>Rs ' + (item.price || 0) + '</td>' +
          '<td>' + (item.model ? '<span class="badge">Model</span>' : '<span class="muted">No model</span>') + '</td>' +
          '<td style="white-space:nowrap;">' +
            '<button type="button" data-edit-menu="' + item.id + '" style="border:1px solid #d1d5db;background:white;color:#111827;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer;margin-right:6px;">Edit</button>' +
            '<button type="button" data-delete-menu="' + item.id + '" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer;">Delete</button>' +
          '</td>' +
          '</tr>';
      }).join('');
      menuListRoot.innerHTML =
        '<table><thead><tr><th>Image</th><th>Name</th><th>Category</th><th>Price</th><th>AR</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    async function fetchMenuItems() {
      try {
        const res = await fetch('/api/menu');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error('Failed');
        currentMenuItems = data.items || [];
        renderMenuList(currentMenuItems);
      } catch (err) {
        if (menuListRoot) menuListRoot.innerHTML = '<div class="muted">Error loading menu items.</div>';
      }
    }


    function renderCategories(items) {
      if (menuCategorySelect) {
        menuCategorySelect.innerHTML = (items || []).map(function (c) {
          return '<option value="' + c.id + '">' + c.name + '</option>';
        }).join('');
      }
      if (categoryListRoot) {
        if (!items || !items.length) {
          categoryListRoot.innerHTML = '<div class="muted">No categories yet.</div>';
        } else {
          categoryListRoot.innerHTML = items.map(function (c) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;">' +
              '<span>' + c.name + '</span>' +
              '<button type="button" data-delete-category="' + c.id + '" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer;">Delete</button>' +
              '</div>';
          }).join('');
        }
      }
    }

    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error('Failed');
        renderCategories(data.items || []);
      } catch (_) {
        if (categoryListRoot) categoryListRoot.innerHTML = '<div class="muted">Error loading categories.</div>';
      }
    }

    if (menuToggleFormBtn) {
      menuToggleFormBtn.addEventListener('click', function () {
        if (!menuForm) return;
        menuForm.style.display = menuForm.style.display === 'none' ? 'block' : 'none';
        if (menuForm.style.display === 'block' && menuNameInput) {
          menuNameInput.focus();
        }
      });
    }

    if (menuCancelFormBtn) {
      menuCancelFormBtn.addEventListener('click', function () {
        resetMenuFormState();
      });
    }

    if (menuForm) {
      menuForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(menuForm);
        const isEditMode = !!currentEditingMenuId;
        const endpoint = isEditMode
          ? '/api/menu/' + encodeURIComponent(currentEditingMenuId)
          : '/api/menu';
        const method = isEditMode ? 'PUT' : 'POST';
        try {
          const res = await fetch(endpoint, { method: method, body: fd });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          const itemName = data.item && data.item.name ? data.item.name : 'Saved';
          resetMenuFormState();
          showToast(isEditMode ? 'Menu item updated: ' + itemName : 'Menu item added: ' + itemName);
          fetchMenuItems();
          fetchCategories();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Unable to save menu item');
        }
      });
    }

    if (menuListRoot) {
      menuListRoot.addEventListener('click', async function (e) {
        const editBtn = e.target.closest('[data-edit-menu]');
        if (editBtn) {
          const id = editBtn.getAttribute('data-edit-menu');
          if (!id) return;
          const item = currentMenuItems.find(function (menuItem) {
            return String(menuItem.id) === String(id);
          });
          if (!item || !menuForm) return;
          currentEditingMenuId = id;
          setMenuFormMode(true);
          menuForm.style.display = 'block';
          if (menuNameInput) menuNameInput.value = item.name || '';
          if (menuPriceInput) menuPriceInput.value = item.price || 0;
          if (menuCategorySelect) menuCategorySelect.value = item.category || '';
          if (menuModelInput) menuModelInput.value = '';
          if (menuImageInput) menuImageInput.value = '';
          if (menuNameInput) menuNameInput.focus();
          return;
        }

        const deleteBtn = e.target.closest('[data-delete-menu]');
        if (!deleteBtn) return;
        const id = deleteBtn.getAttribute('data-delete-menu');
        if (!id) return;
        try {
          const res = await fetch('/api/menu/' + encodeURIComponent(id), { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          if (currentEditingMenuId === id) {
            resetMenuFormState();
          }
          showToast('Menu item deleted: ' + ((data.item && data.item.name) || 'Removed'));
          fetchMenuItems();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Unable to delete menu item');
        }
      });
    }


    if (categoryForm) {
      categoryForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(categoryForm);
        const payload = { name: String(fd.get('name') || '').trim() };
        try {
          const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          categoryForm.reset();
          showToast('Category added: ' + data.item.name);
          fetchCategories();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Unable to add category');
        }
      });
    }

    if (categoryListRoot) {
      categoryListRoot.addEventListener('click', async function (e) {
        const btn = e.target.closest('[data-delete-category]');
        if (!btn) return;
        const id = btn.getAttribute('data-delete-category');
        if (!id) return;
        try {
          const res = await fetch('/api/categories/' + encodeURIComponent(id), { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          showToast('Category deleted: ' + data.item.name);
          fetchCategories();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Unable to delete category');
        }
      });
    }

    function renderWaiters(items) {
      if (!waiterListRoot) return;
      if (!items.length) {
        waiterListRoot.innerHTML = '<div class="muted">No waiter added yet.</div>';
        return;
      }
      const rows = items.map((w) => {
        return '<tr><td>' + (w.name || '-') + '</td><td>' + (w.phone || '-') + '</td><td>' + (w.shift || '-') + '</td></tr>';
      }).join('');
      waiterListRoot.innerHTML = '<table><thead><tr><th>Name</th><th>Phone</th><th>Shift</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    async function fetchWaiters() {
      try {
        const res = await fetch('/api/waiters');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error('Failed');
        renderWaiters(data.items || []);
      } catch (_) {
        if (waiterListRoot) waiterListRoot.innerHTML = '<div class="muted">Error loading waiters.</div>';
      }
    }

    if (waiterToggleFormBtn) {
      waiterToggleFormBtn.addEventListener('click', function () {
        if (!waiterForm) return;
        waiterForm.style.display = waiterForm.style.display === 'none' ? 'block' : 'none';
      });
    }

    if (waiterCancelFormBtn) {
      waiterCancelFormBtn.addEventListener('click', function () {
        if (!waiterForm) return;
        waiterForm.reset();
        waiterForm.style.display = 'none';
      });
    }

    if (waiterForm) {
      waiterForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(waiterForm);
        const payload = {
          name: String(fd.get('name') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
          shift: String(fd.get('shift') || '').trim()
        };
        try {
          const res = await fetch('/api/waiters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          waiterForm.reset();
          waiterForm.style.display = 'none';
          showToast('Waiter added: ' + (data.item && data.item.name ? data.item.name : 'Saved'));
          fetchWaiters();
        } catch (_) {
          showToast('Unable to save waiter');
        }
      });
    }

    function renderTables(items) {
      if (!tableListRoot) return;
      if (!items.length) {
        tableListRoot.innerHTML = '<div class="muted">No table added yet.</div>';
        return;
      }
      const rows = items.map((t) => {
        return '<tr><td>' + (t.tableNumber || '-') + '</td><td>' + (t.capacity || '-') + '</td><td>' + (t.area || '-') + '</td><td><span class="badge">' + (t.status || 'available') + '</span></td></tr>';
      }).join('');
      tableListRoot.innerHTML = '<table><thead><tr><th>Table #</th><th>Capacity</th><th>Area</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    async function fetchTables() {
      try {
        const res = await fetch('/api/tables');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error('Failed');
        renderTables(data.items || []);
      } catch (_) {
        if (tableListRoot) tableListRoot.innerHTML = '<div class="muted">Error loading tables.</div>';
      }
    }

    if (tableToggleFormBtn) {
      tableToggleFormBtn.addEventListener('click', function () {
        if (!tableForm) return;
        tableForm.style.display = tableForm.style.display === 'none' ? 'block' : 'none';
      });
    }

    if (tableCancelFormBtn) {
      tableCancelFormBtn.addEventListener('click', function () {
        if (!tableForm) return;
        tableForm.reset();
        tableForm.style.display = 'none';
      });
    }

    if (tableForm) {
      tableForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(tableForm);
        const payload = {
          tableNumber: String(fd.get('tableNumber') || '').trim(),
          capacity: Number(fd.get('capacity')),
          area: String(fd.get('area') || '').trim(),
          status: 'available'
        };
        try {
          const res = await fetch('/api/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
          tableForm.reset();
          tableForm.style.display = 'none';
          showToast('Table added: ' + (data.item && data.item.tableNumber ? data.item.tableNumber : 'Saved'));
          fetchTables();
        } catch (_) {
          showToast('Unable to save table');
        }
      });
    }

    function setSection(id) {
      Object.keys(sections).forEach(key => {
        if (sections[key]) {
          sections[key].classList.toggle('active', key === id);
        }
      });
      navButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-section') === id);
      });
      if (id === 'menu') { fetchMenuItems(); fetchCategories(); }
      if (id === 'waiters') fetchWaiters();
      if (id === 'tables') fetchTables();
      const titles = {
        dashboard: ['Dashboard', 'Overview of tables and orders.'],
        orders: ['Orders', 'Live list of all Web AR orders.'],
        menu: ['Menu Management', 'Create and manage dishes for user menu.'],
        'ar-dishes': ['AR Dishes', 'Configure AR models (demo).'],
        waiters: ['Waiters', 'Create and manage waiter records.'],
        tables: ['Tables', 'Create and manage table inventory.'],
        customers: ['Customers', 'Customer list and loyalty (demo).'],
        analytics: ['Analytics', 'See performance charts (demo).'],
        settings: ['Settings', 'Basic restaurant and AR settings (demo).']
      };
      const pair = titles[id] || ['Dashboard', ''];
      titleEl.textContent = pair[0];
      subtitleEl.textContent = pair[1];
    }

    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-section');
        setSection(id);
      });
    });

    async function fetchOrders() {
      try {
        const res = await fetch('/api/orders');
        const data = await res.json();
        if (!data.ok) throw new Error('Failed');
        const orders = data.orders || [];
        renderOrdersBoard(orders);
        renderOrdersTable(orders);
      } catch (e) {
        document.getElementById('orders-board').innerHTML =
          '<div class="muted">Error loading orders.</div>';
        document.getElementById('orders-table-root').innerHTML =
          '<div class="muted">Error loading orders.</div>';
      }
    }

    function groupByStatus(orders) {
      const columns = { pending: [], inprocess: [], delivered: [], completed: [] };
      orders.forEach(o => {
        const s = (o.status || 'pending').toLowerCase();
        if (s === 'completed' || s === 'done') {
          columns.completed.push(o);
        } else if (s === 'delivered') {
          columns.delivered.push(o);
        } else if (s === 'in_process' || s === 'in process') {
          columns.inprocess.push(o);
        } else {
          columns.pending.push(o);
        }
      });
      return columns;
    }

    function showToast(msg) {
      const el = document.getElementById('admin-toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2500);
    }

    function getNextStatus(current) {
      const s = (current || 'pending').toLowerCase();
      if (s === 'pending') return { status: 'in_process', label: 'In Process' };
      if (s === 'in_process') return { status: 'delivered', label: 'Delivered' };
      if (s === 'delivered') return { status: 'completed', label: 'Completed' };
      return null;
    }

    function renderOrdersBoard(orders) {
      const root = document.getElementById('orders-board');
      if (!orders.length) {
        root.innerHTML = '<div class="muted">Abhi tak koi order nahi aaya.</div>';
        return;
      }
      const grouped = groupByStatus(orders);
      const makeColumn = (label, key, className) => {
        const list = grouped[key] || [];
        const cards = list.map(o => {
          const itemsText = (o.items || [])
            .map(i => (i.emoji || '') + ' ' + (i.name || i.id))
            .join(', ');
          const created = new Date(o.createdAt).toLocaleTimeString();
          const statusVal = o.status || 'pending';
          const statusClass = statusVal.toLowerCase().replace(' ', '_');
          const next = getNextStatus(statusVal);
          let actions = '';
          if (next) {
            actions = '<div class="order-card-actions">' +
              '<button type="button" class="order-card-btn next" data-order-id="' + o.id + '" data-next-status="' + next.status + '" data-next-label="' + next.label + '">' + next.label + '</button>' +
              '</div>';
          }
          return '<div class="order-card">' +
            '<div class="order-card-header"><span>Table ' + o.tableNumber + '</span><span>#' + o.id + '</span></div>' +
            '<div class="order-card-items">' + itemsText + '</div>' +
            '<div class="order-card-footer"><span>' + created + '</span>' +
            '<span class="status-chip ' + statusClass + '">' + statusVal + '</span></div>' +
            actions +
            '</div>';
        }).join('');
        return '<div><div class="order-column-title ' + className + '">' + label +
          '</div>' + cards + '</div>';
      };
      root.innerHTML =
        '<div class="orders-grid">' +
        makeColumn('New Orders', 'pending', 'pending') +
        makeColumn('In Process', 'inprocess', 'inprocess') +
        makeColumn('Delivered', 'delivered', 'delivered') +
        makeColumn('Completed', 'completed', 'completed') +
        '</div>';
    }

    function renderOrdersTable(orders) {
      const root = document.getElementById('orders-table-root');
      const countLabel = document.getElementById('orders-count-label');
      countLabel.textContent = orders.length + (orders.length === 1 ? ' order' : ' orders');
      if (!orders.length) {
        root.innerHTML = '<div class="muted">Abhi tak koi order nahi aaya.</div>';
        return;
      }
      const rows = orders.map(o => {
        const itemsText = (o.items || [])
          .map(i => (i.emoji || '') + ' ' + (i.name || i.id))
          .join(', ');
        const created = new Date(o.createdAt).toLocaleTimeString();
        const statusVal = o.status || 'pending';
        return '<tr>' +
          '<td>#' + o.id + '</td>' +
          '<td><span class="badge">Table ' + o.tableNumber + '</span></td>' +
          '<td>' + itemsText + '</td>' +
          '<td>Rs ' + (o.total || 0) + '</td>' +
          '<td><span class="status-chip ' + (statusVal.toLowerCase().replace(' ', '_')) + '">' + statusVal + '</span></td>' +
          '<td class="muted">' + created + '</td>' +
        '</tr>';
      }).join('');
      root.innerHTML =
        '<table><thead><tr>' +
        '<th>ID</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    fetchOrders();
    fetchMenuItems();
    fetchCategories();
    fetchWaiters();
    fetchTables();
    setInterval(fetchOrders, 5000);

    document.getElementById('orders-board').addEventListener('click', async function (e) {
      const btn = e.target.closest('.order-card-btn.next');
      if (!btn) return;
      const id = btn.getAttribute('data-order-id');
      const nextStatus = btn.getAttribute('data-next-status');
      const nextLabel = btn.getAttribute('data-next-label');
      if (!id || !nextStatus) return;
      try {
        const res = await fetch('/api/orders/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Failed');
        showToast('Order #' + id + ' → ' + nextLabel);
        fetchOrders();
      } catch (err) {
        showToast('Update failed. Try again.');
      }
    });
  </script>
</body>
</html>
  `);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;

