import { Entry } from '../state/types';
import { createSqliteStorage } from './sqliteStorage';
import { Platform } from 'react-native';

/**
 * Storage interface for saving and retrieving entries.
 * This abstraction allows us to swap implementations if needed in the future.
 */
export interface StorageInterface {
  /**
   * Save a new entry to storage
   * @param entry The entry to save
   * @returns A promise resolving to the saved entry with ID
   */
  saveEntry: (entry: Partial<Entry>) => Promise<Entry>;
  
  /**
   * Save multiple entries to storage in a batch (optimized for performance)
   * @param entries The entries to save
   * @returns A promise resolving to the saved entries with IDs
   */
  saveEntriesBatch: (entries: Partial<Entry>[]) => Promise<Entry[]>;
  
  /**
   * Get entries for a specific date
   * @param date The date to retrieve entries for (defaults to today)
   * @returns A promise resolving to an array of entries
   */
  getEntriesByDate: (date?: Date) => Promise<Entry[]>;
  
  /**
   * Get all entries from today
   * @returns A promise resolving to an array of today's entries
   */
  getTodaysEntries: () => Promise<Entry[]>;
  
  /**
   * Get all entries from storage
   * @returns A promise resolving to an array of all entries
   */
  getAllEntries: () => Promise<Entry[]>;
  
  /**
   * Update an existing entry
   * @param id The ID of the entry to update
   * @param updates The updated fields
   * @returns A promise resolving to the updated entry
   */
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<Entry>;
  
  /**
   * Delete an entry
   * @param id The ID of the entry to delete
   * @returns A promise resolving to true if successful
   */
  deleteEntry: (id: string) => Promise<boolean>;
  
  /**
   * Search entries by text query
   * @param query The search query
   * @returns A promise resolving to matching entries
   */
  searchEntries: (query: string) => Promise<Entry[]>;
  
  /**
   * Get total cash flow by type (cash-in or cash-out)
   * @param type The transaction type
   * @param date Optional date to restrict totals to
   * @returns A promise resolving to the total amount
   */
  getTotalByType: (type: 'cash-in' | 'cash-out', date?: Date) => Promise<number>;
  
  /**
   * Mark entries as final (end of day confirmation)
   * @param ids The IDs of entries to mark as final
   * @returns A promise resolving to true if successful
   */
  markEntriesAsFinal: (ids: string[]) => Promise<boolean>;
  
  /**
   * Initialize storage (create tables, etc.)
   * @returns A promise resolving when initialization is complete
   */
  initialize: () => Promise<void>;

  /**
   * Get deliveries by date with order information
   * @param date The date to retrieve deliveries for
   * @returns A promise resolving to an array of delivery data
   */
  getDeliveriesByDate: (date: Date) => Promise<Array<{
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
  }>>;
}

// Storage instance cache
let storageInstance: StorageInterface | null = null;

/**
 * Get the appropriate storage implementation
 */
export async function getStorage(): Promise<StorageInterface> {
  if (storageInstance) {
    return storageInstance;
  }
  
  // Create SQLite storage
  storageInstance = createSqliteStorage();
  
  try {
    // Initialize the storage (create tables, etc.)
    await storageInstance.initialize();
  } catch (error) {
    console.error('Error initializing storage:', error);
    throw error;
  }
  
  return storageInstance;
} 