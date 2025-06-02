import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TouchableOpacity, 
  StyleSheet,
  Modal,
  Pressable,
  ViewStyle,
  TextStyle,
  FlexAlignType,
  SafeAreaView,
  InteractionManager
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Entry } from '../../state/types';
import { MainLayout } from '../../components/layout/MainLayout';
import { useAppContext } from '../../state/context';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate, isSameDay } from '../../utils/dateUtils';
import { Calendar } from 'react-native-calendars';
import { useEntryActions } from '../../hooks';
import { DeleteConfirmationModal } from '../../components';
import { Snackbar, showSnackbar } from '../../components/Snackbar';
import { PendingTab } from './PendingTab';
import { EditableTransactionCard } from '../../components/EditableTransactionCard';
import { getStorage } from '../../utils/storage';
import { ActionTypes } from '../../state/types';
import { TransactionBatchCard } from '../../components/TransactionBatchCard';
import { getDatabase, deleteBatch, getConfirmedEntriesByBatch, getEntriesWithOrderInfoByDateAndTimeRange } from '../../utils/sqliteStorage';
import { isToday, addDays, subDays } from 'date-fns';
import { Feather } from '@expo/vector-icons';
import { addEntriesBatch } from '../../state/actions';

interface EodReviewScreenProps {
  navigation: any;
}

interface CalendarDay {
  day: number;
  month: number;
  year: number;
  timestamp: number;
  dateString: string;
}

// Tab enum type
type TabType = 'transactions' | 'pending';

// Interface for storing batch information
interface BatchInfo {
  batch_id: string;
  t0: string;
  rows: number;
  source_text?: string;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 8,
  },
  header: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as FlexAlignType,
    justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    flex: 1,
  },
  headerButtons: {
    flexDirection: 'row' as const,
    alignItems: 'center' as FlexAlignType,
  },
  navigationButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginLeft: 8,
    elevation: 3,
  },
  navigationButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  dateSelector: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 8,
  },
  dateButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
    flex: 0.7,
    marginRight: 4,
  },
  dateButtonText: {
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
    fontSize: 13,
  },
  datePickerWithArrows: {
    flex: 1.3,
    flexDirection: 'row' as const,
    alignItems: 'center' as FlexAlignType,
  },
  datePickerButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
  },
  datePickerButtonText: {
    fontWeight: '500',
    textAlign: 'center',
    fontSize: 13,
  },
  dateArrowButton: {
    padding: 6,
    justifyContent: 'center' as const,
    alignItems: 'center' as FlexAlignType,
  },
  dateArrowText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50', // Green color as shown in screenshot
  },
  timeRangeSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as FlexAlignType,
    marginBottom: 12,
  },
  timeButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
  },
  timeButtonText: {
    textAlign: 'center',
    fontSize: 13,
  },
  timeRangeText: {
    marginHorizontal: 6,
    fontSize: 12,
  },
  resetButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginLeft: 8,
  },
  resetButtonText: {
    color: '#fff',
    fontWeight: '500',
    fontSize: 12,
  },
  tabsContainer: {
    flexDirection: 'row' as const,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'center' as FlexAlignType,
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as FlexAlignType,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  calendarContainer: {
    width: '90%',
    padding: 16,
    borderRadius: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  entryItem: {
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 8,
    marginVertical: 4,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as FlexAlignType,
    borderWidth: 0.5,
    borderColor: '#DDD',
    borderStyle: 'solid',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  entryContent: {
    flex: 1,
  },
  timeText: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 2,
  },
  entryMainText: {
    fontSize: 15,
    fontWeight: '500',
  },
  totalText: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  iconActions: {
    flexDirection: 'row' as const,
    marginLeft: 8,
  },
  iconButton: {
    padding: 6,
    marginLeft: 4,
  },
  icon: {
    fontSize: 18,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as FlexAlignType,
  },
  loadingText: {
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as FlexAlignType,
  },
  emptyText: {
    fontSize: 16,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as FlexAlignType,
  },
  summaryColumn: {
    flex: 1,
    alignItems: 'center' as FlexAlignType,
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
    opacity: 0.8,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  summaryDivider: {
    width: 1,
    height: 36,
    marginHorizontal: 8,
  },
  modalContainer: {
    width: '90%',
    maxWidth: 500,
    borderRadius: 8,
  },
  editModalContainer: {
    width: '90%',
    maxWidth: 500,
    borderRadius: 8,
  },
  addButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
    flex: 0.7,
    marginRight: 4,
    backgroundColor: '#4CAF50', // Light green color
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 15,
    marginLeft: 4,
  },
});

