import { processSaleAtomic } from './db.js';

async function test() {
  try {
    const fakeSaleData = {
      subtotal: 10,
      totalTax: 0,
      totalAmount: 10,
      items: [
        {
          medicineId: '123',
          batchId: '456',
          batchNumber: 'B1',
          name: 'Med 1',
          quantity: 1,
          priceAtSale: 10,
          taxRateAtSale: 0,
          taxAmount: 0,
          subtotalItem: 10
        }
      ]
    };
    
    // We expect this to fail later in the network request because we didn't mock isOnline() or getSupabaseClient() properly for this standalone test,
    // BUT we expect it NOT to throw "Cannot read properties of undefined (reading 'id')"
    const result = await processSaleAtomic(fakeSaleData);
    console.log('Result:', result);
  } catch (error) {
    console.log('Caught Error:', error.message);
    if (error.message.includes("Cannot read properties of undefined (reading 'id')")) {
      console.log('❌ IT STILL THROWS THE ID ERROR');
    } else {
      console.log('✅ It throws a DIFFERENT error (expected because of standalone env)');
    }
  }
}

test();
