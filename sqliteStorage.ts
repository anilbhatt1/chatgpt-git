import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import uuid from 'react-native-uuid';
import { Entry, Order, OrderItem, OrderWithItems, OrderStatus } from '../state/types';
import { StorageInterface } from './storage';
import { isSameDay } from './dateUtils';

// Database name
const DB_NAME = 'shopnotes.db';

// Cache to track if we've already checked/ensured table columns in this session
let pricesTableColumnsEnsured = false;

// Cache for similar items lookup to improve performance
const similarItemsCache = new Map<string, { timestamp: number, results: { item: string; price: number }[] }>();
/**
 * SQLite storage implementation for mobile
 */
export function createSqliteStorage(): StorageInterface {
  let db: SQLite.SQLiteDatabase | null = null;
  
  /**
   * Open the database connection
   */
  const getDatabase = (): SQLite.SQLiteDatabase => {
    if (db === null) {
      console.log('Opening database connection...');
      // Open or create the database
      db = SQLite.openDatabaseSync(DB_NAME);
    }
    return db;
  };
  
  /**
   * Convert SQLite row object to Entry (standalone version)
   */
  function rowToEntry(row: any): Entry {
    return {
      id: row.id,
      item: row.item,
      qty: row.qty,
      unit: row.unit,
      price: row.price,
      total: row.total,
      type: row.type === 'cash-in' ? 'cash-in' : 'cash-out',
      created_at: row.created_at,
      transaction_date: row.transaction_date,
      source_text: row.source_text || '',
      is_final: Boolean(row.is_final),
      user_id: row.user_id,
      version: row.version || 1,
      confirmed: row.confirmed === undefined ? true : Boolean(row.confirmed),
      batch_id: row.batch_id,
      order_id: row.order_id,
      customer: row.customer,
      txn_type: row.txn_type || 'sale'
    };
  }
  
  /**
   * Format date for SQL queries
   */
  const formatDateForSQL = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };
  
  return {
    async saveEntry(entry: Partial<Entry>): Promise<Entry> {
      // Generate ID if not provided
      const id = entry.id || uuid.v4().toString();
      const createdAt = entry.created_at || new Date().toISOString();
      const transactionDate = entry.transaction_date || new Date().toISOString();
      
      const database = getDatabase();
      
      const query = `
        INSERT INTO entries (
          id, 
          item, 
          qty, 
          unit, 
          price, 
          total, 
          type, 
          created_at, 
          transaction_date, 
          source_text, 
          is_final,
          user_id,
          version,
          confirmed,
          batch_id,
          order_id,
          customer,
          txn_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        id,
        entry.item || '',
        entry.qty || 0,
        entry.unit || null,
        entry.price || 0,
        entry.total || 0,
        entry.type || 'cash-out',
        createdAt,
        transactionDate,
        entry.source_text || null,
        entry.is_final ? 1 : 0,
        entry.user_id || 'default-user',
        entry.version || 1,
        entry.confirmed === undefined ? 1 : (entry.confirmed ? 1 : 0),
        entry.batch_id || null,
        entry.order_id || null,
        entry.customer || '',
        entry.txn_type || 'sale'
      ];
      
      await database.runAsync(query, params);
      
      return {
        ...entry,
        id,
        created_at: createdAt,
        transaction_date: transactionDate,
        version: entry.version || 1,
        user_id: entry.user_id || 'default-user',
        confirmed: entry.confirmed === undefined ? true : entry.confirmed,
        batch_id: entry.batch_id,
        order_id: entry.order_id,
        customer: entry.customer || '',
        txn_type: entry.txn_type || 'sale'
      } as Entry;
    },
    
    async getEntriesByDate(date: Date = new Date()): Promise<Entry[]> {
      const formattedDate = formatDateForSQL(date);
      const database = getDatabase();
      
      const query = `
        SELECT * FROM entries 
        WHERE date(transaction_date) = date(?) 
        ORDER BY created_at DESC
      `;
      
      const result = await database.getAllAsync<any>(query, formattedDate);
      
      return result.map(row => rowToEntry(row));
    },
    
    async getTodaysEntries(): Promise<Entry[]> {
      return this.getEntriesByDate(new Date());
    },
    
    async getAllEntries(): Promise<Entry[]> {
      const database = getDatabase();
      const query = `SELECT * FROM entries ORDER BY created_at DESC`;
      
      const result = await database.getAllAsync<any>(query);
      
      return result.map(row => rowToEntry(row));
    },
    
    async updateEntry(id: string, updates: Partial<Entry>): Promise<Entry> {
      const database = getDatabase();
      
      // First, get the original entry
      const query = `SELECT * FROM entries WHERE id = ?`;
      const originalEntry = await database.getFirstAsync<any>(query, id);
      
      if (!originalEntry) {
        throw new Error(`Entry with ID ${id} not found`);
      }
      
      // Prepare update fields
      const updateFields: string[] = [];
      const updateParams: any[] = [];
      
      // Check and add each field
      if (updates.item !== undefined) {
        updateFields.push('item = ?');
        updateParams.push(updates.item);
      }
      
      if (updates.qty !== undefined) {
        updateFields.push('qty = ?');
        updateParams.push(updates.qty);
      }
      
      if (updates.unit !== undefined) {
        updateFields.push('unit = ?');
        updateParams.push(updates.unit);
      }
      
      if (updates.price !== undefined) {
        updateFields.push('price = ?');
        updateParams.push(updates.price);
      }
      
      if (updates.total !== undefined) {
        updateFields.push('total = ?');
        updateParams.push(updates.total);
      }
      
      if (updates.type !== undefined) {
        updateFields.push('type = ?');
        updateParams.push(updates.type);
      }
      
      if (updates.transaction_date !== undefined) {
        updateFields.push('transaction_date = ?');
        updateParams.push(updates.transaction_date);
      }
      
      if (updates.source_text !== undefined) {
        updateFields.push('source_text = ?');
        updateParams.push(updates.source_text);
      }
      
      if (updates.is_final !== undefined) {
        updateFields.push('is_final = ?');
        updateParams.push(updates.is_final ? 1 : 0);
      }
      
      if (updates.user_id !== undefined) {
        updateFields.push('user_id = ?');
        updateParams.push(updates.user_id);
      }
      
      if (updates.version !== undefined) {
        updateFields.push('version = ?');
        updateParams.push(updates.version);
      }
      
      if (updates.confirmed !== undefined) {
        updateFields.push('confirmed = ?');
        updateParams.push(updates.confirmed ? 1 : 0);
      }
      
      if (updates.batch_id !== undefined) {
        updateFields.push('batch_id = ?');
        updateParams.push(updates.batch_id);
      }
      
      if (updates.order_id !== undefined) {
        updateFields.push('order_id = ?');
        updateParams.push(updates.order_id);
      }
      
      if (updates.customer !== undefined) {
        updateFields.push('customer = ?');
        updateParams.push(updates.customer);
      }
      
      if (updates.txn_type !== undefined) {
        updateFields.push('txn_type = ?');
        updateParams.push(updates.txn_type);
      }
      
      // If nothing to update, return the original entry
      if (updateFields.length === 0) {
        return rowToEntry(originalEntry);
      }
      
      // Always increment version
      updateFields.push('version = version + 1');
      
      // Add ID to params
      updateParams.push(id);
      
      // Construct and execute update query
      const updateQuery = `
        UPDATE entries 
        SET ${updateFields.join(', ')} 
        WHERE id = ?
      `;
      
      await database.runAsync(updateQuery, updateParams);
      
      // Get updated entry
      const getUpdatedQuery = `SELECT * FROM entries WHERE id = ?`;
      const updatedEntry = await database.getFirstAsync<any>(getUpdatedQuery, id);
      
      return rowToEntry(updatedEntry);
    },
    
    async deleteEntry(id: string): Promise<boolean> {
      const database = getDatabase();
      const query = `DELETE FROM entries WHERE id = ?`;
      
      const result = await database.runAsync(query, id);
      
      return result.changes > 0;
    },
    
    async searchEntries(query: string): Promise<Entry[]> {
      const database = getDatabase();
      
      const searchQuery = `
        SELECT * FROM entries 
        WHERE item LIKE ? OR source_text LIKE ? 
        ORDER BY created_at DESC
      `;
      
      const searchParam = `%${query}%`;
      const result = await database.getAllAsync<any>(searchQuery, searchParam, searchParam);
      
      return result.map(row => rowToEntry(row));
    },
    
    async getTotalByType(type: 'cash-in' | 'cash-out', date?: Date): Promise<number> {
      const database = getDatabase();
      let query = `SELECT SUM(total) as total FROM entries WHERE type = ?`;
      const params: any[] = [type];
      
      if (date) {
        const formattedDate = formatDateForSQL(date);
        query += ` AND date(transaction_date) = date(?)`;
        params.push(formattedDate);
      }
      
      const result = await database.getFirstAsync<{ total: number }>(query, params);
      return result?.total || 0;
    },
    
    async markEntriesAsFinal(ids: string[]): Promise<boolean> {
      if (ids.length === 0) return true;
      
      const database = getDatabase();
      
      // Create placeholders for all IDs
      const placeholders = ids.map(() => '?').join(',');
      
      const query = `
        UPDATE entries 
        SET is_final = 1 
        WHERE id IN (${placeholders})
      `;
      
      const result = await database.runAsync(query, ids);
      return result.changes > 0;
    },
    
    async initialize(): Promise<void> {
      try {
        console.log('Initializing database...');
        
        // First get the database
        const database = getDatabase();
        
        // *** IMPROVED MIGRATION LOGIC ***
        // Run the migration FIRST, before any table creation or other operations
        try {
          console.log('Running migration check for table structure...');
          
          // Check if the table exists at all
          const tableExists = await database.getFirstAsync<{count: number}>(`
            SELECT count(*) as count FROM sqlite_master 
            WHERE type='table' AND name='entries'
          `);
          
          if (tableExists && tableExists.count > 0) {
            console.log('Entries table exists, checking for required columns...');
            
            // Get current table structure
            const tableInfo = await database.getAllAsync<any>('PRAGMA table_info(entries)');
            const columns = tableInfo.map(col => col.name);
            console.log('Current columns:', columns.join(', '));
            
            // Add confirmed column if it doesn't exist
            if (!columns.includes('confirmed')) {
              console.log('Adding confirmed column...');
              try {
                await database.runAsync('ALTER TABLE entries ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 1');
                console.log('Added confirmed column successfully');
              } catch (err) {
                console.error('Error adding confirmed column:', err);
              }
            } else {
              console.log('confirmed column already exists');
            }
            
            // Add batch_id column if it doesn't exist
            if (!columns.includes('batch_id')) {
              console.log('Adding batch_id column...');
              try {
                await database.runAsync('ALTER TABLE entries ADD COLUMN batch_id TEXT');
                console.log('Added batch_id column successfully');
              } catch (err) {
                console.error('Error adding batch_id column:', err);
              }
            } else {
              console.log('batch_id column already exists');
            }
            
            // Add order_id column if it doesn't exist (for Orders functionality)
            if (!columns.includes('order_id')) {
              console.log('Adding order_id column...');
              try {
                await database.runAsync('ALTER TABLE entries ADD COLUMN order_id TEXT');
                console.log('Added order_id column successfully');
              } catch (err) {
                console.error('Error adding order_id column:', err);
              }
            } else {
              console.log('order_id column already exists');
            }
            
            // Add customer column if it doesn't exist (for Credit functionality)
            if (!columns.includes('customer')) {
              console.log('Adding customer column...');
              try {
                await database.runAsync('ALTER TABLE entries ADD COLUMN customer TEXT');
                console.log('Added customer column successfully');
              } catch (err) {
                console.error('Error adding customer column:', err);
              }
            } else {
              console.log('customer column already exists');
            }
            
            // Add txn_type column if it doesn't exist (for Credit functionality)  
            if (!columns.includes('txn_type')) {
              console.log('Adding txn_type column...');
              try {
                await database.runAsync('ALTER TABLE entries ADD COLUMN txn_type TEXT DEFAULT "sale"');
                console.log('Added txn_type column successfully');
              } catch (err) {
                console.error('Error adding txn_type column:', err);
              }
            } else {
              console.log('txn_type column already exists');
            }
            
            // Create indices regardless (IF NOT EXISTS will prevent duplicates)
            console.log('Creating indices for columns...');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_confirmed ON entries(confirmed)');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_batch ON entries(batch_id)');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_entries_order ON entries(order_id)');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_entries_customer ON entries(customer)');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_entries_txn_type ON entries(txn_type)');
            await database.runAsync('CREATE INDEX IF NOT EXISTS idx_entries_customer_txn_type ON entries(customer, txn_type)');
            console.log('Created indices for columns');
          } else {
            console.log('Entries table does not exist yet, will be created with all columns');
          }

          // Check if prices table exists and create it if it doesn't
          const pricesTableExists = await database.getFirstAsync<{count: number}>(`
            SELECT count(*) as count FROM sqlite_master 
            WHERE type='table' AND name='prices'
          `);

          if (!pricesTableExists || pricesTableExists.count === 0) {
            console.log('Creating prices table...');
            try {
              await database.runAsync(`
                CREATE TABLE IF NOT EXISTS prices (
                  id TEXT PRIMARY KEY,
                  item TEXT NOT NULL,
                  price REAL NOT NULL,
                  updated_at INTEGER NOT NULL,
                  batch_id TEXT,
                  confirmed INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                )
              `);
              console.log('Created prices table successfully');
            } catch (err) {
              console.error('Error creating prices table:', err);
            }
          } else {
            console.log('Prices table already exists');
          }

          // Check if orders table exists and create it if it doesn't
          const ordersTableExists = await database.getFirstAsync<{count: number}>(`
            SELECT count(*) as count FROM sqlite_master 
            WHERE type='table' AND name='orders'
          `);

          if (!ordersTableExists || ordersTableExists.count === 0) {
            console.log('Creating orders table...');
            try {
              await database.runAsync(`
                CREATE TABLE IF NOT EXISTS orders (
                  order_id TEXT PRIMARY KEY,
                  customer TEXT DEFAULT 'Walk-in',
                  status TEXT CHECK(status IN ('open', 'partial', 'delivered', 'cancelled')) DEFAULT 'open',
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL
                )
              `);
              console.log('Created orders table successfully');
            } catch (err) {
              console.error('Error creating orders table:', err);
            }
          } else {
            console.log('Orders table already exists');
          }

          // Check if order_items table exists and create it if it doesn't  
          const orderItemsTableExists = await database.getFirstAsync<{count: number}>(`
            SELECT count(*) as count FROM sqlite_master 
            WHERE type='table' AND name='order_items'
          `);

          if (!orderItemsTableExists || orderItemsTableExists.count === 0) {
            console.log('Creating order_items table...');
            try {
              await database.runAsync(`
                CREATE TABLE IF NOT EXISTS order_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  order_id TEXT NOT NULL,
                  item TEXT NOT NULL,
                  qty REAL NOT NULL,
                  price REAL NULL,
                  delivered INTEGER DEFAULT 0,
                  delivery_date TEXT NULL,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL,
                  FOREIGN KEY(order_id) REFERENCES orders(order_id) ON DELETE CASCADE
                )
              `);
              
              // Create indices for order_items
              await database.runAsync('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');
              await database.runAsync('CREATE INDEX IF NOT EXISTS idx_order_items_delivered ON order_items(delivered)');
              await database.runAsync('CREATE INDEX IF NOT EXISTS idx_order_items_order_delivered ON order_items(order_id, delivered)');
              
              console.log('Created order_items table and indices successfully');
            } catch (err) {
              console.error('Error creating order_items table:', err);
            }
          } else {
            console.log('Order_items table already exists');
          }
          
        } catch (migrationError) {
          console.error('Migration error:', migrationError);
          console.log('Continuing with initialization despite migration error');
          // Don't throw here - we'll try to continue with initialization
        }
        
        try {
          console.log('Setting up database tables...');
          
          // Create app_info table for verification and metadata
          const createAppInfoTable = `
            CREATE TABLE IF NOT EXISTS app_info (
              key TEXT PRIMARY KEY, 
              value TEXT
            )
          `;
          
          await database.runAsync(createAppInfoTable);
          console.log('App info table created successfully');
          
          // Create entries table
          const createEntriesTable = `
            CREATE TABLE IF NOT EXISTS entries (
              id TEXT PRIMARY KEY,
              item TEXT NOT NULL,
              qty REAL NOT NULL,
              unit TEXT,
              price REAL NOT NULL,
              total REAL NOT NULL,
              type TEXT NOT NULL,
              created_at TEXT NOT NULL,
              transaction_date TEXT NOT NULL,
              source_text TEXT,
              is_final INTEGER DEFAULT 0,
              user_id TEXT NOT NULL,
              version INTEGER DEFAULT 1,
              confirmed INTEGER NOT NULL DEFAULT 1,
              batch_id TEXT,
              order_id TEXT,
              customer TEXT,
              txn_type TEXT DEFAULT 'sale'
            )
          `;
          
          await database.runAsync(createEntriesTable);
          console.log('Entries table created successfully');
          
          // Create indices one by one
          console.log('Creating indices...');
          try {
            // Transaction date index
            const createDateIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_transaction_date 
              ON entries (transaction_date)
            `;
            await database.runAsync(createDateIndex);
            console.log('Transaction date index created');
            
            // Type index
            const createTypeIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_type 
              ON entries (type)
            `;
            await database.runAsync(createTypeIndex);
            console.log('Type index created');
            
            // User ID index
            const createUserIdIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_user_id 
              ON entries (user_id)
            `;
            await database.runAsync(createUserIdIndex);
            console.log('User ID index created');
            
            // Confirmed index
            const createConfirmedIndex = `
              CREATE INDEX IF NOT EXISTS idx_confirmed ON entries(confirmed)
            `;
            await database.runAsync(createConfirmedIndex);
            console.log('Confirmed index created');
            
            // Batch ID index
            const createBatchIndex = `
              CREATE INDEX IF NOT EXISTS idx_batch ON entries(batch_id)
            `;
            await database.runAsync(createBatchIndex);
            console.log('Batch ID index created');
            
            // Order ID index  
            const createOrderIdIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_order_id ON entries(order_id)
            `;
            await database.runAsync(createOrderIdIndex);
            console.log('Order ID index created');
            
            // Customer index
            const createCustomerIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_customer ON entries(customer)
            `;
            await database.runAsync(createCustomerIndex);
            console.log('Customer index created');
            
            // Transaction type index
            const createTxnTypeIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_txn_type ON entries(txn_type)
            `;
            await database.runAsync(createTxnTypeIndex);
            console.log('Transaction type index created');
            
            // Composite customer + transaction type index for optimal credit queries
            const createCustomerTxnTypeIndex = `
              CREATE INDEX IF NOT EXISTS idx_entries_customer_txn_type ON entries(customer, txn_type)
            `;
            await database.runAsync(createCustomerTxnTypeIndex);
            console.log('Customer + transaction type composite index created');
          } catch (indexError) {
            // If indices fail, it's not critical - the app can still work without them
            console.warn('Failed to create indices, but continuing anyway:', indexError);
          }
          
          // Store database version in app_info
          const insertDbVersion = `
            INSERT OR REPLACE INTO app_info (key, value) 
            VALUES ('db_version', '1.3')
          `;
          await database.runAsync(insertDbVersion);
          
          const insertLastInit = `
            INSERT OR REPLACE INTO app_info (key, value) 
            VALUES ('last_init', ?)
          `;
          await database.runAsync(insertLastInit, [new Date().toISOString()]);
          
          console.log('Database initialization completed successfully');
        } catch (error) {
          console.error('Database schema creation error:', error);
          throw new Error(`Failed to create database schema: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        console.error('Database initialization error:', error);
        throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /**
     * Optimized batch save function for multiple entries using transactions
     * This is much faster than calling saveEntry multiple times
     */
    async saveEntriesBatch(entries: Partial<Entry>[]): Promise<Entry[]> {
      const db = getDatabase();
      const savedEntries: Entry[] = [];
      
      try {
        await db.withTransactionAsync(async () => {
          const query = `
            INSERT INTO entries (
              id, item, qty, unit, price, total, type, 
              created_at, transaction_date, source_text, 
              is_final, user_id, version, confirmed, 
              batch_id, order_id, customer, txn_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          for (const entry of entries) {
            const id = entry.id || uuid.v4().toString();
            const createdAt = entry.created_at || new Date().toISOString();
            const transactionDate = entry.transaction_date || new Date().toISOString();
            
            const params = [
              id,
              entry.item || '',
              entry.qty || 0,
              entry.unit || null,
              entry.price || 0,
              entry.total || 0,
              entry.type || 'cash-out',
              createdAt,
              transactionDate,
              entry.source_text || null,
              entry.is_final ? 1 : 0,
              entry.user_id || 'default-user',
              entry.version || 1,
              entry.confirmed === undefined ? 1 : (entry.confirmed ? 1 : 0),
              entry.batch_id || null,
              entry.order_id || null,
              entry.customer || '',
              entry.txn_type || 'sale'
            ];
            
            await db.runAsync(query, params);
            
            savedEntries.push({
              ...entry,
              id,
              created_at: createdAt,
              transaction_date: transactionDate,
              version: entry.version || 1,
              user_id: entry.user_id || 'default-user',
              confirmed: entry.confirmed === undefined ? true : entry.confirmed,
              batch_id: entry.batch_id,
              order_id: entry.order_id,
              customer: entry.customer || '',
              txn_type: entry.txn_type || 'sale'
            } as Entry);
          }
        });
        
        return savedEntries;
      } catch (error) {
        console.error('Error saving entries batch:', error);
        throw error;
      }
    },

    // Get deliveries by date with order information
    async getDeliveriesByDate(date: Date): Promise<Array<{
      order_id: string;
      customer_name: string;
      items: Array<{
        id: number;
        item: string;
        qty: number;
        price: number | null;
        delivery_date: string;
      }>;
      total_value: number;
    }>> {
      const db = getDatabase();
      const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      try {
        const rows = await db.getAllAsync<{
          order_id: string;
          customer_name: string;
          item_id: number;
          item: string;
          qty: number;
          price: number | null;
          delivery_date: string;
        }>(`
          SELECT 
            o.order_id,
            o.customer as customer_name,
            oi.id as item_id,
            oi.item,
            oi.qty,
            oi.price,
            oi.delivery_date
          FROM orders o
          JOIN order_items oi ON o.order_id = oi.order_id
          WHERE oi.delivery_date = ? 
            AND oi.delivered = 0
            AND o.status != 'cancelled'
          ORDER BY o.customer, o.order_id, oi.item
        `, [dateString]);
        
        const deliveryData: Record<string, any> = {};
        
        // Group items by order
        for (const row of rows) {
          const orderId = row.order_id;
          
          if (!deliveryData[orderId]) {
            deliveryData[orderId] = {
              order_id: orderId,
              customer_name: row.customer_name,
              items: [],
              total_value: 0
            };
          }
          
          const item = {
            id: row.item_id,
            item: row.item,
            qty: row.qty,
            price: row.price,
            delivery_date: row.delivery_date
          };
          
          deliveryData[orderId].items.push(item);
          deliveryData[orderId].total_value += (row.price || 0) * row.qty;
        }
        
        // Convert to array
        return Object.values(deliveryData);
      } catch (error) {
        console.error('Error getting deliveries by date:', error);
        throw error;
      }
    }
  };
}

/**
 * Helper function to delete an entry by ID
 */
export async function deleteEntry(id: string) {
  const storage = await getStorage();
  return storage.deleteEntry(id);
}

// Function to get Storage from elsewhere in the app
async function getStorage(): Promise<StorageInterface> {
  return createSqliteStorage();
}

/**
 * Helper function to get a database connection
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  return SQLite.openDatabaseSync(DB_NAME);
}

/**
 * Helper function to get pending (unconfirmed) entries for a specific date
 * @param dateISO Date in ISO string format
 * @param startTime Optional start time for filtering
 * @param endTime Optional end time for filtering
 */
export async function getPendingEntries(dateISO: string, startTime?: Date, endTime?: Date) {
  const db = getDatabase();
  
  let query = `SELECT * FROM entries
      WHERE confirmed = 0
      AND DATE(transaction_date) = DATE(?)`;
  const params: any[] = [dateISO];
  
  // Add time range filter if both start and end times are provided
  if (startTime && endTime) {
    // Extract the date part from dateISO and combine with time
    const selectedDate = new Date(dateISO);
    
    const startDateTime = new Date(selectedDate);
    startDateTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    
    const endDateTime = new Date(selectedDate);
    endDateTime.setHours(endTime.getHours(), endTime.getMinutes(), 59, 999);
    
    query += ` AND transaction_date >= ? AND transaction_date <= ?`;
    params.push(startDateTime.toISOString(), endDateTime.toISOString());
  }
  
  query += ` ORDER BY transaction_date DESC`;
  
  return db.getAllAsync(query, params);
}

/**
 * Helper function to mark an entry as confirmed and optionally update its price
 */
export async function updateEntryConfirmed(id: string, newPrice?: number) {
  const db = getDatabase();
  
  const entry = await db.getFirstAsync<any>('SELECT * FROM entries WHERE id = ?', [id]);
  if (!entry) {
    throw new Error(`Entry with ID ${id} not found`);
  }

  // Update the confirmed status and increment version
  await db.runAsync(
    `UPDATE entries
       SET confirmed = 1, version = version + 1
     WHERE id = ?`,
    [id]
  );
  
  // If price also needs to be updated
  if (newPrice !== undefined && newPrice !== entry.price) {
    // Note: This will increment version again if we add it here.
    // For now, we assume the main confirmation is the primary version bump.
    // If price update should also be a distinct version, this needs more thought.
    await db.runAsync(
      `UPDATE entries
         SET price = ?,
             total = ? * qty 
       WHERE id = ?`,
      [newPrice, newPrice, id]
    );
    
    // Update item_prices table
    await db.runAsync(
      `INSERT INTO item_prices (item, last_price, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(item) DO UPDATE
         SET last_price = excluded.last_price,
             updated_at = CURRENT_TIMESTAMP`,
      [entry.item, newPrice]
    );
  }
  
  // Return the updated entry
  return await db.getFirstAsync<any>('SELECT * FROM entries WHERE id = ?', [id]);
}

/**
 * Helper function to confirm all pending entries for a specific date
 */
export async function confirmAllPending(dateISO: string) {
  const db = getDatabase();
  
  await db.runAsync(
    `UPDATE entries
       SET confirmed = 1, version = version + 1
     WHERE confirmed = 0
       AND DATE(transaction_date) = DATE(?)`,
    [dateISO]
  );
}

/**
 * Delete all entries in a batch by batch_id
 */
export async function deleteBatch(batchId: string) {
  const db = getDatabase();
  await db.runAsync('DELETE FROM entries WHERE batch_id = ?', [batchId]);
}

/**
 * Get all entries in a batch by batch_id
 */
export async function getEntriesByBatch(batchId: string) {
  const db = getDatabase();
  return db.getAllAsync('SELECT * FROM entries WHERE batch_id = ? AND confirmed = 0 ORDER BY created_at DESC', [batchId]);
}

/**
 * Get all confirmed entries in a batch by batch_id
 */
export async function getConfirmedEntriesByBatch(batchId: string) {
  const db = getDatabase();
  return db.getAllAsync('SELECT * FROM entries WHERE batch_id = ? AND confirmed = 1 ORDER BY created_at DESC', [batchId]);
}

/**
 * Get entries by cluster ID (handles both batch_id and order_id based clustering)
 * @param clusterId - The cluster ID with prefix (e.g., 'batch_ABC123' or 'order_ORD-006')
 * @param confirmed - Whether to get confirmed or unconfirmed entries
 */
export async function getEntriesByCluster(clusterId: string, confirmed: boolean = false) {
  const db = getDatabase();
  
  if (clusterId.startsWith('batch_')) {
    const actualBatchId = clusterId.substring(6);
    return db.getAllAsync(
      'SELECT * FROM entries WHERE batch_id = ? AND confirmed = ? ORDER BY created_at DESC', 
      [actualBatchId, confirmed ? 1 : 0]
    );
  } else if (clusterId.startsWith('order_')) {
    const actualOrderId = clusterId.substring(6);
    return db.getAllAsync(
      'SELECT * FROM entries WHERE order_id = ? AND confirmed = ? ORDER BY created_at DESC', 
      [actualOrderId, confirmed ? 1 : 0]
    );
  }
  
  // Fallback - return empty array for unknown cluster types
  return [];
}

/**
 * Get entries by cluster ID with order information
 * @param clusterId - The cluster ID with prefix (e.g., 'batch_ABC123' or 'order_ORD-006')
 * @param confirmed - Whether to get confirmed or unconfirmed entries
 */
export async function getEntriesByClusterWithOrderInfo(clusterId: string, confirmed: boolean = false) {
  const db = getDatabase();
  
  if (clusterId.startsWith('batch_')) {
    const actualBatchId = clusterId.substring(6);
    return db.getAllAsync(
      `SELECT e.*, o.customer 
       FROM entries e
       LEFT JOIN orders o ON e.order_id = o.order_id
       WHERE e.batch_id = ? AND e.confirmed = ? 
       ORDER BY e.created_at DESC`, 
      [actualBatchId, confirmed ? 1 : 0]
    );
  } else if (clusterId.startsWith('order_')) {
    const actualOrderId = clusterId.substring(6);
    return db.getAllAsync(
      `SELECT e.*, o.customer 
       FROM entries e
       LEFT JOIN orders o ON e.order_id = o.order_id
       WHERE e.order_id = ? AND e.confirmed = ? 
       ORDER BY e.created_at DESC`, 
      [actualOrderId, confirmed ? 1 : 0]
    );
  }
  
  // Fallback - return empty array for unknown cluster types
  return [];
}

/**
 * Helper function to ensure the prices table has all required columns
 */
async function ensurePricesTableColumns(db: SQLite.SQLiteDatabase) {
  // Skip if we've already checked this session - this is a major performance improvement
  if (pricesTableColumnsEnsured) {
    return;
  }

  try {
    // Check if the columns exist
    await db.execAsync(`PRAGMA table_info(prices)`);
    
    // Check if the source_text column exists
    let hasSourceText = false;
    let hasCreatedAt = false;
    let hasUpdatedAt = false;
    let hasLastUpdateComment = false;
    
    const tableInfo = await db.getAllAsync<{name: string}>(`PRAGMA table_info(prices)`);
    
    for (const column of tableInfo) {
      if (column.name === 'source_text') {
        hasSourceText = true;
      } else if (column.name === 'created_at') {
        hasCreatedAt = true;
      } else if (column.name === 'updated_at') {
        hasUpdatedAt = true;
      } else if (column.name === 'last_update_comment') {
        hasLastUpdateComment = true;
      }
    }
    
    // Add missing columns if needed
    if (!hasSourceText) {
      await db.execAsync(`ALTER TABLE prices ADD COLUMN source_text TEXT`);
    }
    
    if (!hasCreatedAt) {
      await db.execAsync(`ALTER TABLE prices ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`);
    }
    
    if (!hasUpdatedAt) {
      await db.execAsync(`ALTER TABLE prices ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now'))`);
    }
    
    if (!hasLastUpdateComment) {
      await db.execAsync(`ALTER TABLE prices ADD COLUMN last_update_comment TEXT DEFAULT 'Initial'`);
    }

    // Check if indexes exist
    const indexInfo = await db.getAllAsync<{name: string}>(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='prices'`);
    const indexNames = indexInfo.map(index => index.name);
    
    // Add item index if it doesn't exist
    if (!indexNames.includes('idx_prices_item')) {
      await db.execAsync(`CREATE INDEX idx_prices_item ON prices(item)`);
    }
    
    // Add updated_at index if it doesn't exist
    if (!indexNames.includes('idx_prices_updated_at')) {
      await db.execAsync(`CREATE INDEX idx_prices_updated_at ON prices(updated_at)`);
    }
    
    // Mark as checked for this session
    pricesTableColumnsEnsured = true;
  } catch (error) {
    console.error('Error ensuring prices table columns:', error);
    throw error;
  }
}

/**
 * Get price entries
 * @param date Optional date to filter by
 * @param startTime Optional start time to filter by (in hours)
 * @param endTime Optional end time to filter by (in hours)
 */
export async function getPrices(date?: Date, startTime?: Date, endTime?: Date) {
  const db = getDatabase();
  
  try {
    // Ensure all required columns exist
    await ensurePricesTableColumns(db);
    
    // If no date is provided, return all prices
    if (!date) {
      return db.getAllAsync(`
        SELECT * FROM prices
        ORDER BY item
      `);
    }
    
    // Convert date to start and end of day timestamps
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    // If time range is provided, use it to adjust the start and end timestamps
    let effectiveStartTime = Math.floor(startOfDay.getTime() / 1000);
    let effectiveEndTime = Math.floor(endOfDay.getTime() / 1000);
    
    if (startTime && endTime) {
      // Create timestamps based on selected date with specified hours
      const startDateTime = new Date(date);
      startDateTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
      
      const endDateTime = new Date(date);
      endDateTime.setHours(endTime.getHours(), endTime.getMinutes(), 59, 999);
      
      effectiveStartTime = Math.floor(startDateTime.getTime() / 1000);
      effectiveEndTime = Math.floor(endDateTime.getTime() / 1000);
    }
    
    return db.getAllAsync(`
      SELECT * FROM prices
      WHERE updated_at >= ?
      AND updated_at <= ?
      ORDER BY item
    `, [effectiveStartTime, effectiveEndTime]);
  } catch (error) {
    console.error('Error in getPrices:', error);
    throw error;
  }
}

/**
 * Delete a price entry
 */
export async function deletePrice(id: string) {
  const db = getDatabase();
  await db.runAsync(`
    DELETE FROM prices
    WHERE id = ?
  `, [id]);
  
  return true;
}

/**
 * Update a price entry
 */
export async function updatePrice(id: string, item: string, price: number, date?: Date) {
  const db = getDatabase();
  
  try {
    await ensurePricesTableColumns(db);
    
    // Use the provided date for updated_at, or current time if not provided
    const updatedTimestamp = date ? Math.floor(date.getTime() / 1000) : Math.floor(Date.now() / 1000);
    
    // Check if an item with the same name already exists (case-insensitive)
    const existingItem = await db.getFirstAsync<{id: string, price: number}>(
      `SELECT id, price FROM prices WHERE LOWER(item) = LOWER(?) AND id != ? ORDER BY updated_at DESC LIMIT 1`,
      [item, id]
    );
    
    if (existingItem) {
      // If the item already exists with a different ID, update that record and delete this one
      await db.runAsync(`
        UPDATE prices
        SET price = ?, updated_at = ?, last_update_comment = 'User Update'
        WHERE id = ?
      `, [price, updatedTimestamp, existingItem.id]);
      
      // Delete the current record since we've updated the existing one
      await db.runAsync(`
        DELETE FROM prices
        WHERE id = ?
      `, [id]);
      
      return true;
    }
    
    // If no existing item with the same name, just update this record
    await db.runAsync(`
      UPDATE prices
      SET item = ?, price = ?, updated_at = ?, last_update_comment = 'User Update'
      WHERE id = ?
    `, [item, price, updatedTimestamp, id]);
    
    return true;
  } catch (error) {
    console.error('Error updating price details:', error);
    return false; // Indicate failure
  }
}

/**
 * Refresh prices from last sold items
 */
export async function refreshPricesFromLastSold(item?: string): Promise<void> {
  const db = getDatabase();
  
  try {
    // First ensure the column exists
    await ensurePricesTableColumns(db);
    
    // Check if last_update_comment column exists in the prices table
    const columnExists = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) as count FROM pragma_table_info('prices') WHERE name='last_update_comment'`
    );
    
    // Build SQL based on whether the column exists
    let sql;
    
    if (columnExists && columnExists.count > 0) {
      sql = item
        ? `UPDATE prices SET
             price               = (SELECT price FROM entries
                                     WHERE item = ? AND price IS NOT NULL
                                     ORDER BY created_at DESC LIMIT 1),
             updated_at          = strftime('%s','now'),
             last_update_comment = 'Last Sold Price'
           WHERE item = ?;`
        : `UPDATE prices SET
             price = (SELECT price FROM entries e
                      WHERE e.item = prices.item AND e.price IS NOT NULL
                      ORDER BY e.created_at DESC LIMIT 1),
             updated_at          = strftime('%s','now'),
             last_update_comment = 'Last Sold Price'
           WHERE EXISTS (SELECT 1 FROM entries e2 WHERE e2.item = prices.item);`;
    } else {
      // If the column doesn't exist, don't try to update it
      sql = item
        ? `UPDATE prices SET
             price               = (SELECT price FROM entries
                                     WHERE item = ? AND price IS NOT NULL
                                     ORDER BY created_at DESC LIMIT 1),
             updated_at          = strftime('%s','now')
           WHERE item = ?;`
        : `UPDATE prices SET
             price = (SELECT price FROM entries e
                      WHERE e.item = prices.item AND e.price IS NOT NULL
                      ORDER BY e.created_at DESC LIMIT 1),
             updated_at          = strftime('%s','now')
           WHERE EXISTS (SELECT 1 FROM entries e2 WHERE e2.item = prices.item);`;
    }
    
    await db.runAsync(sql, item ? [item, item] : []);
  } catch (error) {
    console.error('Error refreshing prices from last sold:', error);
    throw error; // Rethrow to propagate the error to the caller
  }
}

/**
 * Upsert a price for an item (insert if not exists, update if exists)
 */
export async function upsertPrice(
  item: string,
  price: number,
  comment: string = 'User Update',
): Promise<void> {
  const db = getDatabase();
  
  try {
    await ensurePricesTableColumns(db);
    
    const id = uuid.v4().toString();
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const createdAtISO = new Date().toISOString();
    
    const existingItem = await db.getFirstAsync<{id: string}>(
      `SELECT id FROM prices 
      WHERE LOWER(item) = LOWER(?)
       ORDER BY updated_at DESC LIMIT 1`,
      [item]
    );
    
    if (existingItem) {
      // Update existing record - fix parameter mismatch
      await db.runAsync(`
        UPDATE prices 
        SET price = ?, updated_at = ?, last_update_comment = ?
        WHERE id = ?
      `, [price, nowTimestamp, comment, existingItem.id]);
    } else {
      // Insert new record - use consistent timestamp format
      await db.runAsync(`
        INSERT INTO prices (id, item, price, updated_at, created_at, last_update_comment)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [id, item, price, nowTimestamp, createdAtISO, comment]);
    }
  } catch (error) {
    console.error('Error upserting price:', error);
    throw error; // Re-throw so verification failures are properly caught
  }
}

/**
 * Save a single price item
 */
export async function saveSinglePrice(item: string, price: number, sourceText?: string): Promise<string> {
  const db = getDatabase();
  const id = uuid.v4().toString();
  const nowTimestamp = Math.floor(Date.now() / 1000);
  const createdAtISO = new Date().toISOString();
  
  // If no source text is provided, generate one
  const finalSourceText = sourceText || `price of ${item} is ₹${price.toFixed(2)}`;
  
  try {
    await ensurePricesTableColumns(db);
      
      // Check if an item with the same name already exists (case-insensitive)
    const existingItem = await db.getFirstAsync<{id: string}>(
      `SELECT id FROM prices WHERE LOWER(item) = LOWER(?) ORDER BY updated_at DESC LIMIT 1`,
      [item]
      );

      if (existingItem) {
        // If the item already exists, update it
        await db.runAsync(`
          UPDATE prices
        SET price = ?, updated_at = ?, source_text = ?, last_update_comment = 'User Update'
          WHERE id = ?
      `, [price, nowTimestamp, finalSourceText, existingItem.id]);
      
      return existingItem.id;
      } else {
        // Insert new price if it doesn't exist
        await db.runAsync(`
        INSERT INTO prices (id, item, price, updated_at, created_at, source_text, last_update_comment)
        VALUES (?, ?, ?, ?, ?, ?, 'Initial')
      `, [id, item, price, nowTimestamp, createdAtISO, finalSourceText]);
    
      return id;
    }
  } catch (error) {
    console.error(`[saveSinglePrice] Error saving price (id: ${id}):`, error);
    throw error; // Re-throw to be caught by the caller
  }
}

/**
 * Look up a price for a specific item
 * @param item The item name to look up
 * @returns The price if found, null if not found
 */
export async function lookupPrice(item: string): Promise<number | null> {
  const db = getDatabase();
  
  try {
    // Ensure all required columns exist
    await ensurePricesTableColumns(db);
    
    // Look up the item (case-insensitive)
    const result = await db.getFirstAsync<{ price: number }>(`
      SELECT price FROM prices
      WHERE LOWER(item) = LOWER(?)
      LIMIT 1
    `, [item]);
    
    if (result) {
      return result.price;
    }
    
    return null;
  } catch (error) {
    console.error('Error looking up price:', error);
    return null;
  }
}

/**
 * Save a batch of price updates
 * We keep this function for backward compatibility, but it now processes each item individually
 */
export async function savePriceBatch(priceItems: Array<{item: string, price: number, source_text?: string}>): Promise<string> {
  // Generate a fake batch ID for API compatibility
  const batchId = uuid.v4().toString();
  
  try {
    // Process each price item individually
    for (const priceItem of priceItems) {
      await saveSinglePrice(
        priceItem.item,
        priceItem.price,
        priceItem.source_text || `price of ${priceItem.item} is ₹${priceItem.price.toFixed(2)}`
      );
    }
    
    return batchId; // Return a batch ID for backward compatibility
  } catch (error) {
    console.error('Error saving price batch:', error);
    throw error;
  }
}

/**
 * Compatibility function for deleting a price batch
 * In the "one item = one price" model, this is no longer needed but kept for API compatibility
 */
export async function deletePriceBatch(batchId: string): Promise<boolean> {
  // This is now a no-op since we've removed batch_id functionality
  console.log(`[deletePriceBatch] No-op for batch ID ${batchId} in One Item = One Price model`);
  return true;
}

// helper to fetch top similar items
export async function lookupSimilarItems(
  search: string,
  limit = 10,
): Promise<{ item: string; price: number }[]> {
  // Check cache first
  const cacheKey = `${search.toLowerCase().trim()}_${limit}`;
  const cached = similarItemsCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < 3000) { // 3 second cache
    return cached.results;
  }
  
  const db = await getDatabase();
  
  // Clean up the search term and split into words
  const searchWords = search.toLowerCase().trim().split(/\s+/);
  
  // Build the SQL query with word matching
  let sql = `
    SELECT item, price
    FROM prices
    WHERE `;
  
  // Add a LIKE clause for each word
  if (searchWords.length > 0) {
    const conditions = [];
    const params = [];
    
    // Match any of the search words in the item name
    for (const word of searchWords) {
      if (word.length > 2) { // Only use words with at least 3 characters
        conditions.push(`LOWER(item) LIKE ?`);
        params.push(`%${word}%`);
      }
    }
    
    // If we have no valid words, match the whole string
    if (conditions.length === 0) {
      conditions.push(`LOWER(item) LIKE ?`);
      params.push(`%${search.toLowerCase()}%`);
    }
    
    sql += conditions.join(' OR ');
    
    // Add the ordering and limit
    sql += `
      ORDER BY 
        CASE 
          WHEN LOWER(item) = ? THEN 0
          WHEN LOWER(item) LIKE ? THEN 1
          ELSE 2
        END,
        updated_at DESC
      LIMIT ?
    `;
    
    // Add the exact match, starts with, and limit parameters
    params.push(search.toLowerCase());
    params.push(`${search.toLowerCase()}%`);
    params.push(limit);
    
    const result = await db.getAllAsync<any>(sql, params);
    const mappedResults = result.map(row => ({
      item: row.item,
      price: row.price
    }));
    
    // Cache the results
    similarItemsCache.set(cacheKey, {
      timestamp: Date.now(),
      results: mappedResults
    });
    
    return mappedResults;
  } else {
    // Fallback to a simple search if we couldn't extract words
    const simpleQuery = `
      SELECT item, price
      FROM prices
      WHERE LOWER(item) LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `;
    
    const result = await db.getAllAsync<any>(simpleQuery, [`%${search.toLowerCase()}%`, limit]);
    const mappedResults = result.map(row => ({
      item: row.item,
      price: row.price
    }));
    
    // Cache the results
    similarItemsCache.set(cacheKey, {
      timestamp: Date.now(),
      results: mappedResults
    });
    
    return mappedResults;
  }
}

/**
 * Convert SQLite row object to Entry (standalone version for helper functions)
 */
function standaloneRowToEntry(row: any): Entry {
  return {
    id: row.id,
    item: row.item,
    qty: row.qty,
    unit: row.unit,
    price: row.price,
    total: row.total,
    type: row.type === 'cash-in' ? 'cash-in' : 'cash-out',
    created_at: row.created_at,
    transaction_date: row.transaction_date,
    source_text: row.source_text || '',
    is_final: Boolean(row.is_final),
    user_id: row.user_id,
    version: row.version || 1,
    confirmed: row.confirmed === undefined ? true : Boolean(row.confirmed),
    batch_id: row.batch_id,
    order_id: row.order_id,
    customer: row.customer,
    txn_type: row.txn_type || 'sale'
  };
}

/**
 * Get entries by date and optional time range, with optional confirmation filter
 * This performs database-level filtering for better performance
 */
export async function getEntriesByDateAndTimeRange(
  date: Date,
  startTime?: Date,
  endTime?: Date,
  confirmedOnly?: boolean
): Promise<Entry[]> {
  const database = getDatabase();
  
  // Start with base query for the specific date
  let query = `
    SELECT * FROM entries 
    WHERE date(transaction_date) = date(?)
  `;
  const params: any[] = [date.toISOString()];
  
  // Add confirmation filter if specified
  if (confirmedOnly !== undefined) {
    query += ` AND confirmed = ?`;
    params.push(confirmedOnly ? 1 : 0);
  }
  
  // Add time range filter if both start and end times are provided
  if (startTime && endTime) {
    // Create start and end datetime strings for the specific date
    const startDateTime = new Date(date);
    startDateTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    
    const endDateTime = new Date(date);
    endDateTime.setHours(endTime.getHours(), endTime.getMinutes(), 59, 999);
    
    query += ` AND transaction_date >= ? AND transaction_date <= ?`;
    params.push(startDateTime.toISOString(), endDateTime.toISOString());
  }
  
  query += ` ORDER BY transaction_date DESC`;
  
  const result = await database.getAllAsync<any>(query, params);
  
  return result.map(row => standaloneRowToEntry(row));
}

/**
 * Get entries with order information by date and optional time range
 * This includes order_id and customer name for display purposes
 * Performance note: Uses LEFT JOIN which may be slightly slower than basic queries
 */
export async function getEntriesWithOrderInfoByDateAndTimeRange(
  date: Date,
  startTime?: Date,
  endTime?: Date,
  confirmedOnly?: boolean
): Promise<Array<Entry & { customer?: string }>> {
  const database = getDatabase();
  
  // Use LEFT JOIN to include order information when available
  let query = `
    SELECT e.*, o.customer 
    FROM entries e
    LEFT JOIN orders o ON e.order_id = o.order_id
    WHERE date(e.transaction_date) = date(?)
    AND (e.txn_type IS NULL OR e.txn_type = '' OR e.txn_type = 'sale' OR e.txn_type = 'credit_paid')
  `;
  const params: any[] = [date.toISOString()];
  
  // Add confirmation filter if specified
  if (confirmedOnly !== undefined) {
    query += ` AND e.confirmed = ?`;
    params.push(confirmedOnly ? 1 : 0);
  }
  
  // Add time range filter if both start and end times are provided
  if (startTime && endTime) {
    // Create start and end datetime strings for the specific date
    const startDateTime = new Date(date);
    startDateTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    
    const endDateTime = new Date(date);
    endDateTime.setHours(endTime.getHours(), endTime.getMinutes(), 59, 999);
    
    query += ` AND e.transaction_date >= ? AND e.transaction_date <= ?`;
    params.push(startDateTime.toISOString(), endDateTime.toISOString());
  }
  
  query += ` ORDER BY e.transaction_date DESC`;
  
  const result = await database.getAllAsync<any>(query, params);
  
  return result.map(row => ({
    ...standaloneRowToEntry(row),
    customer: row.customer || undefined
  }));
}

/**
 * Discover new items in entries that don't exist in prices table
 * Returns items with their most recent price and metadata
 */
export async function discoverNewItems(
  daysBack: number = 30,
  maxItems: number = 50
): Promise<Array<{
  item: string;
  price: number;
  unit: string;
  last_sold_date: string;
  source_text: string;
  total_sales: number; // How many times this item was sold
}>> {
  const db = getDatabase();
  
  try {
    // Efficient query to find new items with performance optimizations
    const query = `
      WITH new_items AS (
        SELECT 
          TRIM(e.item) as item,
          e.price,
          e.unit,
          e.created_at,
          e.source_text,
          COUNT(*) OVER (PARTITION BY TRIM(e.item)) as total_sales,
          ROW_NUMBER() OVER (PARTITION BY TRIM(e.item) ORDER BY e.created_at DESC) as rn
        FROM entries e
        LEFT JOIN prices p ON LOWER(TRIM(e.item)) = LOWER(TRIM(p.item))
        WHERE p.item IS NULL
          AND e.created_at >= date('now', '-${daysBack} days')
          AND e.item IS NOT NULL 
          AND TRIM(e.item) != ''
          AND e.price > 0
          AND TRIM(e.item) NOT LIKE 'paid-%'
      )
      SELECT 
        item,
        price,
        unit,
        created_at as last_sold_date,
        source_text,
        total_sales
      FROM new_items 
      WHERE rn = 1 
      ORDER BY total_sales DESC, created_at DESC 
      LIMIT ?
    `;
    
    const result = await db.getAllAsync<any>(query, [maxItems]);
    
    return result.map(row => ({
      item: row.item,
      price: row.price,
      unit: row.unit || 'pcs',
      last_sold_date: row.last_sold_date,
      source_text: row.source_text || '',
      total_sales: row.total_sales
    }));
    
  } catch (error) {
    console.error('Error discovering new items:', error);
    throw error;
  }
}

/**
 * Batch insert new items into prices table
 */
export async function addNewItemsToPrices(
  items: Array<{
    item: string;
    price: number;
    source_comment?: string;
  }>
): Promise<number> {
  const db = getDatabase();
  
  try {
    await ensurePricesTableColumns(db);
    
    let insertedCount = 0;
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Use transaction for better performance
    await db.withTransactionAsync(async () => {
      for (const item of items) {
        const id = uuid.v4().toString();
        const createdAt = new Date().toISOString();
        
        await db.runAsync(`
          INSERT INTO prices (id, item, price, updated_at, created_at, last_update_comment)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          id,
          item.item.trim(),
          item.price,
          timestamp,
          createdAt,
          item.source_comment || 'Auto-discovered from sales'
        ]);
        
        insertedCount++;
      }
    });
    
    return insertedCount;
    
  } catch (error) {
    console.error('Error adding new items to prices:', error);
    throw error;
  }
}

