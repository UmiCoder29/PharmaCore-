import express from 'express';
import cors from 'cors';
import { getData, isReady, getSetting } from './db.js';

let server = null;
const app = express();

app.use(cors());
app.use(express.json());

// ─── Authentication Middleware ────────────────────────────────────────────────
// Protects the API using the apiKey stored in the database
const requireApiKey = async (req, res, next) => {
  if (!isReady()) {
    return res.status(503).json({ error: 'Database not initialized yet.' });
  }

  try {
    const inboundEnabled = await getSetting('inboundEnabled');
    if (!inboundEnabled || inboundEnabled !== 'true') {
      return res.status(503).json({ error: 'Inbound API is disabled.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <apiKey>' });
    }

    const token = authHeader.split(' ')[1];
    const apiKey = await getSetting('apiKey');
    
    if (token !== apiKey) {
      return res.status(401).json({ error: 'Invalid API Key.' });
    }

    next();
  } catch (err) {
    console.error('[API] Auth error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── API Routes ─────────────────────────────────────────────────────────────

// Get all active inventory (medicines and their non-expired batches)
app.get('/api/inventory', requireApiKey, async (req, res) => {
  try {
    const data = await getData();
    const medicines = data.medicines || [];
    const batches = data.batches || [];

    const inventory = medicines.map(m => {
      const activeBatches = batches.filter(b => b.medicineId === m.id && !b.isExpired);
      const quantityInStock = activeBatches.reduce((sum, b) => sum + b.quantityInStock, 0);
      return {
        id: m.id,
        name: m.name,
        genericName: m.genericName,
        barcode: m.barcode,
        totalStock: quantityInStock,
        batches: activeBatches.map(b => ({
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          quantityInStock: b.quantityInStock,
          sellingPrice: b.sellingPrice
        }))
      };
    });

    res.json({ success: true, count: inventory.length, data: inventory });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
  }
});

// Get recent sales
app.get('/api/sales', requireApiKey, async (req, res) => {
  try {
    const data = await getData();
    const sales = data.sales || [];
    // Return the 100 most recent sales
    const recentSales = sales.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime)).slice(0, 100);
    
    res.json({ success: true, count: recentSales.length, data: recentSales });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch sales' });
  }
});

// ─── Server Control ─────────────────────────────────────────────────────────

export function startLocalApiServer(port = 3001) {
  if (server) {
    console.log('[API] Server is already running.');
    return;
  }

  server = app.listen(port, () => {
    console.log(`[API] Inbound API Server started on http://localhost:${port}`);
  });
}

export function stopLocalApiServer() {
  if (server) {
    server.close(() => {
      console.log('[API] Inbound API Server stopped.');
      server = null;
    });
  }
}
