import { Entry } from '../state/types';
import { lookupPrice } from './sqliteStorage';

// Type for parsed entry (subset of Entry)
export type ParsedEntry = Partial<Entry>;

// Extended result type for parsing that can handle both transactions and orders
export interface ParsedResult {
  type: 'transaction' | 'order' | 'price' | 'credit';
  entry?: Partial<Entry>;
  order?: {
    customer?: string;
    items: Array<{
      item: string;
      qty: number;
      price?: number | null;
      delivery_date?: string | null;
    }>;
  };
  priceUpdates?: Array<{
    item: string;
    price: number;
  }>;
  credit?: {
    type: 'sale' | 'payment';
    customer: string;
    amount?: number;
    item?: string;
    qty?: number;
    unit?: string;
    price?: number;
    items?: Array<{
      item: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
    }>;
  };
  warnings: string[];
  source_text: string;
}

// Custom error class for parsing errors
export class ParsingError extends Error {
  public code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ParsingError';
    this.code = code;
  }
}

// Common units used in transactions
const KNOWN_UNITS = [
  'kg', 'g', 'gram', 'grams', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'l', 'liter', 'liters', 'litre', 'litres', 'ml', 'milliliter', 'milliliters',
  'packet', 'packets', 'pack', 'packs', 'box', 'boxes', 'item', 'items',
  'dozen', 'dozens', 'piece', 'pieces', 'pc', 'pcs',
  'bottle', 'bottles', 'btl', 'can', 'cans',
  'bag', 'bags', 'sack', 'sacks'
];

// Common transaction types and their corresponding words
const TRANSACTION_TYPES = {
  'cash-in': ['sold', 'sell', 'sale', 'purchase', 'bought', 'buy'],
  'cash-out': ['bought', 'buy', 'purchased', 'expense', 'spent']
};

// Order-related keywords
const ORDER_KEYWORDS = [
  'order', 'orders', 'ordered', 'ordering',
  'deliver', 'delivery', 'delivers', 'delivering',
  'book', 'booking', 'booked', 'books',
  'reserve', 'reservation', 'reserved', 'reserves'
];

// Special case items that need custom handling
const SPECIAL_CASE_ITEMS: Record<string, string> = {
  'parle g': 'Parle G',
  'parle-g': 'Parle G',
  'maggi': 'Maggi',
  'lays': 'Lays',
  'amul': 'Amul',
  'tata': 'Tata',
  'britannia': 'Britannia',
  'nuti g': 'Nuti G'
};

// Validate entry data
export const validateEntry = (entry: Partial<Entry>): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!entry.item || entry.item.trim() === '') {
    errors.push('Item name is required');
  }
  
  if (entry.qty === undefined || entry.qty <= 0) {
    errors.push('Quantity must be a positive number');
  }
  
  if (entry.price !== undefined && entry.price < 0) {
    errors.push('Price cannot be negative');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Normalizes a unit string to a standard format
 * Example: "packets" becomes "packet"
 */
export const normalizeUnit = (unit: string): string => {
  unit = unit.toLowerCase().trim();
  
  // Handle special cases
  if (['kgs', 'kilos', 'kilograms'].includes(unit)) return 'kg';
  if (['grams', 'gram', 'gm', 'gms'].includes(unit)) return 'g';
  if (['litres', 'litre', 'ltr', 'ltrs', 'liters', 'liter'].includes(unit)) return 'l';
  if (['milliliters', 'milliliter', 'mls'].includes(unit)) return 'ml';
  if (['pcs', 'pieces', 'piece', 'pc'].includes(unit)) return 'piece';
  if (['packets', 'pack', 'packs'].includes(unit)) return 'packet';
  if (['bottles', 'btl', 'btls'].includes(unit)) return 'bottle';
  if (['dozens'].includes(unit)) return 'dozen';
  
  // If it's already singular or not recognized, return as is
  return unit;
};

/**
 * Detects if the text is about creating an order rather than a transaction
 */
export const isOrderCommand = (text: string): boolean => {
  if (!text) {
    return false;
  }
  
  const lowerText = text.toLowerCase();
  
  // Check for order keywords
  return ORDER_KEYWORDS.some(keyword => lowerText.includes(keyword));
};

/**
 * Detects if the text is about credit transactions
 */
export const isCreditCommand = (text: string): boolean => {
  if (!text) {
    return false;
  }
  
  const lowerText = text.toLowerCase();
  
  // Check for credit keywords
  return lowerText.includes('credit sale') || lowerText.includes('credit paid');
};

/**
 * Determines the type of credit command
 */
export const getCreditCommandType = (text: string): 'sale' | 'payment' | null => {
  if (!text) {
    return null;
  }
  
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('credit sale')) {
    return 'sale';
  } else if (lowerText.includes('credit paid')) {
    return 'payment';
  }
  
  return null;
};