/**
 * Orders functionality - Generate next order ID
 */
export async function generateNextOrderId(): Promise<string> {
  const db = getDatabase();
  
  try {
    // Get current date in DDMMYY format
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear().toString().slice(-2);
    const datePrefix = `${day}${month}${year}`;
    
    // Use timestamp + random to avoid race conditions
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    const random = Math.floor(Math.random() * 100).toString().padStart(2, '0'); // 2-digit random
    
    // Create unique ID: ORD-DDMMYY-TSTAMP-RND
    const orderId = `ORD-${datePrefix}-${timestamp}-${random}`;
    
    // Verify uniqueness (very unlikely to collide, but safety check)
    const existing = await db.getFirstAsync<{count: number}>(`
      SELECT COUNT(*) as count FROM orders WHERE order_id = ?
    `, [orderId]);
    
    if (existing && existing.count > 0) {
      // If somehow we have a collision, add another random component
      const extraRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      return `ORD-${datePrefix}-${timestamp}-${random}-${extraRandom}`;
    }
    
    return orderId;
  } catch (error) {
    console.error('Error generating next order ID:', error);
    throw error;
  }
}

/**
 * Create a new order
 */
export async function createOrder(
  customer: string = 'Walk-in',
  items: Array<{
    item: string;
    qty: number;
    price: number | null;
    delivery_date?: string | null;
  }>
): Promise<string> {
  const db = getDatabase();
  
  try {
    const orderId = await generateNextOrderId();
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.withTransactionAsync(async () => {
      // Create the order
      await db.runAsync(`
        INSERT INTO orders (order_id, customer, status, created_at, updated_at)
        VALUES (?, ?, 'open', ?, ?)
      `, [orderId, customer, timestamp, timestamp]);
      
      // Add order items
      for (const item of items) {
        await db.runAsync(`
          INSERT INTO order_items (order_id, item, qty, price, delivered, delivery_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        `, [orderId, item.item, item.qty, item.price, item.delivery_date || null, timestamp, timestamp]);
      }
    });
    
    return orderId;
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
}

/**
 * Get orders by date with optional status filter
 */
export async function getOrdersByDate(
  date: Date,
  status?: OrderStatus
): Promise<OrderWithItems[]> {
  const db = getDatabase();
  
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    
    let query = `
      SELECT * FROM orders 
      WHERE created_at >= ? AND created_at <= ?
    `;
    const params: any[] = [startTimestamp, endTimestamp];
    
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const orders = await db.getAllAsync<Order>(query, params);
    
    // Get items for each order
    const ordersWithItems: OrderWithItems[] = [];
    
    for (const order of orders) {
      const items = await db.getAllAsync<OrderItem>(`
        SELECT * FROM order_items 
        WHERE order_id = ? 
        ORDER BY created_at ASC
      `, [order.order_id]);
      
      // Calculate totals and latest delivery date
      let totalValue = 0;
      let deliveredValue = 0;
      let latestDeliveryDate: string | null = null;
      
      for (const item of items) {
        const itemTotal = (item.price || 0) * item.qty;
        totalValue += itemTotal;
        
        if (item.delivered) {
          deliveredValue += itemTotal;
        }
        
        if (item.delivery_date && (!latestDeliveryDate || item.delivery_date > latestDeliveryDate)) {
          latestDeliveryDate = item.delivery_date;
        }
      }
      
      ordersWithItems.push({
        ...order,
        items,
        total_value: totalValue,
        delivered_value: deliveredValue,
        latest_delivery_date: latestDeliveryDate
      });
    }
    
    return ordersWithItems;
  } catch (error) {
    console.error('Error getting orders by date:', error);
    throw error;
  }
}