export const EodReviewScreen: React.FC<EodReviewScreenProps> = ({ navigation }) => {
  const { state, dispatch } = useAppContext();
  const { colors } = useTheme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [pendingCount, setPendingCount] = useState(0);
  
  // Transaction batches state
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  
  // Edit Transaction modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<Entry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Add Transaction modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addModalEntry, setAddModalEntry] = useState<Partial<Entry> | null>(null);
  
  // Add navigation state tracking to prevent modal touch blocking
  const [isNavigatingFromModal, setIsNavigatingFromModal] = useState(false);
  
  // Add modal keys to force re-render when needed
  const [addModalKey, setAddModalKey] = useState(1000);
  const [editModalKey, setEditModalKey] = useState(2000);
  
  // Time range state
  const [startTime, setStartTime] = useState<Date>(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  
  const [endTime, setEndTime] = useState<Date>(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date;
  });
  
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  
  const [totals, setTotals] = useState({
    cashIn: 0,
    cashOut: 0,
    net: 0
  });
  
  // Add refresh trigger to reload data after local changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Use the custom hook for entry actions
  const { 
    deleteModalVisible, 
    entryToDelete, 
    isLoading: isDeleteLoading, 
    handleDeleteEntry, 
    cancelDelete, 
    handleEditEntry: baseHandleEditEntry 
  } = useEntryActions();

  // Override the hook's edit function to use the modal instead of navigating
  const handleEditEntry = (entry: Entry) => {
    setEntryToEdit(entry);
    setEditModalVisible(true);
    setIsNavigatingFromModal(false); // Reset navigation state when opening modal
  };
  
  // Handle edit confirmation
  const handleEditConfirm = async (updatedEntryData: Partial<Entry>) => {
    if (!entryToEdit) return;
    
    try {
      setIsEditing(true);
      
      // Update the entry in the database
      const storage = await getStorage();
      const updatedEntry = await storage.updateEntry(entryToEdit.id, updatedEntryData);
      
      // Update the global state
      dispatch({
        type: ActionTypes.UPDATE_ENTRY,
        payload: {
          id: updatedEntry.id,
          updates: updatedEntry
        }
      });
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      showSnackbar('✅ Entry updated');
      
      // Close the modal
      setEditModalVisible(false);
      setEntryToEdit(null);
    } catch (error) {
      console.error('Error updating entry:', error);
      showSnackbar('❌ Failed to update entry');
    } finally {
      setIsEditing(false);
    }
  };
  
  // Handle edit cancel
  const handleEditCancel = () => {
    setEditModalVisible(false);
    setEntryToEdit(null);
  };
  
  // Navigate to home screen
  const handleHomePress = () => {
    navigation.navigate('Home');
  };

  // Calculate totals based on entries
  const calculateTotals = (entriesList: Entry[]) => {
    const newTotals = entriesList.reduce(
      (acc, entry) => {
        if (entry.type === 'cash-in') {
          acc.cashIn += entry.total;
        } else {
          acc.cashOut += entry.total;
        }
        return acc;
      },
      { cashIn: 0, cashOut: 0, net: 0 }
    );
    
    newTotals.net = newTotals.cashIn - newTotals.cashOut;
    setTotals(newTotals);
  };

  // Handle tab change
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };
  
  // Handle batch expansion toggle
  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(batchId)) {
        newSet.delete(batchId);
      } else {
        newSet.add(batchId);
      }
      return newSet;
    });
  };
  
  // Handle batch deletion
  const handleDeleteBatch = async (batchId: string) => {
    // Get a direct count from the database instead of using the filtered entries
    try {
      setIsLoading(true);
      
      // Get all entries from this batch from the database
      const batchEntries = await getConfirmedEntriesByBatch(batchId);
      const batchCount = batchEntries.length;
      
      // Create a descriptive item name for the confirmation dialog
      const itemsDescription = `${batchCount} ${batchCount === 1 ? 'item' : 'items'} in this batch`;
      
      // Use the delete entry functionality with a custom callback
      const deleteInfo = {
        id: batchId,
        description: itemsDescription,
        isBatch: true  // Add a flag to identify this is a batch deletion
      };
      
      handleDeleteEntry(deleteInfo);
    } catch (error) {
      console.error('Error getting batch count:', error);
      showSnackbar('❌ Failed to get batch details');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Load filtered entries directly from database and process batches
  useEffect(() => {
    const loadAndProcessEntries = async () => {
      try {
    setIsLoading(true);
    
        if (activeTab !== 'transactions') {
          setEntries([]);
          setBatches([]);
          setTotals({ cashIn: 0, cashOut: 0, net: 0 });
          return;
        }
        
        // Use database-level filtering for better performance with order information
        const dbEntries = await getEntriesWithOrderInfoByDateAndTimeRange(
          selectedDate,
          startTime,
          endTime,
          true // confirmedOnly = true for transactions tab
        );
        
        calculateTotals(dbEntries);
        
        // Process batches (both batch_id and order_id based clustering)
        const batchesMap = new Map<string, { entries: Entry[], earliestTime: string, type: 'batch' | 'order' }>();
        
        // First pass - collect all batch_id based clusters
        dbEntries.forEach(entry => {
          if (entry.batch_id && entry.batch_id !== 'single' && entry.batch_id !== '') {
            const key = `batch_${entry.batch_id}`;
            if (!batchesMap.has(key)) {
              batchesMap.set(key, { 
                entries: [entry],
                earliestTime: entry.transaction_date,
                type: 'batch'
              });
            } else {
              const batch = batchesMap.get(key)!;
              batch.entries.push(entry);
              
              // Track the earliest transaction time
              if (new Date(entry.transaction_date) < new Date(batch.earliestTime)) {
                batch.earliestTime = entry.transaction_date;
              }
            }
          }
        });
        
        // Second pass - collect order_id based clusters (for entries not already in batch clusters)
        dbEntries.forEach(entry => {
          // Skip if already in a batch cluster
          if (entry.batch_id && entry.batch_id !== 'single' && entry.batch_id !== '') {
            return;
          }
          
          // Group by order_id if it exists
          if (entry.order_id && entry.order_id !== '') {
            const key = `order_${entry.order_id}`;
            if (!batchesMap.has(key)) {
              batchesMap.set(key, { 
                entries: [entry],
                earliestTime: entry.transaction_date,
                type: 'order'
              });
            } else {
              const batch = batchesMap.get(key)!;
              batch.entries.push(entry);
              
              // Track the earliest transaction time
              if (new Date(entry.transaction_date) < new Date(batch.earliestTime)) {
                batch.earliestTime = entry.transaction_date;
              }
            }
          }
        });
        
        // Third pass - separate single-item clusters and create BatchInfo objects
        const batchInfoArray: BatchInfo[] = [];
        
        // Process each cluster
        batchesMap.forEach((data, key) => {
          // Only create BatchInfo for multi-item clusters
          if (data.entries.length > 1) {
            const sourceText = data.entries[0]?.source_text || '';
            // Extract the actual ID from the key (remove 'batch_' or 'order_' prefix)
            const actualId = key.startsWith('batch_') ? key.substring(6) : key.substring(6);
            batchInfoArray.push({
              batch_id: key, // Use the full key to maintain uniqueness
              t0: data.earliestTime,
              rows: data.entries.length,
              source_text: sourceText
            });
          }
        });
        
        // Sort batches by earliest time (newest first)
        batchInfoArray.sort((a, b) => new Date(b.t0).getTime() - new Date(a.t0).getTime());
        
        // Create final entries list excluding items in multi-item clusters
        const clusterKeysToExclude = new Set();
        batchInfoArray.forEach(batch => {
          const data = batchesMap.get(batch.batch_id);
          if (data) {
            data.entries.forEach(entry => {
              if (data.type === 'batch') {
                clusterKeysToExclude.add(`batch_${entry.batch_id}`);
              } else if (data.type === 'order') {
                clusterKeysToExclude.add(`order_${entry.order_id}`);
              }
            });
          }
        });
        
        const entriesToDisplay = dbEntries.filter(entry => {
          // Check if entry is part of a multi-item batch cluster
          if (entry.batch_id && entry.batch_id !== 'single' && entry.batch_id !== '') {
            return !clusterKeysToExclude.has(`batch_${entry.batch_id}`);
          }
          
          // Check if entry is part of a multi-item order cluster
          if (entry.order_id && entry.order_id !== '') {
            return !clusterKeysToExclude.has(`order_${entry.order_id}`);
          }
          
          // Include standalone entries
          return true;
        });
        
        setEntries(entriesToDisplay);
        setBatches(batchInfoArray);
        
    } catch (error) {
        console.error('Error loading filtered entries:', error);
        setEntries([]);
        setBatches([]);
        setTotals({ cashIn: 0, cashOut: 0, net: 0 });
    } finally {
      setIsLoading(false);
    }
    };
    
    loadAndProcessEntries();
  }, [selectedDate, startTime, endTime, activeTab, refreshTrigger]);

  // Handle date change
  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    setShowCalendar(false);
  };
  
  // Navigate to previous day
  const handlePreviousDay = () => {
    setSelectedDate(prevDate => subDays(prevDate, 1));
  };
  
  // Navigate to next day (now allows future dates)
  const handleNextDay = () => {
    setSelectedDate(prevDate => addDays(prevDate, 1));
  };
  
  // Reset time range to full day
  const resetTimeRange = () => {
    const startTimeDate = new Date(selectedDate);
    startTimeDate.setHours(0, 0, 0, 0);
    setStartTime(startTimeDate);
    
    const endTimeDate = new Date(selectedDate);
    endTimeDate.setHours(23, 59, 59, 999);
    setEndTime(endTimeDate);
  };

  // Format date for UI
  const formatShortDate = (date: Date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };
  
  // Format time for UI
  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12; // Convert 0 to 12 for 12 AM
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };
  
  // Get today's date string for the calendar
  const getTodayString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Get selected date in YYYY-MM-DD format for the calendar
  const getSelectedDateString = () => {
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Render item in the FlatList
  const renderItem = ({ item }: { item: Entry & { customer?: string } }) => {
    // Format the transaction date and time
    const getTimeString = (dateString: string) => {
      const date = new Date(dateString);
      
      // Format date part
      const day = date.getDate();
      const month = date.toLocaleString('default', { month: 'short' });
      
      // Format time part
      let hours = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // the hour '0' should be '12'
      
      return `${day} ${month} · ${hours}:${minutes} ${ampm}`;
    };

    // Format order information if available
    const getOrderInfo = () => {
      if (item.order_id) {
        const customer = item.customer || 'N/A';
        return ` • ${item.order_id} (${customer})`;
      }
      return '';
    };

    // Create a descriptive item name for the confirmation dialog
    const itemDescription = `${item.item} (${item.qty} ${item.unit}) - ₹${item.price} each`;

    return (
    <View style={[
      styles.entryItem,
      { backgroundColor: colors.card }
    ]}>
        <View style={styles.entryContent}>
          <Text style={[styles.timeText, { color: colors.text, opacity: 0.7 }]}>
            {getTimeString(item.transaction_date)}{getOrderInfo()}
        </Text>
          <Text style={[styles.entryMainText, { color: colors.text }]}>
            {item.item} ({item.qty} {item.unit}) - ₹{item.price} each
        </Text>
        <Text style={[
          styles.totalText,
          { color: item.type === 'cash-in' ? colors.success : colors.error }
        ]}>
          {item.type === 'cash-in' ? '+' : '-'}₹{item.total}
        </Text>
      </View>
      
        <View style={styles.iconActions}>
        <TouchableOpacity
            style={styles.iconButton}
          onPress={() => handleEditEntry(item)}
            accessibilityLabel="Edit entry"
        >
            <Text style={styles.icon}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
            style={styles.iconButton}
            onPress={() => handleDeleteEntry({ id: item.id, description: itemDescription })}
            accessibilityLabel="Delete entry"
        >
            <Text style={styles.icon}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
  };

  // Format time string for batch display
  const formatBatchTime = (dateString: string) => {
    const date = new Date(dateString);
    
    // Format date part
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    
    // Format time part
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    
    return `${day} ${month} · ${hours}:${minutes} ${ampm}`;
  };

  // Check if an entry is part of a displayed cluster (batch or order)
  const isEntryInDisplayedBatch = (entry: Entry) => {
    return batches.some(batch => {
      // Check for batch-based clustering
      if (batch.batch_id.startsWith('batch_')) {
        const actualBatchId = batch.batch_id.substring(6);
        return entry.batch_id === actualBatchId;
      }
      // Check for order-based clustering
      if (batch.batch_id.startsWith('order_')) {
        const actualOrderId = batch.batch_id.substring(6);
        return entry.order_id === actualOrderId;
      }
      return false;
    });
  };

  // Custom implementation for confirmDelete to handle batch deletion
  const confirmDelete = async () => {
    if (!entryToDelete) return;
    
    try {
      // setIsLoading(true);
      
      // Check if this is a batch deletion
      if ('isBatch' in entryToDelete && entryToDelete.isBatch) {
        // Use the deleteBatch function from sqliteStorage
        await deleteBatch(entryToDelete.id);
        
        // Update global state - remove all entries with this batch_id
        dispatch({
          type: ActionTypes.DELETE_BATCH,
          payload: entryToDelete.id
        });
        
        showSnackbar('✅ Batch deleted');
      } else {
        // Regular entry deletion
        const storage = await getStorage();
        await storage.deleteEntry(entryToDelete.id);
        
        // Update global state
        dispatch({
          type: ActionTypes.DELETE_ENTRY,
          payload: entryToDelete.id
        });
        
        showSnackbar('✅ Entry deleted');
      }
      
      // Trigger local data refresh to update UI immediately for both tabs
      setRefreshTrigger(prev => prev + 1);
      
    } catch (error) {
      console.error('Error deleting entry or batch:', error);
      showSnackbar('❌ Deletion failed');
    } finally {
      // setIsLoading(false);
      // setDeleteModalVisible(false);
      // setEntryToDelete(null);
      
      // Use the cancelDelete function to reset state
      cancelDelete();
    }
  };

  // Handle add new transaction
  const handleAddNewTransaction = () => {
    // Create a new date object with the selected date but current time
    const now = new Date();
    const transactionDate = new Date(selectedDate);
    transactionDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    
    // Create the entry object when opening the modal
    setAddModalEntry({
      transaction_date: new Date().toISOString(), // Use current date and time
      type: 'cash-in', // Default to cash-in
      confirmed: true, // Will go to the Cash tab
    });
    
    setAddModalVisible(true);
  };
  
  // Handle add transaction cancel
  const handleAddCancel = () => {
    setAddModalVisible(false);
    setAddModalEntry(null);
  };
  
  // Handle add transaction confirm
  const handleAddConfirm = async (newEntryData: Partial<Entry>) => {
    try {
      setIsEditing(true);
      
      // Create a new entry with confirmed=true
      const storage = await getStorage();
      const newEntry = await storage.saveEntry({
        ...newEntryData,
        confirmed: true, // Set to confirmed (Cash tab)
        transaction_date: newEntryData.transaction_date || new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      
      // Update the global state
      dispatch({
        type: ActionTypes.ADD_ENTRY,
        payload: newEntry
      });
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      showSnackbar('✅ Transaction added');
      
      // Close the modal
      setAddModalVisible(false);
    } catch (error) {
      console.error('Error adding transaction:', error);
      showSnackbar('❌ Failed to add transaction');
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <MainLayout>
      <View style={styles.container}>
        {/* Date selector with arrows */}
        <View style={styles.dateSelector}>
          {activeTab === 'transactions' && (
            <TouchableOpacity 
              style={styles.addButton}
              onPress={handleAddNewTransaction}
            >
              <View style={styles.addButtonContent}>
                <Feather name="plus" size={18} color="white" />
                <Text style={styles.addButtonText}>Add</Text>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={[styles.dateButton, { backgroundColor: colors.primary }]}
            onPress={() => handleDateChange(new Date())}
          >
            <Text style={styles.dateButtonText}>Today</Text>
          </TouchableOpacity>
          
          <View style={styles.datePickerWithArrows}>
            <TouchableOpacity 
              style={styles.dateArrowButton} 
              onPress={handlePreviousDay}
            >
              <Text style={styles.dateArrowText}>{"<"}</Text>
            </TouchableOpacity>
            
          <TouchableOpacity 
            style={[styles.datePickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowCalendar(true)}
          >
            <Text style={[styles.datePickerButtonText, { color: colors.text }]}>
              {formatShortDate(selectedDate)} 📅
            </Text>
          </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.dateArrowButton}
              onPress={handleNextDay}
            >
              <Text style={styles.dateArrowText}>{">"}</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Time range selector */}
        <View style={styles.timeRangeSelector}>
          <TouchableOpacity 
            style={[styles.timeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowStartTimePicker(true)}
          >
            <Text style={[styles.timeButtonText, { color: colors.text }]}>
              {formatTime(startTime)} 🕒
            </Text>
          </TouchableOpacity>
          
          <Text style={[styles.timeRangeText, { color: colors.text }]}>
            to
          </Text>
          
          <TouchableOpacity 
            style={[styles.timeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowEndTimePicker(true)}
          >
            <Text style={[styles.timeButtonText, { color: colors.text }]}>
              {formatTime(endTime)} 🕒
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.resetButton, { backgroundColor: colors.secondary }]}
            onPress={resetTimeRange}
          >
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
        
        {/* Tab selector */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'transactions' && [styles.activeTab, { borderColor: colors.primary }]
            ]}
            onPress={() => handleTabChange('transactions')}
          >
            <Text 
              style={[
                styles.tabText, 
                activeTab === 'transactions' ? { color: colors.primary, fontWeight: 'bold' } : { color: colors.text }
              ]}
            >
              Cash
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'pending' && [styles.activeTab, { borderColor: colors.primary }]
            ]}
            onPress={() => handleTabChange('pending')}
          >
            <Text 
              style={[
                styles.tabText, 
                activeTab === 'pending' ? { color: colors.primary, fontWeight: 'bold' } : { color: colors.text }
              ]}
            >
              Pend Cash {pendingCount > 0 ? `(${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Calendar Modal */}
        {showCalendar && (
          <Modal
            transparent={true}
            visible={showCalendar}
            animationType="fade"
            onRequestClose={() => setShowCalendar(false)}
          >
            <Pressable 
              style={styles.modalOverlay}
              onPress={() => setShowCalendar(false)}
            >
              <Pressable 
                style={[styles.calendarContainer, { backgroundColor: colors.card }]}
                onPress={e => e.stopPropagation()}
              >
                <Calendar
                  current={getSelectedDateString()}
                  minDate="2020-01-01"
                  maxDate="2030-12-31"
                  onDayPress={(day: CalendarDay) => {
                    const selected = new Date(day.timestamp);
                    handleDateChange(selected);
                  }}
                  markedDates={{
                    [getSelectedDateString()]: { selected: true, selectedColor: colors.primary },
                    [getTodayString()]: { marked: true, dotColor: colors.accent }
                  }}
                  theme={{
                    backgroundColor: colors.card,
                    calendarBackground: colors.card,
                    textSectionTitleColor: colors.text,
                    selectedDayBackgroundColor: colors.primary,
                    selectedDayTextColor: '#ffffff',
                    todayTextColor: colors.accent,
                    dayTextColor: colors.text,
                    textDisabledColor: colors.border,
                    monthTextColor: colors.primary,
                    arrowColor: colors.primary,
                  }}
                />
              </Pressable>
            </Pressable>
          </Modal>
        )}
        
        {/* Date pickers */}
        {showStartTimePicker && (
          <DateTimePicker
            value={startTime}
            mode="time"
            is24Hour={false}
            display="default"
            onChange={(event, selectedDate) => {
              setShowStartTimePicker(false);
              if (selectedDate) {
                setStartTime(selectedDate);
              }
            }}
          />
        )}
        
        {showEndTimePicker && (
          <DateTimePicker
            value={endTime}
            mode="time"
            is24Hour={false}
            display="default"
            onChange={(event, selectedDate) => {
              setShowEndTimePicker(false);
              if (selectedDate) {
                setEndTime(selectedDate);
              }
            }}
          />
        )}
        
        {/* Tab content */}
        {activeTab === 'transactions' ? (
          /* Entries list */
          isLoading ? (
            <View style={styles.loadingContainer}>
              <Text style={[styles.loadingText, { color: colors.text }]}>
                Loading entries...
              </Text>
            </View>
          ) : entries.length === 0 && batches.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.text }]}>
                No entries found for this time range
              </Text>
            </View>
          ) : (
            <>
              {/* Summary Card */}
              <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: colors.text }]}>Cash In</Text>
                    <Text style={[styles.summaryValue, { color: colors.success }]}>
                      +₹{totals.cashIn.toLocaleString('en-IN')}
                    </Text>
                  </View>
                  
                  <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                  
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: colors.text }]}>Cash Out</Text>
                    <Text style={[styles.summaryValue, { color: colors.error }]}>
                      -₹{totals.cashOut.toLocaleString('en-IN')}
                    </Text>
                  </View>
                  
                  <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                  
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: colors.text }]}>Net Balance</Text>
                    <Text 
                      style={[
                        styles.summaryValue, 
                        { color: totals.net >= 0 ? colors.success : colors.error }
                      ]}
                    >
                      {totals.net >= 0 ? '+' : ''}₹{totals.net.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              </View>
              
              {/* Transaction Timeline - Mixed batches and individual entries by time */}
              <FlatList
                data={(() => {
                  // Create a unified timeline with both batches and individual entries
                  const timelineItems: Array<(BatchInfo & { itemType: 'batch', sortTime: Date }) | (Entry & { customer?: string, itemType: 'entry', sortTime: Date })> = [];
                  
                  // Add batches with their sort time
                  batches.forEach(batch => {
                    timelineItems.push({
                      ...batch,
                      itemType: 'batch' as const,
                      sortTime: new Date(batch.t0)
                    });
                  });
                  
                  // Add individual entries (excluding those that are part of displayed batches)
                  entries
                    .filter(entry => !isEntryInDisplayedBatch(entry))
                    .forEach(entry => {
                      timelineItems.push({
                        ...entry,
                        itemType: 'entry' as const,
                        sortTime: new Date(entry.transaction_date)
                      });
                    });
                  
                  // Sort the combined timeline by time (newest first)
                  timelineItems.sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime());
                  
                  return timelineItems;
                })()}
                renderItem={({ item }) => {
                  // Check if this is a batch item
                  if (item.itemType === 'batch') {
                    return (
                      <TransactionBatchCard 
                        batchId={item.batch_id}
                        rows={item.rows}
                        time={formatBatchTime(item.t0)}
                        onDeleteAll={() => handleDeleteBatch(item.batch_id)}
                        handleDeleteEntry={handleDeleteEntry}
                        onEdit={handleEditEntry}
                        isExpanded={expandedBatches.has(item.batch_id)}
                        onToggleExpand={() => toggleBatchExpand(item.batch_id)}
                        source_text={item.source_text}
                      />
                    );
                  }
                  
                  // Otherwise, render a regular entry
                  return renderItem({ item });
                }}
                keyExtractor={item => {
                  // For batches
                  if (item.itemType === 'batch') {
                    return `batch-${item.batch_id}`;
                  }
                  // For entries
                  return `entry-${item.id}`;
                }}
                contentContainerStyle={styles.listContent}
                style={styles.list}
              />
            </>
          )
        ) : (
          /* Pending tab */
          <PendingTab 
            selectedDate={selectedDate} 
            startTime={startTime}
            endTime={endTime}
            onPendingCountChanged={setPendingCount}
            handleDeleteEntry={handleDeleteEntry}
            navigation={navigation}
            parentRefreshTrigger={refreshTrigger}
          />
        )}
        
        {/* Custom Delete Confirmation Modal */}
        <DeleteConfirmationModal
          visible={deleteModalVisible}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
          isLoading={isDeleteLoading}
          itemDescription={entryToDelete?.description || ''}
        />
        
        {/* Add New Transaction Modal */}
        <Modal
          key={addModalKey}
          visible={addModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleAddCancel}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={handleAddCancel}
          >
            <Pressable style={styles.editModalContainer} onPress={e => e.stopPropagation()}>
              {addModalEntry && (
                <EditableTransactionCard
                  entry={addModalEntry}
                  isAddMode={true}
                  onCancel={handleAddCancel}
                  onConfirm={handleAddConfirm}
                  isLoading={isEditing}
                  navigation={navigation}
                  onNavigationStart={() => setIsNavigatingFromModal(true)}
                  onNavigationReturn={() => {
                    setIsNavigatingFromModal(false);
                    setAddModalKey(prev => prev + 1);
                  }}
                  onEntryChange={(updatedEntry) => {
                    setAddModalEntry(updatedEntry);
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
        
        {/* Edit Transaction Modal */}
        <Modal
          key={editModalKey}
          visible={editModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleEditCancel}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={!isNavigatingFromModal ? handleEditCancel : undefined}
            pointerEvents={isNavigatingFromModal ? 'none' : 'auto'}
          >
            <Pressable style={styles.editModalContainer} onPress={e => e.stopPropagation()}>
              {entryToEdit && (
                <EditableTransactionCard
                  entry={entryToEdit}
                  onCancel={handleEditCancel}
                  onConfirm={handleEditConfirm}
                  isLoading={isEditing}
                  navigation={navigation}
                  onNavigationStart={() => setIsNavigatingFromModal(true)}
                  onNavigationReturn={() => {
                    setIsNavigatingFromModal(false);
                    setEditModalKey(prev => prev + 1);
                  }}
                  onEntryChange={(updatedEntry) => {
                    setEntryToEdit(updatedEntry as Entry);
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
        
        {/* Snackbar for confirmation messages */}
        <Snackbar message="" />
      </View>
    </MainLayout>
  );
};