/**
 * Extracts customer name from order text
 * Examples: "order 1kg rice for Priya", "book 5 packets parle g for John"
 */
export const extractCustomerName = (text: string): string | undefined => {
  if (!text) {
    return undefined;
  }
  
  const lowerText = text.toLowerCase();
  
  // Look for "for [customer name]" pattern at the end of the sentence
  // Use a more specific pattern that captures proper names
  const forMatch = lowerText.match(/\bfor\s+([a-zA-Z][a-zA-Z\s]*?)(?:\s*$)/);
  if (forMatch && forMatch[1]) {
    const customerName = forMatch[1].trim();
    
    // Filter out common words that are not customer names
    const excludeWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
                         'kg', 'gram', 'grams', 'packet', 'packets', 'piece', 'pieces', 'liter', 'liters',
                         'rice', 'wheat', 'sugar', 'oil', 'milk', 'bread', 'biscuit', 'biscuits'];
    
    // Check if the customer name is just a number or common word
    if (excludeWords.includes(customerName.toLowerCase())) {
      return undefined;
    }
    
    // Check if it's a single letter (likely not a name)
    if (customerName.length === 1) {
      return undefined;
    }
    
    // Capitalize the customer name properly
    return customerName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return undefined;
};

/**
 * Determines the transaction type from the text
 * Returns 'cash-in' for sales and 'cash-out' for purchases
 */
export const determineTransactionType = (text: string): 'cash-in' | 'cash-out' => {
  if (!text) {
    return 'cash-in'; // Default type
  }
  
  text = text.toLowerCase();
  
  // Default to 'cash-in' (most common)
  let type: 'cash-in' | 'cash-out' = 'cash-in';
  
  // Check for cash-out keywords
  const cashOutKeywords = TRANSACTION_TYPES['cash-out'];
  if (cashOutKeywords.some(keyword => text.includes(keyword))) {
    type = 'cash-out';
  }
  
  // But if there are explicit 'sold' or 'sell' keywords, override to cash-in
  const soldKeywords = ['sold', 'sell', 'sale'];
  if (soldKeywords.some(keyword => text.includes(keyword))) {
    type = 'cash-in';
  }
  
  return type;
};

/**
 * Extracts a number from a string, returning the first match
 */
export const extractNumber = (text: string): number | null => {
  if (!text) {
    return null;
  }
  
  const matches = text.match(/\d+(\.\d+)?/g);
  if (matches && matches.length > 0) {
    return parseFloat(matches[0]);
  }
  return null;
};

/**
 * Extracts a currency value from text (looking for rupees, rs, ₹)
 */
export const extractPrice = (text: string): number | null => {
  if (!text) {
    return null;
  }
  
  // Look for price indicators
  const priceRegex = /(?:rs\.?|rupees?|₹)\s*(\d+(\.\d+)?)/i;
  const priceMatch = text.match(priceRegex);
  
  if (priceMatch && priceMatch[1]) {
    return parseFloat(priceMatch[1]);
  }
  
  // Look for "for X each" or "at X each" patterns
  const eachRegex = /(?:for|at)\s*(\d+(\.\d+)?)\s*(?:rs\.?|rupees?|₹)?\s*(?:each|per|a piece)/i;
  const eachMatch = text.match(eachRegex);
  
  if (eachMatch && eachMatch[1]) {
    return parseFloat(eachMatch[1]);
  }
  
  return null;
};

/**
 * Extract the quantity from the text
 */
export const extractQuantity = (text: string): number => {
  if (!text) {
    return 1; // Default to 1
  }
  
  const matches = text.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return 1; // Default to 1
  
  return parseFloat(matches[0]);
};

/**
 * Helper function to check if text contains a brand name like "Parle G"
 */