/**
 * Get single order with items
 */
export async function getOrderById(orderId: string): Promise<OrderWithItems | null> {
  const db = getDatabase();
  
  try {
    const order = await db.getFirstAsync<Order>(`
      SELECT * FROM orders WHERE order_id = ?
    `, [orderId]);
    
    if (!order) {
      return null;
    }
    
    const items = await db.getAllAsync<OrderItem>(`
      SELECT * FROM order_items 
      WHERE order_id = ? 
      ORDER BY created_at ASC
    `, [orderId]);
    
    // Calculate totals and latest delivery date
    let totalValue = 0;
    let deliveredValue = 0;
    let latestDeliveryDate: string | null = null;
    
    for (const item of items) {
      const itemTotal = (item.price || 0) * item.qty;
      totalValue += itemTotal;
      
      if (item.delivered) {
        deliveredValue += itemTotal;
      }
      
      if (item.delivery_date && (!latestDeliveryDate || item.delivery_date > latestDeliveryDate)) {
        latestDeliveryDate = item.delivery_date;
      }
    }
    
    return {
      ...order,
      items,
      total_value: totalValue,
      delivered_value: deliveredValue,
      latest_delivery_date: latestDeliveryDate
    };
  } catch (error) {
    console.error('Error getting order by ID:', error);
    throw error;
  }
}

