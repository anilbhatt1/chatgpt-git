// Define basic entry types for our app
export interface Entry {
  id: string;
  item: string;
  qty: number;
  unit: string;
  price: number;
  total: number;
  type: 'cash-in' | 'cash-out';
  created_at: string;
  transaction_date: string; // Date of the transaction (can be different from creation date)
  source_text: string;
  is_final: boolean;
  user_id: string;
  version: number;
  confirmed: boolean;
  batch_id?: string | null;
  order_id?: string | null;
  // Credit functionality fields
  customer?: string | null;
  txn_type?: 'sale' | 'credit' | 'credit_paid' | null;
}

// Define price types
export interface PriceRow {
  id: string;
  item: string;
  price: number;
  updated_at: number;           // epoch seconds
  created_at?: string;
  source_text?: string;
  last_update_comment: string;
}

// Define order types
export type OrderStatus = 'open' | 'partial' | 'delivered' | 'cancelled';

export interface Order {
  order_id: string;
  customer: string;
  status: OrderStatus;
  created_at: number;
  updated_at: number;
}

export interface OrderItem {
  id: number;
  order_id: string;
  item: string;
  qty: number;
  price: number | null;
  delivered: boolean;
  delivery_date: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
  total_value: number;
  delivered_value: number;
  latest_delivery_date: string | null;
}

// Define app-wide state structure
export interface AppState {
  entries: Entry[];
  currentEntry: Partial<Entry> | null;
  isProcessing: boolean;
  error: string | null;
  user: {
    id: string;
  } | null;
  settings: {
    quickCapture: boolean;
    syncNewDays: number;
    syncNewMaxItems: number;
    autoCreateCashOnDelivery: boolean;
  };
}

// Define action types
export enum ActionTypes {
  ADD_ENTRY = 'ADD_ENTRY',
  ADD_ENTRIES_BATCH = 'ADD_ENTRIES_BATCH',
  UPDATE_ENTRY = 'UPDATE_ENTRY',
  DELETE_ENTRY = 'DELETE_ENTRY',
  SET_CURRENT_ENTRY = 'SET_CURRENT_ENTRY',
  CLEAR_CURRENT_ENTRY = 'CLEAR_CURRENT_ENTRY',
  SET_PROCESSING = 'SET_PROCESSING',
  SET_ERROR = 'SET_ERROR',
  CLEAR_ERROR = 'CLEAR_ERROR',
  SET_USER = 'SET_USER',
  SET_QUICK_CAPTURE = 'SET_QUICK_CAPTURE',
  SET_SYNC_NEW_DAYS = 'SET_SYNC_NEW_DAYS',
  SET_SYNC_NEW_MAX_ITEMS = 'SET_SYNC_NEW_MAX_ITEMS',
  SET_AUTO_CREATE_CASH_ON_DELIVERY = 'SET_AUTO_CREATE_CASH_ON_DELIVERY',
  SET_ENTRIES = 'SET_ENTRIES',
  DELETE_BATCH = 'DELETE_BATCH',
}

// Define action interfaces
export interface AddEntryAction {
  type: ActionTypes.ADD_ENTRY;
  payload: Entry;
}

export interface AddEntriesBatchAction {
  type: ActionTypes.ADD_ENTRIES_BATCH;
  payload: Entry[];
}

export interface UpdateEntryAction {
  type: ActionTypes.UPDATE_ENTRY;
  payload: {
    id: string;
    updates: Partial<Entry>;
  };
}

export interface DeleteEntryAction {
  type: ActionTypes.DELETE_ENTRY;
  payload: string; // Entry ID
}

export interface SetCurrentEntryAction {
  type: ActionTypes.SET_CURRENT_ENTRY;
  payload: Partial<Entry>;
}

export interface ClearCurrentEntryAction {
  type: ActionTypes.CLEAR_CURRENT_ENTRY;
}

export interface SetProcessingAction {
  type: ActionTypes.SET_PROCESSING;
  payload: boolean;
}

export interface SetErrorAction {
  type: ActionTypes.SET_ERROR;
  payload: string;
}

export interface ClearErrorAction {
  type: ActionTypes.CLEAR_ERROR;
}

export interface SetUserAction {
  type: ActionTypes.SET_USER;
  payload: {
    id: string;
  };
}

export interface SetQuickCaptureAction {
  type: ActionTypes.SET_QUICK_CAPTURE;
  value: boolean;
}

export interface SetSyncNewDaysAction {
  type: ActionTypes.SET_SYNC_NEW_DAYS;
  value: number;
}

export interface SetSyncNewMaxItemsAction {
  type: ActionTypes.SET_SYNC_NEW_MAX_ITEMS;
  value: number;
}

export interface SetAutoCreateCashOnDeliveryAction {
  type: ActionTypes.SET_AUTO_CREATE_CASH_ON_DELIVERY;
  value: boolean;
}

// Interface for the new action
export interface SetEntriesAction {
  type: ActionTypes.SET_ENTRIES;
  payload: Entry[];
}

export interface DeleteBatchAction {
  type: ActionTypes.DELETE_BATCH;
  payload: string; // Batch ID
}

// Union type for all possible actions
export type AppActions =
  | AddEntryAction
  | AddEntriesBatchAction
  | UpdateEntryAction
  | DeleteEntryAction
  | SetCurrentEntryAction
  | ClearCurrentEntryAction
  | SetProcessingAction
  | SetErrorAction
  | ClearErrorAction
  | SetUserAction
  | SetQuickCaptureAction
  | SetSyncNewDaysAction
  | SetSyncNewMaxItemsAction
  | SetAutoCreateCashOnDeliveryAction
  | SetEntriesAction
  | DeleteBatchAction;

// Credit-specific types
export interface CustomerBalance {
  name: string;
  totalOutstanding: number;
  aging: {
    current: number;      // 0-30 days
    days30: number;       // 31-60 days  
    days60: number;       // 61-90 days
    days90Plus: number;   // 90+ days
  };
  lastPaymentDate?: string;
  oldestUnpaidDate?: string;
  totalCredits: number;
  totalPayments: number;
} 