export const containsSpecialBrand = (text: string): string | null => {
  if (!text) {
    return null;
  }
  
  text = text.toLowerCase();
  
  // Check for Parle G specifically - various forms
  if (text.match(/parle[\s-]*g\b/i)) {
    return 'Parle G';
  }
  
  // Check other special cases
  for (const brand in SPECIAL_CASE_ITEMS) {
    if (text.includes(brand)) {
      return SPECIAL_CASE_ITEMS[brand];
    }
  }
  
  return null;
};

/**
 * Extracts a unit of measurement from the text
 */
export const extractUnit = (text: string): string | null => {
  if (!text) {
    return null;
  }
  
  text = text.toLowerCase();
  
  // Special case for "Parle-G" - "g" is not a unit here
  if (text.match(/parle[\s-]*g\b/i)) {
    // Check if text contains "packet(s)" or similar
    for (const unit of ['packet', 'packets', 'pack', 'packs']) {
      if (text.includes(unit)) {
        return 'packet';
      }
    }
    return '';
  }
  
  for (const unit of KNOWN_UNITS) {
    // Check for the unit with word boundaries
    const regex = new RegExp(`\\b${unit}\\b`, 'i');
    if (regex.test(text)) {
      return normalizeUnit(unit);
    }
  }
  
  return null;
};

/**
 * Attempts to identify the item name from the text
 */
export const extractItem = (text: string): string => {
  if (!text || text.trim() === '') {
    throw new ParsingError('Empty input text', 'EMPTY_INPUT');
  }
  
  // First check for special brands
  const specialBrand = containsSpecialBrand(text);
  if (specialBrand) {
    // For cases like "Parle G Biscuits", keep the product type
    const lowerText = text.toLowerCase();
    if (lowerText.includes('biscuit') && !specialBrand.toLowerCase().includes('biscuit')) {
      return `${specialBrand} Biscuits`;
    }
    if (lowerText.includes('noodle') && !specialBrand.toLowerCase().includes('noodle')) {
      return `${specialBrand} Noodles`;
    }
    if (lowerText.includes('chips') && !specialBrand.toLowerCase().includes('chips')) {
      return `${specialBrand} Chips`;
    }
    return specialBrand;
  }
  
  text = text.toLowerCase();
  
  // Remove common transaction words and numbers
  const cleanedText = text
    .replace(/\b(sold|sell|sale|bought|buy|purchased|expense|spent)\b/gi, '')
    .replace(/\d+(\.\d+)?/g, '')
    .replace(/\b(rs\.?|rupees?|₹|each|per|for|at)\b/gi, '');
  
  // Remove known units
  let itemText = cleanedText;
  for (const unit of KNOWN_UNITS) {
    itemText = itemText.replace(new RegExp(`\\b${unit}\\b`, 'gi'), '');
  }
  
  // Remove common prepositions like 'of'
  itemText = itemText.replace(/\b(of|from|to|with)\b/gi, '');
  
  // Clean up extra spaces and punctuation
  itemText = itemText
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?-]+/g, ' ')
    .trim();
  
  // If we have a very short or empty string, return a generic item name
  if (itemText.length < 2) {
    throw new ParsingError('Unable to identify item name from input', 'UNKNOWN_ITEM');
  }
  
  // Capitalize first letter of each word
  return itemText
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Helper function to parse a single item from a chunk of text
 */