/**
 * Update order item delivery status
 */
export async function updateOrderItemDelivery(
  itemId: number,
  delivered: boolean,
  deliveryDate?: string | null
): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.runAsync(`
      UPDATE order_items 
      SET delivered = ?, delivery_date = ?, updated_at = ?
      WHERE id = ?
    `, [delivered ? 1 : 0, deliveryDate || null, timestamp, itemId]);
    
    // Update order status based on delivery status of all items
    const item = await db.getFirstAsync<{order_id: string}>(`
      SELECT order_id FROM order_items WHERE id = ?
    `, [itemId]);
    
    if (item) {
      await updateOrderStatus(item.order_id);
    }
  } catch (error) {
    console.error('Error updating order item delivery:', error);
    throw error;
  }
}

/**
 * Update order status based on item delivery status
 */
export async function updateOrderStatus(orderId: string): Promise<void> {
  const db = getDatabase();
  
  try {
    const stats = await db.getFirstAsync<{total: number, delivered: number}>(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN delivered = 1 THEN 1 ELSE 0 END) as delivered
      FROM order_items 
      WHERE order_id = ?
    `, [orderId]);
    
    let newStatus: OrderStatus = 'open';
    
    if (stats) {
      if (stats.delivered === 0) {
        newStatus = 'open';
      } else if (stats.delivered === stats.total) {
        newStatus = 'delivered';
      } else {
        newStatus = 'partial';
      }
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.runAsync(`
      UPDATE orders 
      SET status = ?, updated_at = ?
      WHERE order_id = ?
    `, [newStatus, timestamp, orderId]);
  } catch (error) {
    console.error('Error updating order status:', error);
    throw error;
  }
}

/**
 * Update order item details
 */
export async function updateOrderItem(
  itemId: number,
  updates: {
    item?: string;
    qty?: number;
    price?: number | null;
    delivery_date?: string | null;
  }
): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    const setClause = [];
    const params = [];
    
    if (updates.item !== undefined) {
      setClause.push('item = ?');
      params.push(updates.item);
    }
    
    if (updates.qty !== undefined) {
      setClause.push('qty = ?');
      params.push(updates.qty);
    }
    
    if (updates.price !== undefined) {
      setClause.push('price = ?');
      params.push(updates.price);
    }
    
    if (updates.delivery_date !== undefined) {
      setClause.push('delivery_date = ?');
      params.push(updates.delivery_date);
    }
    
    setClause.push('updated_at = ?');
    params.push(timestamp, itemId);
    
    await db.runAsync(`
      UPDATE order_items 
      SET ${setClause.join(', ')}
      WHERE id = ?
    `, params);

    // Get the order_id to update order timestamp
    const item = await db.getFirstAsync<{order_id: string}>(`
      SELECT order_id FROM order_items WHERE id = ?
    `, [itemId]);
    
    if (item) {
      // Update order timestamp
      await db.runAsync(`
        UPDATE orders SET updated_at = ? WHERE order_id = ?
      `, [timestamp, item.order_id]);
    }
  } catch (error) {
    console.error('Error updating order item:', error);
    throw error;
  }
}

/**
 * Add new item to existing order
 */
export async function addOrderItem(
  orderId: string,
  item: string,
  qty: number,
  price: number | null,
  deliveryDate?: string | null
): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.runAsync(`
      INSERT INTO order_items (order_id, item, qty, price, delivered, delivery_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `, [orderId, item, qty, price, deliveryDate || null, timestamp, timestamp]);
    
    // Update order timestamp
    await db.runAsync(`
      UPDATE orders SET updated_at = ? WHERE order_id = ?
    `, [timestamp, orderId]);
  } catch (error) {
    console.error('Error adding order item:', error);
    throw error;
  }
}

/**
 * Update order customer name
 */
export async function updateOrderCustomer(
  orderId: string,
  customer: string
): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.runAsync(`
      UPDATE orders 
      SET customer = ?, updated_at = ?
      WHERE order_id = ?
    `, [customer, timestamp, orderId]);
  } catch (error) {
    console.error('Error updating order customer:', error);
    throw error;
  }
}

/**
 * Mark entire order as delivered (all undelivered items)
 */
export async function deliverEntireOrder(
  orderId: string,
  deliveryDate?: string | null
): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const finalDeliveryDate = deliveryDate || new Date().toISOString().split('T')[0];
    
    await db.withTransactionAsync(async () => {
      // Mark all undelivered items as delivered
      await db.runAsync(`        UPDATE order_items 
        SET delivered = 1, delivery_date = ?, updated_at = ?
        WHERE order_id = ? AND delivered = 0
      `, [finalDeliveryDate, timestamp, orderId]);
      
      // Update order status to delivered
      await db.runAsync(`
        UPDATE orders 
        SET status = 'delivered', updated_at = ?
        WHERE order_id = ?
      `, [timestamp, orderId]);
    });
  } catch (error) {
    console.error('Error delivering entire order:', error);
    throw error;
  }
}

/**
 * Delete order item
 */
export async function deleteOrderItem(itemId: number): Promise<void> {
  const db = getDatabase();
  
  try {
    // Get order_id before deleting
    const item = await db.getFirstAsync<{order_id: string}>(`
      SELECT order_id FROM order_items WHERE id = ?
    `, [itemId]);
    
    await db.runAsync(`
      DELETE FROM order_items WHERE id = ?
    `, [itemId]);
    
    if (item) {
      // Update order timestamp
      const timestamp = Math.floor(Date.now() / 1000);
      await db.runAsync(`
        UPDATE orders SET updated_at = ? WHERE order_id = ?
      `, [timestamp, item.order_id]);
      
      await updateOrderStatus(item.order_id);
    }
  } catch (error) {
    console.error('Error deleting order item:', error);
    throw error;
  }
}

/**
 * Cancel entire order
 */
export async function cancelOrder(orderId: string): Promise<void> {
  const db = getDatabase();
  
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    
    await db.withTransactionAsync(async () => {
      // Update order status
      await db.runAsync(`
        UPDATE orders 
        SET status = 'cancelled', updated_at = ?
        WHERE order_id = ?
      `, [timestamp, orderId]);
      
      // Mark all items as not delivered
      await db.runAsync(`
        UPDATE order_items 
        SET delivered = 0, updated_at = ?
        WHERE order_id = ?
      `, [timestamp, orderId]);
      
      // Delete related cash entries if they exist
      await db.runAsync(`
        DELETE FROM entries WHERE order_id = ?
      `, [orderId]);
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    throw error;
  }
}

/**
 * Delete entire order and all related data
 */
export async function deleteOrder(orderId: string): Promise<void> {
  const db = getDatabase();
  
  try {
    await db.withTransactionAsync(async () => {
      // Delete related cash entries
      await db.runAsync(`
        DELETE FROM entries WHERE order_id = ?
      `, [orderId]);
      
      // Delete order items
      await db.runAsync(`
        DELETE FROM order_items WHERE order_id = ?
      `, [orderId]);
      
      // Delete order
      await db.runAsync(`
        DELETE FROM orders WHERE order_id = ?
      `, [orderId]);
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    throw error;
  }
}

/**
 * Search orders by customer name or order ID
 */
export async function searchOrders(
  query: string,
  limit: number = 50
): Promise<OrderWithItems[]> {
  const db = getDatabase();
  
  try {
    const orders = await db.getAllAsync<Order>(`
      SELECT * FROM orders 
      WHERE LOWER(customer) LIKE LOWER(?) 
         OR LOWER(order_id) LIKE LOWER(?)
      ORDER BY created_at DESC
      LIMIT ?
    `, [`%${query}%`, `%${query}%`, limit]);
    
    // Get items for each order (simplified for search results)
    const ordersWithItems: OrderWithItems[] = [];
    
    for (const order of orders) {
      const items = await db.getAllAsync<OrderItem>(`
        SELECT * FROM order_items 
        WHERE order_id = ? 
        ORDER BY created_at ASC
      `, [order.order_id]);
      
      // Calculate totals
      let totalValue = 0;
      let deliveredValue = 0;
      let latestDeliveryDate: string | null = null;
      
      for (const item of items) {
        const itemTotal = (item.price || 0) * item.qty;
        totalValue += itemTotal;
        
        if (item.delivered) {
          deliveredValue += itemTotal;
        }
        
        if (item.delivery_date && (!latestDeliveryDate || item.delivery_date > latestDeliveryDate)) {
          latestDeliveryDate = item.delivery_date;
        }
      }
      
      ordersWithItems.push({
        ...order,
        items,
        total_value: totalValue,
        delivered_value: deliveredValue,
        latest_delivery_date: latestDeliveryDate
      });
    }
    
    return ordersWithItems;
  } catch (error) {
    console.error('Error searching orders:', error);
    throw error;
  }
}

/**
 * Create cash entry from order item delivery (if auto-cash setting is enabled)
 */
export async function createCashEntryFromOrderDelivery(
  orderItem: OrderItem,
  order: Order,
  autoCreateCash: boolean
): Promise<string | null> {
  if (!autoCreateCash || !orderItem.price || orderItem.price <= 0) {
    return null;
  }
  
  const db = getDatabase();
  
  try {
    const entryId = uuid.v4().toString();
    const now = new Date().toISOString();
    const total = orderItem.price * orderItem.qty;
    
    await db.runAsync(`
      INSERT INTO entries (
        id, item, qty, unit, price, total, type, 
        created_at, transaction_date, source_text, 
        is_final, user_id, version, confirmed, 
        batch_id, order_id, customer, txn_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entryId,
      orderItem.item,
      orderItem.qty,
      'pcs', // Default unit
      orderItem.price,
      total,
      'cash-in', // Delivery = cash in (receiving money from customer)
      now,
      now,
      `Delivered from order ${order.order_id} for ${order.customer}`,
      1, // is_final = true
      'default-user',
      1, // version
      1, // confirmed = true
      null, // no batch_id
      order.order_id,
      order.customer || '',
      'sale' // Default txn_type for order-generated entries
    ]);
    
    return entryId;
    
  } catch (error) {
    console.error('Error creating cash entry from order delivery:', error);
    throw error;
  }
} 