function parseSingleItem(chunk: string): Partial<Entry> | null {
  if (!chunk || chunk.trim() === '') {
    return null;
  }
  
  try {
    // Clean up the chunk
    const cleanedChunk = chunk.trim();
    
    // Determine transaction type
    const type = determineTransactionType(cleanedChunk);
    
    // Extract quantity, defaulting to 1 if not found
    const qty = extractQuantity(cleanedChunk);
    
    // Check for special cases like "Parle G"
    const specialBrand = containsSpecialBrand(cleanedChunk);
    let item, unit;
    
    if (specialBrand) {
      item = specialBrand;
      
      // For cases like "Parle G Biscuits", add the product type
      const lowerText = cleanedChunk.toLowerCase();
      if (lowerText.includes('biscuit') && !item.toLowerCase().includes('biscuit')) {
        item = `${item} Biscuits`;
      }
      
      // Look for unit in the text
      if (cleanedChunk.toLowerCase().includes('packet')) {
        unit = 'packet';
      } else {
        unit = '';
      }
    } else {
      // Extract unit, if any
      unit = extractUnit(cleanedChunk) || '';
      
      try {
        // Extract item name
        item = extractItem(cleanedChunk);
      } catch (e) {
        if (e instanceof ParsingError && e.code === 'UNKNOWN_ITEM') {
          // Try using the entire chunk as the item name
          const cleanedName = cleanedChunk
            .toLowerCase()
            .replace(/\b(sold|sell|sale|bought|buy|purchased|expense|spent)\b/gi, '')
            .replace(/\b(rs\.?|rupees?|₹|each|per|for|at)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
            
          if (cleanedName.length > 0) {
            // Capitalize first letter of each word
            item = cleanedName
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          } else {
            return null; // Skip if we can't extract any name
          }
        } else {
          throw e;
        }
      }
    }
    
    // Extract price, defaulting to 0 if not found
    const price = extractPrice(cleanedChunk) || 0;
    
    // Calculate total
    const total = price * qty;
    
    const entry: Partial<Entry> = {
      item,
      qty,
      unit,
      price,
      total,
      type,
      source_text: cleanedChunk,
      transaction_date: new Date().toISOString(), // Default to today with current time
    };
    
    // Basic validation - just require an item name
    if (!entry.item || entry.item.trim() === '') {
      return null; // Skip entries with no item name
    }
    
    return entry;
  } catch (error) {
    console.error('Error parsing chunk:', error);
    return null;
  }
};

/**
 * Parse order command from text
 * Examples: "order 1kg rice for Priya", "book 5 packets parle g for John"
 */
export function parseOrderCommand(text: string): ParsedResult {
  const warnings: string[] = [];
  
  if (!text || text.trim() === '') {
    return {
      type: 'order',
      warnings: ['Empty input text'],
      source_text: text
    };
  }
  
  try {
    // Extract customer name first
    const customer = extractCustomerName(text);
    
    // Remove order keywords and customer name to focus on items
    let itemText = text.toLowerCase();
    
    // Remove order keywords
    ORDER_KEYWORDS.forEach(keyword => {
      itemText = itemText.replace(new RegExp(`\\b${keyword}\\b`, 'gi'), '');
    });
    
    // Remove customer part more carefully
    if (customer) {
      // Remove "for [customer]" pattern
      itemText = itemText.replace(new RegExp(`\\bfor\\s+${customer.toLowerCase()}\\b`, 'gi'), '');
    }
    
    // Clean up the text for better parsing
    itemText = itemText.trim();
    
    // Parse multiple items by splitting on "and" and commas
    const itemChunks = itemText.split(/\s+and\s+|,\s*/).filter(chunk => chunk.trim());
    
    const orderItems: Array<{
      item: string;
      qty: number;
      price?: number | null;
      delivery_date?: string | null;
    }> = [];
    
    if (itemChunks.length > 1) {
      // Multiple items detected - parse each chunk individually
      for (const chunk of itemChunks) {
        const trimmedChunk = chunk.trim();
        if (!trimmedChunk) continue;
        
        // Parse this chunk as a single item
        const parsedItem = parseSingleItem(trimmedChunk);
        if (parsedItem && parsedItem.item) {
          orderItems.push({
            item: parsedItem.item,
            qty: parsedItem.qty || 1,
            price: parsedItem.price || null,
            delivery_date: null
          });
        }
      }
    } else {
      // Single item or couldn't split - use existing logic
      const parsedItems = parseSentence(itemText);
      
      for (const entry of parsedItems) {
        if (entry.item) {
          orderItems.push({
            item: entry.item,
            qty: entry.qty || 1,
            price: entry.price || null,
            delivery_date: null
          });
        }
      }
    }
    
    if (orderItems.length === 0) {
      warnings.push('Could not identify any items in the order');
      return {
        type: 'order',
        warnings,
        source_text: text
      };
    }
    
    // Only add warning for missing prices if prices weren't auto-looked up
    // This will be handled in the UI layer where auto-lookup happens
    
    return {
      type: 'order',
      order: {
        customer: customer || 'Walk-in',
        items: orderItems
      },
      warnings,
      source_text: text
    };
    
  } catch (error) {
    console.error('Error parsing order command:', error);
    return {
      type: 'order',
      warnings: ['Error parsing order command'],
      source_text: text
    };
  }
}

/**
 * Enhanced parsing function that can detect orders, transactions, or price updates
 */
export function parseEnhanced(text: string): ParsedResult {
  if (!text || text.trim() === '') {
    return {
      type: 'transaction',
      warnings: ['Empty input text'],
      source_text: text
    };
  }
  
  const lowerText = text.toLowerCase();
  
  // Check if this is a price update command
  const priceUpdates = parsePriceSentence(text);
  if (priceUpdates.length > 0) {
    return {
      type: 'price',
      priceUpdates,
      warnings: [],
      source_text: text
    };
  }
  
  // Check if this is an order command
  if (isOrderCommand(text)) {
    return parseOrderCommand(text);
  }
  
  // Check if this is a credit command
  if (isCreditCommand(text)) {
    return parseCreditCommand(text);
  }
  
  // Default to transaction parsing
  try {
    const parsedItems = parseSentence(text);
    
    if (parsedItems.length === 0) {
      return {
        type: 'transaction',
        warnings: ['Could not parse any items from input'],
        source_text: text
      };
    }
    
    // For backward compatibility, return the first item as entry
    return {
      type: 'transaction',
      entry: parsedItems[0],
      warnings: [],
      source_text: text
    };
    
  } catch (error) {
    console.error('Error in enhanced parsing:', error);
    return {
      type: 'transaction',
      warnings: ['Error parsing input'],
      source_text: text
    };
  }
}

/**
 * Parse a sentence that may contain multiple items
 * Returns an array of parsed entries
 * 
 * NOTE: This function is kept unchanged for backward compatibility
 */
export function parseSentence(raw: string): ParsedEntry[] {
  if (!raw || raw.trim() === '') {
    return []; // Return empty array for empty input
  }
  
  try {
    // Try to extract chunks by splitting on commas, 'and', or numeric boundaries
    const cleaned = raw.toLowerCase();
    
    // Split by common delimiters
    const chunks = cleaned.split(/,| and |(?<=[.!?]) (?=[0-9])/);
    
    // If no chunks were found or only one chunk was found, try to parse the whole sentence
    if (chunks.length <= 1) {
      const result = parseSingleItem(raw);
      return result ? [result] : [];
    }
    
    const results: ParsedEntry[] = [];
    for (const c of chunks) {
      if (c.trim()) {
        const r = parseSingleItem(c);
        if (r) results.push(r);
      }
    }
    
    // If no items were parsed from chunks, try parsing the whole sentence
    if (results.length === 0) {
      const result = parseSingleItem(raw);
      if (result) results.push(result);
    }
    
    return results;
  } catch (error) {
    console.error('Error in parseSentence:', error);
    
    // As a fallback, try to parse the whole sentence
    const result = parseSingleItem(raw);
    return result ? [result] : [];
  }
}

// Legacy function to maintain backward compatibility
export const parseSingleSentence = (text: string): { entry: Partial<Entry>; warnings: string[] } => {
  const warnings: string[] = [];
  
  if (!text || text.trim() === '') {
    return {
      entry: {
        item: '',
        qty: 0,
        unit: '',
        price: 0,
        total: 0,
        type: 'cash-in',
        source_text: text,
        transaction_date: new Date().toISOString(),
      },
      warnings: ['Empty input text']
    };
  }
  
  try {
    // First try the multi-item parser and take the first result
    const results = parseSentence(text);
    
    if (results.length > 0) {
      return {
        entry: results[0],
        warnings: []
      };
    }
    
    // If multi-item parser failed, create a basic entry with the text as the item
    // This ensures we at least have something to show
    return {
      entry: {
        item: text.trim(),
        qty: 1,
        unit: '',
        price: 0,
        total: 0,
        type: 'cash-in',
        source_text: text,
        transaction_date: new Date().toISOString(),
      },
      warnings: ['Could not parse details from input, basic entry created']
    };
  } catch (error) {
    console.error('Error in parseSingleSentence:', error);
    
    // Return a basic entry as fallback
    return {
      entry: {
        item: 'Unknown Item',
        qty: 1,
        unit: '',
        price: 0,
        total: 0,
        type: 'cash-in',
        source_text: text,
        transaction_date: new Date().toISOString(),
      },
      warnings: ['Error parsing input, fallback entry created']
    };
  }
};

/**
 * Parse a price sentence like "price rice 50, apple 220"
 * Returns an array of items with prices
 */
export function parsePriceSentence(sentence: string): Array<{ item: string; price: number }> {
  if (!sentence || sentence.trim() === '') {
    return [];
  }

  // Check if this is a price-related command
  const priceKeywords = ['price', 'cost', 'rate', 'rupees', 'rs', '₹'];
  const hasPriceKeyword = priceKeywords.some(keyword => 
    sentence.toLowerCase().includes(keyword)
  );
  
  if (!hasPriceKeyword) {
    return [];
  }

  // Clean the sentence - remove common price words and currency symbols
  const cleanedSentence = sentence
    .replace(/price\s+of\s+/gi, '')
    .replace(/cost\s+of\s+/gi, '')
    .replace(/rate\s+of\s+/gi, '')
    .replace(/\b(is|are|costs?|prices?)\b/gi, '')
    .replace(/\b(rupees?|rs|₹)\b/gi, '')
    .trim();

  // Split by "and" to get individual items
  const itemParts = cleanedSentence.split(/\s+and\s+/i);

  const results: Array<{ item: string; price: number }> = [];

  for (const part of itemParts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    // Extract item name and price using regex
    // Look for patterns like "rice 30", "milk is 25", "coconut oil 45.50"
    const priceMatch = trimmedPart.match(/^(.+?)\s+(\d+(?:\.\d{1,2})?)$/);
    
    if (priceMatch) {
      const itemName = priceMatch[1].trim();
      const price = parseFloat(priceMatch[2]);

      if (itemName && !isNaN(price) && price >= 0) {
        // Capitalize first letter of each word
      const formattedItemName = itemName
        .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
        
        results.push({
          item: formattedItemName,
          price: price
        });
      }
    }
  }

  return results;
}

/**
 * Normalize quantities based on units
 */
export function normaliseQuantity(value: number, unit: string): number {
  if (!unit) return value;
  
  const normalizedUnit = unit.toLowerCase();
  
  if (['gm', 'g', 'gram', 'grams'].includes(normalizedUnit)) return value / 1000;
  if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(normalizedUnit)) return value;
  if (['ml'].includes(normalizedUnit)) return value / 1000;
  if (['l', 'litre', 'liter', 'litres'].includes(normalizedUnit)) return value;
  
  return value; // default "piece"
}

/**
 * Enhanced version of parseSentence that includes automatic price lookup
 * when prices are not found in the voice input
 */
export async function parseSentenceWithPriceLookup(text: string): Promise<{ entries: Partial<Entry>[]; warnings: string[] }> {
  // First parse normally
  const items = parseSentence(text);
  const warnings: string[] = [];
  
  if (items.length === 0) {
    return { entries: [], warnings: ['Could not parse any items from input'] };
  }
  
  // Enhanced entries with price lookup
  const enhancedEntries = await Promise.all(
    items.map(async (item) => {
      let finalPrice = item.price || 0;
      let priceSource = 'parsed';
      
      // If no price was found in parsing, try to look it up
      if (!finalPrice || finalPrice === 0) {
        try {
          const lookedUpPrice = await lookupPrice(item.item || '');
          if (lookedUpPrice && lookedUpPrice > 0) {
            finalPrice = lookedUpPrice;
            priceSource = 'auto-lookup';
          }
        } catch (error) {
          console.warn('Price lookup failed for item:', item.item, error);
        }
      }
      
      // Calculate new total with the updated price
      const finalTotal = finalPrice * (item.qty || 1);
      
      return {
        ...item,
        price: finalPrice,
        total: finalTotal,
        price_source: priceSource // Add metadata for debugging
      };
    })
  );
  
  // Generate warnings
  const itemsWithoutPrices = enhancedEntries.filter(item => !item.price || item.price === 0);
  if (itemsWithoutPrices.length > 0) {
    warnings.push(`No price found for: ${itemsWithoutPrices.map(item => item.item).join(', ')}`);
  }
  
  const autoLookedUpItems = enhancedEntries.filter(item => item.price_source === 'auto-lookup');
  if (autoLookedUpItems.length > 0) {
    warnings.push(`Auto-populated prices for: ${autoLookedUpItems.map(item => `${item.item} (₹${item.price})`).join(', ')}`);
  }
  
  return { entries: enhancedEntries, warnings };
}