// ===== CREDIT FUNCTIONALITY =====

/**
 * Get customer balance (total credits - total payments)
 */
export async function getCustomerBalance(customerName: string): Promise<number> {
  const db = getDatabase();
  
  try {
    const result = await db.getFirstAsync<{balance: number}>(`
      SELECT 
        COALESCE(SUM(CASE WHEN txn_type = 'credit' THEN total ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN txn_type = 'credit_paid' THEN total ELSE 0 END), 0) as balance
      FROM entries 
      WHERE customer = ? AND txn_type IN ('credit', 'credit_paid')
    `, [customerName]);
    
    return result?.balance || 0;
  } catch (error) {
    console.error('Error getting customer balance:', error);
    return 0;
  }
}

/**
 * Get all customers with outstanding balances
 */
export async function getAllCustomersWithBalances(): Promise<import('../state/types').CustomerBalance[]> {
  const db = getDatabase();
  
  try {
    const customers = await db.getAllAsync<{
      customer: string;
      total_credits: number;
      total_payments: number;
      balance: number;
      last_payment_date: string | null;
      oldest_unpaid_date: string | null;
    }>(`
      SELECT 
        customer,
        COALESCE(SUM(CASE WHEN txn_type = 'credit' THEN total ELSE 0 END), 0) as total_credits,
        COALESCE(SUM(CASE WHEN txn_type = 'credit_paid' THEN total ELSE 0 END), 0) as total_payments,
        COALESCE(SUM(CASE WHEN txn_type = 'credit' THEN total ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN txn_type = 'credit_paid' THEN total ELSE 0 END), 0) as balance,
        MAX(CASE WHEN txn_type = 'credit_paid' THEN transaction_date ELSE NULL END) as last_payment_date,
        MIN(CASE WHEN txn_type = 'credit' THEN transaction_date ELSE NULL END) as oldest_unpaid_date
      FROM entries 
      WHERE customer IS NOT NULL AND customer != '' AND txn_type IN ('credit', 'credit_paid')
      GROUP BY customer
      ORDER BY balance DESC
    `);
    
    // Calculate aging for each customer
    const customerBalances: import('../state/types').CustomerBalance[] = [];
    
    for (const customer of customers) {
      const aging = await calculateCustomerAging(customer.customer);
      
      customerBalances.push({
        name: customer.customer,
        totalOutstanding: customer.balance,
        totalCredits: customer.total_credits,
        totalPayments: customer.total_payments,
        aging,
        lastPaymentDate: customer.last_payment_date || undefined,
        oldestUnpaidDate: customer.oldest_unpaid_date || undefined
      });
    }
    
    return customerBalances;
  } catch (error) {
    console.error('Error getting customers with balances:', error);
    return [];
  }
}