/**
 * Parse credit commands like "credit sale 10 kg rice for Priya" or "credit paid Priya 500"
 */
export function parseCreditCommand(text: string): ParsedResult {
  const warnings: string[] = [];
  const source_text = text;
  
  if (!text || !isCreditCommand(text)) {
    return {
      type: 'transaction',
      warnings: ['Not a credit command'],
      source_text
    };
  }
  
  const creditType = getCreditCommandType(text);
  if (!creditType) {
    return {
      type: 'transaction',
      warnings: ['Could not determine credit command type'],
      source_text
    };
  }
  
  try {
    if (creditType === 'sale') {
      return parseCreditSale(text, warnings, source_text);
    } else if (creditType === 'payment') {
      return parseCreditPayment(text, warnings, source_text);
    }
  } catch (error) {
    warnings.push(`Error parsing credit command: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    type: 'transaction',
    warnings,
    source_text
  };
}

/**
 * Parse credit sale command: "credit sale 10 kg rice for Priya" or "credit sale 2 kg rice and 7 kg wheat for Anil"
 */
function parseCreditSale(text: string, warnings: string[], source_text: string): ParsedResult {
  // Remove "credit sale" from the beginning
  const cleanText = text.replace(/^credit\s+sale\s+/i, '').trim();
  
  // Extract customer name (should be at the end after "for")
  const customer = extractCustomerName(text);
  if (!customer) {
    warnings.push('Could not extract customer name from credit sale');
    return { type: 'transaction', warnings, source_text };
  }
  
  // Remove customer part from text to parse item details
  const itemText = cleanText.replace(/\s+for\s+.+$/i, '').trim();
  
  // Parse the item details using existing parsing logic
  try {
    const entries = parseSentence(itemText);
    if (entries.length === 0) {
      warnings.push('Could not parse item details from credit sale');
      return { type: 'transaction', warnings, source_text };
    }
    
    // Handle multiple items
    if (entries.length > 1) {
      // Multi-item credit sale
      const items = entries.map(entry => ({
        item: entry.item || '',
        qty: entry.qty || 1,
        unit: entry.unit || '',
        price: entry.price || 0,
        total: entry.total || 0
      }));
      
      const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
      
      return {
        type: 'credit',
        credit: {
          type: 'sale',
          customer,
          items, // Array of items for multi-item support
          amount: totalAmount
        },
        warnings,
        source_text
      };
    } else {
      // Single item credit sale (backward compatibility)
      const entry = entries[0];
      
      return {
        type: 'credit',
        credit: {
          type: 'sale',
          customer,
          item: entry.item || '',
          qty: entry.qty || 1,
          unit: entry.unit || '',
          price: entry.price || 0,
          amount: entry.total || 0
        },
        warnings,
        source_text
      };
    }
  } catch (error) {
    warnings.push('Error parsing item details in credit sale');
    return { type: 'transaction', warnings, source_text };
  }
}

/**
 * Parse credit payment command: "credit paid Priya 500" or "credit paid 500 to Priya"
 */
function parseCreditPayment(text: string, warnings: string[], source_text: string): ParsedResult {
  // Remove "credit paid" from the beginning
  const cleanText = text.replace(/^credit\s+paid\s+/i, '').trim();
  
  // Try different patterns for credit payment
  // Pattern 1: "credit paid Priya 500"
  const pattern1 = cleanText.match(/^([a-zA-Z][a-zA-Z\s]*?)\s+(\d+(?:\.\d+)?)$/);
  if (pattern1) {
    const customerName = pattern1[1].trim();
    const amount = parseFloat(pattern1[2]);
    
    return {
      type: 'credit',
      credit: {
        type: 'payment',
        customer: customerName
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' '),
        amount
      },
      warnings,
      source_text
    };
  }
  
  // Pattern 2: "credit paid 500 to Priya" or "credit paid 500 for Priya"
  const pattern2 = cleanText.match(/^(\d+(?:\.\d+)?)\s+(?:to|for)\s+([a-zA-Z][a-zA-Z\s]*?)$/);
  if (pattern2) {
    const amount = parseFloat(pattern2[1]);
    const customerName = pattern2[2].trim();
    
    return {
      type: 'credit',
      credit: {
        type: 'payment',
        customer: customerName
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' '),
        amount
      },
      warnings,
      source_text
    };
  }
  
  warnings.push('Could not parse credit payment command format');
  return { type: 'transaction', warnings, source_text };
} 