/**
 * Calculate aging buckets for a customer (30, 60, 90+ days)
 */
export async function calculateCustomerAging(customerName: string): Promise<{
  current: number;
  days30: number;
  days60: number;
  days90Plus: number;
}> {
  const db = getDatabase();
  
  try {
    // Get all credit sales sorted by date (FIFO for payment allocation)
    const creditSales = await db.getAllAsync<{
      total: number;
      transaction_date: string;
    }>(`
      SELECT total, transaction_date
      FROM entries
      WHERE customer = ? AND txn_type = 'credit'
      ORDER BY transaction_date ASC
    `, [customerName]);
    
    // Get total payments
    const paymentsResult = await db.getFirstAsync<{total_payments: number}>(`
      SELECT COALESCE(SUM(total), 0) as total_payments
      FROM entries
      WHERE customer = ? AND txn_type = 'credit_paid'
    `, [customerName]);
    
    let remainingPayments = paymentsResult?.total_payments || 0;
    const aging = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
    const now = new Date();
    
    // Apply FIFO payment allocation and calculate aging
    for (const sale of creditSales) {
      if (remainingPayments >= sale.total) {
        remainingPayments -= sale.total; // Fully paid
      } else {
        const unpaidAmount = sale.total - remainingPayments;
        remainingPayments = 0;
        
        const saleDate = new Date(sale.transaction_date);
        const daysDiff = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 30) {
          aging.current += unpaidAmount;
        } else if (daysDiff <= 60) {
          aging.days30 += unpaidAmount;
        } else if (daysDiff <= 90) {
          aging.days60 += unpaidAmount;
        } else {
          aging.days90Plus += unpaidAmount;
        }
      }
    }
    
    return aging;
  } catch (error) {
    console.error('Error calculating customer aging:', error);
    return { current: 0, days30: 0, days60: 0, days90Plus: 0 };
  }
}

/**
 * Get all credit entries for a specific customer
 */
export async function getCustomerCreditHistory(customerName: string): Promise<Entry[]> {
  const db = getDatabase();
  
  try {
    const result = await db.getAllAsync<any>(`
      SELECT * FROM entries 
      WHERE customer = ? AND txn_type IN ('credit', 'credit_paid')
      ORDER BY transaction_date DESC, created_at DESC
    `, [customerName]);
    
    return result.map(row => standaloneRowToEntry(row));
  } catch (error) {
    console.error('Error getting customer credit history:', error);
    return [];
  }
}

/**
 * Get all credit transactions (both sales and payments) across all customers
 */
export async function getAllCreditTransactions(limit?: number): Promise<Entry[]> {
  const db = getDatabase();
  
  try {
    let query = `
      SELECT * FROM entries 
      WHERE txn_type IN ('credit', 'credit_paid')
      ORDER BY transaction_date DESC, created_at DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    const result = await db.getAllAsync<any>(query);
    
    return result.map(row => standaloneRowToEntry(row));
  } catch (error) {
    console.error('Error getting all credit transactions:', error);
    return [];
  }
}

/**
 * Get individual credit transactions for a specific date (excluding those that form batches)
 * This includes:
 * 1. Transactions without batch_id
 * 2. Transactions with batch_id but are alone on that specific date
 */
export async function getIndividualCreditTransactions(
  date: Date,
  customer?: string
): Promise<Entry[]> {
  const db = getDatabase();
  
  try {
    let query = `
      WITH batch_counts AS (
        SELECT 
          batch_id,
          DATE(transaction_date) as trans_date,
          COUNT(*) as count_per_date
        FROM entries 
        WHERE txn_type = 'credit'
          AND batch_id IS NOT NULL 
          AND batch_id != ''
          AND DATE(transaction_date) = DATE(?)
        GROUP BY batch_id, DATE(transaction_date)
      )
      SELECT e.* FROM entries e
      WHERE e.txn_type = 'credit'
        AND DATE(e.transaction_date) = DATE(?)
        AND (
          e.batch_id IS NULL 
          OR e.batch_id = ''
          OR (
            e.batch_id IS NOT NULL 
            AND e.batch_id != ''
            AND EXISTS (
              SELECT 1 FROM batch_counts bc 
              WHERE bc.batch_id = e.batch_id 
                AND bc.trans_date = DATE(e.transaction_date)
                AND bc.count_per_date = 1
            )
          )
        )
    `;
    
    const params: any[] = [date.toISOString(), date.toISOString()];
    
    if (customer) {
      query += ` AND e.customer = ?`;
      params.push(customer);
    }
    
    query += ` ORDER BY e.transaction_date DESC, e.created_at DESC`;
    
    const result = await db.getAllAsync<any>(query, params);
    
    return result.map(row => standaloneRowToEntry(row));
  } catch (error) {
    console.error('Error getting individual credit transactions:', error);
    return [];
  }
}

/**
 * Delete a credit transaction by ID
 */
export async function deleteCreditTransaction(entryId: string): Promise<boolean> {
  const db = getDatabase();
  
  try {
    const result = await db.runAsync(`
      DELETE FROM entries 
      WHERE id = ? AND txn_type IN ('credit', 'credit_paid')
    `, [entryId]);
    
    return result.changes > 0;
  } catch (error) {
    console.error('Error deleting credit transaction:', error);
    throw error;
  }
}

/**
 * Get unique customer names for autocomplete
 */
export async function getUniqueCustomers(): Promise<string[]> {
  const db = getDatabase();
  
  try {
    const result = await db.getAllAsync<{customer: string}>(`
      SELECT DISTINCT customer
      FROM entries 
      WHERE customer IS NOT NULL AND customer != ''
      ORDER BY customer ASC
    `);
    
    return result.map(row => row.customer);
  } catch (error) {
    console.error('Error getting unique customers:', error);
    return [];
  }
}

/**
 * Create a credit sale entry with enhanced validation and error handling
 */
export async function createCreditSale(
  customerName: string,
  item: string,
  qty: number,
  unit: string,
  price: number,
  sourceText: string = '',
  transactionDate?: string // Add optional transaction_date parameter
): Promise<string> {
  const db = getDatabase();
  
  // Enhanced validation
  if (!customerName?.trim()) {
    throw new Error('Customer name is required for credit sales');
  }
  
  if (!item?.trim()) {
    throw new Error('Item name is required for credit sales');
  }
  
  if (!qty || qty <= 0) {
    throw new Error('Quantity must be greater than 0');
  }
  
  if (price < 0) {
    throw new Error('Price cannot be negative');
  }
  
  try {
    const entryId = uuid.v4().toString();
    const now = new Date().toISOString();
    const transactionDateTime = transactionDate || now; // Use provided date or current time
    const total = qty * price;
    
    // Normalize customer name for consistency
    const normalizedCustomerName = customerName.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    // Normalize item name
    const normalizedItemName = item.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    await db.runAsync(
      `INSERT INTO entries (
        id, item, qty, unit, price, total, type, 
        transaction_date, source_text, created_at, is_final, 
        user_id, version, confirmed, customer, txn_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
      entryId,
        normalizedItemName,
      qty,
        unit || '',
      price,
      total,
        'cash-in', // Credit sales increase balance (asset)
        transactionDateTime, // Use the provided or current transaction_date
      sourceText,
        now, // created_at always uses current time
        true,
      'default-user',
        1,
        true,
        normalizedCustomerName,
      'credit'
      ]
    );
    
    return entryId;
  } catch (error) {
    console.error('❌ Error creating credit sale:', error);
    
    // Provide more specific error messages based on the error type
    if (error instanceof Error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('A transaction with this ID already exists. Please try again.');
      } else if (error.message.includes('NOT NULL constraint failed')) {
        throw new Error('Required transaction data is missing. Please check all fields.');
      } else if (error.message.includes('database')) {
        throw new Error('Database error occurred. Please try again or restart the app.');
      }
    }
    
    throw new Error(`Failed to create credit sale: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a credit payment entry with enhanced validation and error handling
 */
export async function createCreditPayment(
  customerName: string,
  amount: number,
  sourceText: string = '',
  transactionDate?: string // Add optional transaction_date parameter
): Promise<string> {
  const db = getDatabase();
  
  // Enhanced validation
  if (!customerName?.trim()) {
    throw new Error('Customer name is required for credit payments');
  }
  
  if (!amount || amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }
  
  // Reasonable limits for payment amounts (adjust as needed)
  if (amount > 1000000) {
    throw new Error('Payment amount seems unusually large. Please verify the amount.');
  }
  
  try {
    const entryId = uuid.v4().toString();
    const now = new Date().toISOString();
    const transactionDateTime = transactionDate || now; // Use provided date or current time
    
    // Normalize customer name for consistency
    const normalizedCustomerName = customerName.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    // Create proper item name format: paid-customer-ddmmyy
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = String(today.getFullYear()).slice(-2);
    const dateString = `${day}${month}${year}`;
    const itemName = `paid-${normalizedCustomerName.toLowerCase().replace(/\s+/g, '')}-${dateString}`;
    
    await db.runAsync(
      `INSERT INTO entries (
        id, item, qty, unit, price, total, type, 
        transaction_date, source_text, created_at, is_final, 
        user_id, version, confirmed, customer, txn_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
      entryId,
        itemName,
        1,
        'payment',
        amount,
        amount,
        'cash-in', // Credit payments are cash inflow
        transactionDateTime, // Use the provided or current transaction_date
      sourceText,
        now, // created_at always uses current time
        true,
      'default-user',
        1,
        true,
        normalizedCustomerName,
      'credit_paid'
      ]
    );
    
    return entryId;
  } catch (error) {
    console.error('❌ Error creating credit payment:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('A payment with this ID already exists. Please try again.');
      } else if (error.message.includes('NOT NULL constraint failed')) {
        throw new Error('Required payment data is missing. Please check all fields.');
      } else if (error.message.includes('database')) {
        throw new Error('Database error occurred. Please try again or restart the app.');
      }
    }
    
    throw new Error(`Failed to create credit payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a batch of credit sale entries with enhanced validation and transaction safety
 */
export async function createCreditSaleBatch(
  customerName: string,
  items: Array<{
    item: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
  }>,
  sourceText: string = ''
): Promise<string> {
  const db = getDatabase();
  
  // Enhanced validation
  if (!customerName?.trim()) {
    throw new Error('Customer name is required for credit sales batch');
  }
  
  if (!items || items.length === 0) {
    throw new Error('At least one item is required for credit sales batch');
  }
  
  // Validate each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    if (!item.item?.trim()) {
      throw new Error(`Item name is required for item ${i + 1}`);
    }
    
    if (!item.qty || item.qty <= 0) {
      throw new Error(`Quantity must be greater than 0 for item ${i + 1}: ${item.item}`);
    }
    
    if (item.price < 0) {
      throw new Error(`Price cannot be negative for item ${i + 1}: ${item.item}`);
    }
    
    // Validate that total matches qty * price (with small tolerance for floating point errors)
    const expectedTotal = item.qty * item.price;
    if (Math.abs(item.total - expectedTotal) > 0.01) {
      console.warn(`Total mismatch for ${item.item}: expected ${expectedTotal}, got ${item.total}. Correcting...`);
      item.total = expectedTotal; // Auto-correct the total
    }
  }
  
  const batchId = uuid.v4().toString();
  const now = new Date().toISOString();
  
  // Normalize customer name for consistency
  const normalizedCustomerName = customerName.trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  try {
    // Use a transaction for atomic operation
    await db.withTransactionAsync(async () => {
      for (const item of items) {
        const entryId = uuid.v4().toString();
        
        // Normalize item name
        const normalizedItemName = item.item.trim()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        
        await db.runAsync(
          `INSERT INTO entries (
            id, item, qty, unit, price, total, type, 
            transaction_date, source_text, created_at, is_final, 
            user_id, version, confirmed, customer, txn_type, batch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entryId,
            normalizedItemName,
            item.qty,
            item.unit || '',
            item.price,
            item.total,
            'cash-in', // Credit sales increase balance (asset)
            now,
            sourceText,
            now,
            true,
            'default-user',
            1,
            true,
            normalizedCustomerName,
            'credit',
            batchId
          ]
        );
      }
    });
    
    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
    
    return batchId;
    
  } catch (error) {
    console.error('❌ Error creating credit sales batch:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('A transaction with this ID already exists. Please try again.');
      } else if (error.message.includes('NOT NULL constraint failed')) {
        throw new Error('Required transaction data is missing. Please check all fields.');
      } else if (error.message.includes('database')) {
        throw new Error('Database error occurred. Please try again or restart the app.');
      }
    }
    
    throw new Error(`Failed to create credit sales batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get credit batches for display (grouped multi-item transactions by batch_id AND date)
 * Items with same batch_id but different dates will be grouped separately per date
 * Only shows as batch if 2+ items exist with same batch_id on the same date
 */
export async function getCreditBatches(
  startDate?: Date,
  endDate?: Date,
  customer?: string
): Promise<Array<{
  batch_id: string;
  customer: string;
  total_amount: number;
  item_count: number;
  transaction_date: string;
  source_text: string;
}>> {
  const db = getDatabase();
  
  try {
    let query = `
      SELECT 
        batch_id,
        customer,
        SUM(total) as total_amount,
        COUNT(*) as item_count,
        MAX(transaction_date) as transaction_date,
        MAX(source_text) as source_text
      FROM entries 
      WHERE txn_type = 'credit' 
        AND batch_id IS NOT NULL 
        AND batch_id != ''
    `;
    
    const params: any[] = [];
    
    if (startDate) {
      query += ` AND date(transaction_date) >= date(?)`;
      params.push(startDate.toISOString());
    }
    
    if (endDate) {
      query += ` AND date(transaction_date) <= date(?)`;
      params.push(endDate.toISOString());
    }
    
    if (customer) {
      query += ` AND customer = ?`;
      params.push(customer);
    }
    
    query += `
      GROUP BY batch_id, customer, DATE(transaction_date)
      HAVING COUNT(*) > 1
      ORDER BY transaction_date DESC, batch_id DESC
    `;
    
    const result = await db.getAllAsync<any>(query, params);
    
    return result.map(row => ({
      batch_id: row.batch_id,
      customer: row.customer || '',
      total_amount: row.total_amount || 0,
      item_count: row.item_count || 0,
      transaction_date: row.transaction_date,
      source_text: row.source_text || ''
    }));
  } catch (error) {
    console.error('Error getting credit batches:', error);
    return [];
  }
}

/**
 * Get total credit balance (outstanding - paid)
 */
export async function getTotalCreditBalance(): Promise<number> {
  try {
    const db = getDatabase();
    
    // Get total credit sales amount
    const creditSalesResult = await db.getFirstAsync<{total_credit: number}>(
      `SELECT COALESCE(SUM(total), 0) as total_credit 
       FROM entries 
       WHERE txn_type = 'credit'`
    );
    const totalCredit = creditSalesResult?.total_credit || 0;
    
    // Get total credit payments amount
    const creditPaymentsResult = await db.getFirstAsync<{total_paid: number}>(
      `SELECT COALESCE(SUM(total), 0) as total_paid 
       FROM entries 
       WHERE txn_type = 'credit_paid'`
    );
    const totalPaid = creditPaymentsResult?.total_paid || 0;
    
    // Net outstanding = credit sales - credit payments
    return totalCredit - totalPaid;
  } catch (error) {
    console.error('Error calculating total credit balance:', error);
    throw error;
  }
}

/**
 * Update customer name for all transactions in a batch
 */
export async function updateBatchCustomer(
  batchId: string,
  newCustomerName: string
): Promise<void> {
  const db = getDatabase();
  
  if (!batchId?.trim()) {
    throw new Error('Batch ID is required');
  }
  
  if (!newCustomerName?.trim()) {
    throw new Error('Customer name is required');
  }
  
  // Normalize customer name for consistency
  const normalizedCustomerName = newCustomerName.trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  try {
    // Update all entries with the given batch_id
    const result = await db.runAsync(
      `UPDATE entries 
       SET customer = ? 
       WHERE batch_id = ? AND txn_type = 'credit'`,
      [normalizedCustomerName, batchId]
    );
    
    if (result.changes === 0) {
      throw new Error('No transactions found for this batch ID');
    }   
    
    
  } catch (error) {
    console.error('❌ Error updating batch customer:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('No transactions found')) {
        throw error;
      } else if (error.message.includes('database')) {
        throw new Error('Database error occurred. Please try again or restart the app.');
      }
    }
    
    throw new Error(`Failed to update batch customer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get all credit transactions (credit + credit_paid) within a date range - OPTIMIZED
 */
export async function getCreditTransactionsByDateRange(
  startDate: Date,
  endDate: Date,
  limit?: number
): Promise<Entry[]> {
  const db = getDatabase();
  
  try {
    // Format dates for SQL comparison
    const startDateTime = new Date(startDate);
    startDateTime.setHours(0, 0, 0, 0);
    
    const endDateTime = new Date(endDate);  
    endDateTime.setHours(23, 59, 59, 999);
    
    let query = `
      SELECT * FROM entries 
      WHERE txn_type IN ('credit', 'credit_paid')
        AND transaction_date >= ?
        AND transaction_date <= ?
      ORDER BY transaction_date DESC, created_at DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    const result = await db.getAllAsync<any>(query, [
      startDateTime.toISOString(),
      endDateTime.toISOString()
    ]);
    
    return result.map(row => standaloneRowToEntry(row));
  } catch (error) {
    console.error('Error getting credit transactions by date range:', error);
    return [];
  }
}
