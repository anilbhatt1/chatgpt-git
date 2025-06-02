import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  StyleSheet, 
  TouchableOpacity,
  useColorScheme,
  Platform,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Entry } from '../state/types';
import { useTheme } from '../theme/ThemeContext';
import { lookupSimilarItems } from '../utils/sqliteStorage';
import { Feather } from '@expo/vector-icons';
import { showSnackbar } from './Snackbar';
import { useNavigation } from '@react-navigation/native';

interface EditableTransactionCardProps {
  entry?: Partial<Entry>; // Single entry (legacy)
  entries?: Partial<Entry>[]; // Multiple entries (new)
  onConfirm?: (entry: Partial<Entry>) => void; // Optional for single entry
  onConfirmMultiple?: (entries: Partial<Entry>[]) => void; // For multiple entries
  onCancel: () => void;
  warnings?: string[];
  isLoading?: boolean;
  navigation?: any; // Optional navigation prop
  onNavigationStart?: () => void; // Callback when navigating away
  onNavigationReturn?: () => void; // Callback when returning from navigation
  onEntryChange?: (entry: Partial<Entry>) => void; // Callback when entry changes internally
  // Add mode detection
  isAddMode?: boolean; // Explicitly set add mode, or auto-detect from entry.id
}

export const EditableTransactionCard: React.FC<EditableTransactionCardProps> = ({
  entry,
  entries,
  onConfirm,
  onConfirmMultiple,
  onCancel,
  warnings = [],
  isLoading = false,
  navigation,
  onNavigationStart,
  onNavigationReturn,
  onEntryChange,
  isAddMode
}) => {
  // Determine if we're in multi-item mode
  const isMultiMode = entries && entries.length > 0;
  const currentEntry = isMultiMode ? entries[0] : entry || {};
  
  // Determine if we're in add mode (no existing ID) or edit mode
  const isInAddMode = isAddMode || !currentEntry.id;
  
  // Create a full date object from the transaction_date string
  const getInitialDate = () => {
    if (currentEntry.transaction_date) {
      // If we have a transaction date, create a Date from it
      return new Date(currentEntry.transaction_date);
    }
    // Default to current date and time
    return new Date();
  };
  
  const [dateTimeObject, setDateTimeObject] = useState<Date>(getInitialDate());
  
  // For multi-mode, we'll manage an array of entries
  const [editedEntries, setEditedEntries] = useState<Partial<Entry>[]>(
    isMultiMode 
      ? entries.map(e => ({
          ...e,
          total: e.total || (e.qty && e.price ? e.qty * e.price : 0),
          transaction_date: e.transaction_date || new Date().toISOString(),
          type: e.type || 'cash-in'
        }))
      : []
  );
  
  const [editedEntry, setEditedEntry] = useState<Partial<Entry>>({
    ...currentEntry,
    // Calculate total if not provided
    total: currentEntry.total || (currentEntry.qty && currentEntry.price ? currentEntry.qty * currentEntry.price : 0),
    // Set transaction date to now if not provided
    transaction_date: currentEntry.transaction_date || new Date().toISOString(),
    // Set default type if not provided
    type: currentEntry.type || 'cash-in'
  });
  
  // For decimal input handling - single item mode
  const [qtyInput, setQtyInput] = useState(currentEntry.qty?.toString() || '');
  const [priceInput, setPriceInput] = useState(
    currentEntry.price ? currentEntry.price.toFixed(2) : ''
  );
  const [totalInput, setTotalInput] = useState(
    currentEntry.total ? currentEntry.total.toFixed(2) : ''
  );
  const [itemInput, setItemInput] = useState(currentEntry.item || '');
  
  // For multi-item input handling - store raw text inputs per item
  const [multiItemInputs, setMultiItemInputs] = useState<{[key: number]: {qtyInput: string, priceInput: string, totalInput: string}}>({});
  
  // Date picker state (simplified)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  
  // Track validation errors
  const [errors, setErrors] = useState<string[]>([]);
  
  // Get colors from theme context instead of using colorScheme directly
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';
  
  // Initialize multi-item inputs when entries change
  useEffect(() => {
    if (isMultiMode) {
      const initialInputs: {[key: number]: {qtyInput: string, priceInput: string, totalInput: string}} = {};
      editedEntries.forEach((entry, index) => {
        initialInputs[index] = {
          qtyInput: entry.qty?.toString() || '',
          priceInput: entry.price ? entry.price.toFixed(2) : '',
          totalInput: entry.total ? entry.total.toFixed(2) : ''
        };
      });
      setMultiItemInputs(initialInputs);
    }
  }, [isMultiMode, entries]);
  
  // Add refresh trigger to reload data after local changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Use ref to store the latest entry data to avoid race conditions
  const latestEntryRef = useRef<Partial<Entry>>(editedEntry);
  const latestEntriesRef = useRef<Partial<Entry>[]>(editedEntries);
  
  // Add ScrollView ref for auto-scrolling to new items
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Optimize: Update refs when state changes (no separate useEffect needed)
    latestEntryRef.current = editedEntry;
    latestEntriesRef.current = editedEntries;
  
  // Sync itemInput with entry prop changes (for when entry is updated externally)
  useEffect(() => {
    if (entry?.item !== undefined && entry.item !== itemInput) {
      setItemInput(entry.item);
    }
  }, [entry?.item]); // Remove itemInput from dependencies to prevent bouncing
  
  // Optimize: Handle entry prop changes more efficiently
  useEffect(() => {
    // Only update if entry has meaningful changes and isn't just undefined
    if (!entry) return;
    
    // Don't reset input fields if user is actively editing (entry has same id)
    const isSameEntry = entry.id && editedEntry.id === entry.id;
    const hasItemData = !!entry.item;
    const isInitialState = Object.keys(editedEntry).length <= 3;
    
    if ((hasItemData || isInitialState) && !isSameEntry) {
        const newEntry = {
          ...entry,
          total: entry.total || (entry.qty && entry.price ? entry.qty * entry.price : 0),
          transaction_date: entry.transaction_date || new Date().toISOString(),
          type: entry.type || 'cash-in'
        };
        
      // Batch all state updates for better performance
      setEditedEntry(newEntry);
        setItemInput(entry.item || '');
        setQtyInput(entry.qty?.toString() || '');
        setPriceInput(entry.price ? entry.price.toFixed(2) : '');
        setTotalInput(entry.total ? entry.total.toFixed(2) : '');
        
        if (entry.transaction_date) {
          setDateTimeObject(new Date(entry.transaction_date));
        }
      }
  }, [entry?.id, entry?.item, entry?.qty, entry?.price, entry?.total]); // Specific meaningful dependencies
  
  // Handle field changes
  const updateField = (field: keyof Entry, value: any) => {
    let parsedValue = value;
    
    // Parse numeric values
    if (field === 'qty' || field === 'price' || field === 'total') {
      // For these fields, just update the internal state but don't parse yet
      // This allows us to display the raw input including the decimal point
      if (field === 'qty') {
        setQtyInput(value);
        // Only parse for the actual entry when the value is valid
        if (value !== '' && !isNaN(parseFloat(value))) {
          parsedValue = parseFloat(value);
        } else {
          // Don't update the edited entry with invalid values
          return;
        }
      } else if (field === 'price') {
        setPriceInput(value);
        // Only parse for the actual entry when the value is valid
        if (value !== '' && !isNaN(parseFloat(value))) {
          parsedValue = Math.round(parseFloat(value) * 100) / 100;
        } else {
          // Don't update the edited entry with invalid values
          return;
        }
      } else if (field === 'total') {
        setTotalInput(value);
        // Only parse for the actual entry when the value is valid
        if (value !== '' && !isNaN(parseFloat(value))) {
          parsedValue = Math.round(parseFloat(value) * 100) / 100;
        } else {
          // Don't update the edited entry with invalid values
          return;
        }
      }
      
      // Recalculate values based on what changed
      const updatedEntry = {
        ...editedEntry,
        [field]: parsedValue
      };
      
      // If total changed, recalculate price based on qty
      if (field === 'total') {
        const qty = editedEntry.qty || 0;
        if (qty > 0) {
          // Calculate new price based on total and qty
          const newPrice = Math.round((parsedValue / qty) * 100) / 100;
          updatedEntry.price = newPrice;
          setPriceInput(newPrice.toFixed(2));
        }
      } 
      // If qty or price changed, recalculate total
      else {
      const qty = field === 'qty' ? parsedValue : (editedEntry.qty || 0);
      const price = field === 'price' ? parsedValue : (editedEntry.price || 0);
      
        const newTotal = Math.round((qty * price) * 100) / 100;
        updatedEntry.total = newTotal;
        setTotalInput(newTotal.toFixed(2));
      }
      
      setEditedEntry(updatedEntry);
      // Ref is updated automatically in render - no need for manual update
      return;
    }
    
    // If updating transaction_date directly, just set it
    if (field === 'transaction_date') {
      const newEntry = {
        ...editedEntry,
        [field]: parsedValue
      };
      setEditedEntry(newEntry);
      // Ref is updated automatically in render - no need for manual update
      return;
    }
    
    const newEntry = {
      ...editedEntry,
      [field]: parsedValue
    };
    setEditedEntry(newEntry);
    // Ref is updated automatically in render - no need for manual update
    return;
  };
  
  // Handle field changes for multi-item mode
  const updateMultiItemField = (itemIndex: number, field: keyof Entry, value: any) => {
    // For numeric fields, handle input state and calculations immediately
    if (field === 'qty' || field === 'price' || field === 'total') {
      // Update input state immediately for responsive UI
      const newInputs = {
        ...multiItemInputs,
        [itemIndex]: { 
          ...multiItemInputs[itemIndex], 
          [`${field}Input`]: value 
        }
      };
      setMultiItemInputs(newInputs);
      
      // Update entries state immediately for calculations
      const updatedEntries = [...editedEntries];
      
      if (value === '') {
        // Allow empty values - set to 0 for calculations
        updatedEntries[itemIndex] = {
          ...updatedEntries[itemIndex],
          [field]: 0
        };
      } else if (!isNaN(parseFloat(value))) {
        const parsedValue = field === 'qty' ? parseFloat(value) : Math.round(parseFloat(value) * 100) / 100;
        updatedEntries[itemIndex] = {
          ...updatedEntries[itemIndex],
          [field]: parsedValue
        };
        
        // Recalculate dependent values immediately
        if (field === 'total') {
          const qty = updatedEntries[itemIndex].qty || 0;
          if (qty > 0) {
            const newPrice = Math.round((parsedValue / qty) * 100) / 100;
            updatedEntries[itemIndex].price = newPrice;
            newInputs[itemIndex].priceInput = newPrice.toFixed(2);
          }
        } else {
          // Recalculate total immediately
          const qty = field === 'qty' ? parsedValue : (updatedEntries[itemIndex].qty || 0);
          const price = field === 'price' ? parsedValue : (updatedEntries[itemIndex].price || 0);
          const newTotal = Math.round((qty * price) * 100) / 100;
          updatedEntries[itemIndex].total = newTotal;
          newInputs[itemIndex].totalInput = newTotal.toFixed(2);
        }
      } else {
        // Invalid input - don't update entry, just return
        return;
      }
      
      // Update both states in one batch
      setMultiItemInputs(newInputs);
      setEditedEntries(updatedEntries);
      
      // Ref is updated automatically in render - no need for manual update
    } else {
      // For non-numeric fields, update immediately
      const updatedEntries = [...editedEntries];
      updatedEntries[itemIndex] = {
        ...updatedEntries[itemIndex],
        [field]: value
      };
      setEditedEntries(updatedEntries);
      // Ref is updated automatically in render - no need for manual update
    }
  };
  
  // Handle similar items lookup for multi-item mode
  const handleMultiItemSimilarLookup = async (itemIndex: number) => {
    const item = editedEntries[itemIndex];
    if (!item.item || item.item.trim() === '') {
      return;
    }

    try {
      const similar = await lookupSimilarItems(item.item);
      
      if (similar.length > 0) {
        // If navigation is available, go to similar items screen for user selection
        if (navigation) {
          onNavigationStart?.();
          
          navigation.navigate('SimilarItemsScreen', {
            entryData: item,
            onSelect: (updatedEntry: Partial<Entry>) => {
              onNavigationReturn?.();
              
              // Update the specific item in the array
              const updatedEntries = [...latestEntriesRef.current];
              updatedEntries[itemIndex] = {
                ...updatedEntries[itemIndex],
                ...updatedEntry,
                total: (updatedEntry.qty || updatedEntries[itemIndex].qty || 0) * (updatedEntry.price || 0)
              };
              
              setEditedEntries(updatedEntries);
              
              // Ref is updated automatically in render - no need for manual update
              
              // Update input states for UI display
              setMultiItemInputs(prev => ({
                ...prev,
                [itemIndex]: {
                  ...prev[itemIndex],
                  priceInput: updatedEntry.price ? updatedEntry.price.toFixed(2) : '',
                  totalInput: updatedEntries[itemIndex].total ? updatedEntries[itemIndex].total.toFixed(2) : ''
                }
              }));
            },
            onCancel: () => {
              onNavigationReturn?.();
            }
          });
        }
      } else {
        // Show feedback when no similar items found
        showSnackbar(`No similar items found for "${item.item}"`, 'info');
      }
    } catch (error) {
      console.error('Error looking up similar items:', error);
      showSnackbar('Error searching for similar items');
    }
  };

  // Add new item to multi-item list
  const addNewItem = () => {
    const newItem: Partial<Entry> = {
      item: '',
      qty: 1,
      unit: 'pcs',
      price: 0,
      total: 0,
      type: 'cash-in',
      transaction_date: editedEntries[0]?.transaction_date || new Date().toISOString()
    };
    
    const newEntries = [...editedEntries, newItem];
    setEditedEntries(newEntries);
    
    // Initialize input state for new item
    const newIndex = editedEntries.length;
    setMultiItemInputs(prev => ({
      ...prev,
      [newIndex]: {
        qtyInput: '1',
        priceInput: '',
        totalInput: ''
      }
    }));
    
    // Auto-scroll to the newly added entry
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Delete item from multi-item list
  const deleteItem = (indexToDelete: number) => {
    // Prevent deleting the last item
    if (editedEntries.length <= 1) {
      setErrors(['Cannot delete the last item. At least one item is required.']);
      return;
    }
    
    const newEntries = editedEntries.filter((_, index) => index !== indexToDelete);
    setEditedEntries(newEntries);
    
    // Clean up and reindex multiItemInputs
    const newInputs: {[key: number]: {qtyInput: string, priceInput: string, totalInput: string}} = {};
    newEntries.forEach((entry, newIndex) => {
      const oldIndex = newIndex >= indexToDelete ? newIndex + 1 : newIndex;
      if (multiItemInputs[oldIndex]) {
        newInputs[newIndex] = multiItemInputs[oldIndex];
      } else {
        newInputs[newIndex] = {
          qtyInput: entry.qty?.toString() || '',
          priceInput: entry.price ? entry.price.toFixed(2) : '',
          totalInput: entry.total ? entry.total.toFixed(2) : ''
        };
      }
    });
    setMultiItemInputs(newInputs);
    
    // Clear any deletion-related errors
    if (errors.some(error => error.includes('Cannot delete'))) {
      setErrors(errors.filter(error => !error.includes('Cannot delete')));
    }
  };
  
  // Validate entry before confirming
  const validateAndConfirm = async () => {
    if (isMultiMode) {
      // For multi-mode, validate all entries using the latest ref data
      const currentEntries = latestEntriesRef.current;
      const allErrors: string[] = [];
      
      currentEntries.forEach((entry, index) => {
        if (!entry.item || entry.item.trim() === '') {
          allErrors.push(`Item ${index + 1}: Name is required`);
        }
        if (!entry.qty || entry.qty <= 0) {
          allErrors.push(`Item ${index + 1}: Quantity must be greater than zero`);
        }
        if (!entry.price || entry.price < 0) {
          allErrors.push(`Item ${index + 1}: Price cannot be negative`);
        }
      });
      
      if (allErrors.length > 0) {
        setErrors(allErrors);
        return;
      }
      
      setErrors([]);
      if (onConfirmMultiple) {
        try {
          // Generate a unique batch_id for all entries
          const batchId = `multi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Ensure all entries have the same batch_id and source_text
          const entriesWithBatch = currentEntries.map(entry => ({
            ...entry,
            batch_id: batchId,
            source_text: entry.source_text || `Multiple items: ${currentEntries.map(e => e.item).join(', ')}`
          }));
          
          await onConfirmMultiple(entriesWithBatch);
          
        } catch (error) {
        }
      }
    } else {
      // Single entry validation using the latest ref data
      const currentEntry = latestEntryRef.current;
    const validationErrors: string[] = [];
    
      if (!currentEntry.item || currentEntry.item.trim() === '') {
      validationErrors.push('Item name is required');
    }
    
      if (!currentEntry.qty || currentEntry.qty <= 0) {
      validationErrors.push('Quantity must be greater than zero');
    }
    
      if (!currentEntry.price || currentEntry.price < 0) {
      validationErrors.push('Price cannot be negative');
    }
    
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setErrors([]);
      if (onConfirm) {
        try {
          // For add mode, ensure confirmed is set appropriately
          const entryToSubmit = isInAddMode 
            ? { ...currentEntry, confirmed: true }
            : currentEntry;
            
          await onConfirm(entryToSubmit);
        } catch (error) {
        }
      }
    }
  };
  
  // Handle date change
  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    
    if (selectedDate && event.type !== 'dismissed') {
      let newDateTime = new Date(dateTimeObject);
      
        // Update only the date portion, preserve time
      newDateTime.setFullYear(selectedDate.getFullYear());
      newDateTime.setMonth(selectedDate.getMonth());
      newDateTime.setDate(selectedDate.getDate());
      
      setDateTimeObject(newDateTime);
      
      if (isMultiMode) {
        // Update all entries with the new date/time
        const updatedEntries = editedEntries.map(entry => ({
          ...entry,
          transaction_date: newDateTime.toISOString()
        }));
        setEditedEntries(updatedEntries);
        // Ref is updated automatically in render - no need for manual update
      } else {
        // Update the single entry
      updateField('transaction_date', newDateTime.toISOString());
      }
    }
  };

  // Handle time change
  const onTimeChange = (event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    
    if (selectedTime && event.type !== 'dismissed') {
      let newDateTime = new Date(dateTimeObject);
      
      // Update only the time portion, preserve date
      newDateTime.setHours(selectedTime.getHours());
      newDateTime.setMinutes(selectedTime.getMinutes());
      
      setDateTimeObject(newDateTime);
      
      if (isMultiMode) {
        // Update all entries with the new date/time
        const updatedEntries = editedEntries.map(entry => ({
          ...entry,
          transaction_date: newDateTime.toISOString()
        }));
        setEditedEntries(updatedEntries);
        // Ref is updated automatically in render - no need for manual update
      } else {
        // Update the single entry
      updateField('transaction_date', newDateTime.toISOString());
      }
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };
  
  // Format time for display
  const formatTime = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12; // Convert 0 to 12 for 12 AM
    return `${displayHours}:${minutes} ${ampm}`;
  };
  
  return (
    <View style={[
      styles.container, 
      { backgroundColor: colors.card }
    ]}>
      {/* Header - only show for add mode */}
      {isInAddMode && (
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            Add Transaction
          </Text>
        </View>
      )}
      
      {/* Loading overlay to freeze the entire form */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: '#FFFFFF' }]}>
            {isMultiMode 
              ? 'Confirming multiple items...' 
              : isInAddMode 
                ? 'Adding transaction...'
                : 'Confirming transaction...'
            }
          </Text>
        </View>
      )}
      
      {/* Multi-item header */}
      {isMultiMode && (
        <View style={styles.multiHeader}>
          <Text style={[styles.multiTitle, { color: colors.primary }]}>
            Multiple Cash Items ({editedEntries.length})
          </Text>
          <Text style={[styles.multiSubtitle, { color: colors.text + '80' }]}>
            Review and edit items below
          </Text>
          
          {/* Date & Time for all items */}
          <View style={styles.multiDateTimeRow}>
            <View style={[styles.multiFieldColumn, { flex: 1 }]}>
              <Text style={[styles.multiLabel, { color: colors.text }]}>Date</Text>
              <TouchableOpacity
                style={[
                  styles.multiInput,
                  styles.multiDateInput,
                  { 
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border
                  }
                ]}
                onPress={() => setShowDatePicker(true)}
                disabled={isLoading}
              >
                <Text style={[
                  styles.multiDateText,
                  { color: colors.text }
                ]}>
                  {formatDate(editedEntries[0]?.transaction_date || '')}
                </Text>
                <Text style={[
                  styles.multiDateIcon,
                  { color: colors.text }
                ]}>
                  📅
                </Text>
              </TouchableOpacity>
            </View>
            
            <View style={[styles.multiFieldColumn, { flex: 0.8 }]}>
              <Text style={[styles.multiLabel, { color: colors.text }]}>Time</Text>
              <TouchableOpacity
                style={[
                  styles.multiInput,
                  styles.multiDateInput,
                  { 
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border
                  }
                ]}
                onPress={() => setShowTimePicker(true)}
                disabled={isLoading}
              >
                <Text style={[
                  styles.multiDateText,
                  { color: colors.text }
                ]}>
                  {formatTime(editedEntries[0]?.transaction_date || '')}
                </Text>
                <Text style={[
                  styles.multiDateIcon,
                  { color: colors.text }
                ]}>
                  🕒
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      
      {/* Multi-item list */}
      {isMultiMode && (
        <ScrollView style={styles.multiItemsList} showsVerticalScrollIndicator={true} ref={scrollViewRef}>
          {editedEntries.map((item, index) => (
            <View key={index} style={[styles.multiItemCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {/* Item Name field */}
              <View style={styles.multiFieldRow}>
                <Text style={[styles.multiLabel, { color: colors.text }]}>Item</Text>
                <View style={styles.multiInputContainer}>
                  <TextInput
                    style={[
                      styles.multiInput,
                      { 
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text
                      }
                    ]}
                    value={item.item}
                    onChangeText={(text) => {
                      updateMultiItemField(index, 'item', text);
                    }}
                    placeholder="Item name"
                    placeholderTextColor={isDark ? '#777' : '#ccc'}
                    editable={!isLoading}
                  />
                  <TouchableOpacity 
                    style={styles.multiInfoButton}
                    onPress={() => handleMultiItemSimilarLookup(index)}
                    disabled={isLoading}
                  >
                    <Feather 
                      name="search" 
                      size={16} 
                      color={colors.primary} 
                    />
                    <Text style={[styles.multiInfoButtonText, { color: colors.primary }]}>Find</Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* Qty, Unit, Price row */}
              <View style={styles.multiFieldRow}>
                <View style={[styles.multiFieldColumn, { flex: 0.6 }]}>
                  <Text style={[styles.multiLabel, { color: colors.text }]}>Qty</Text>
                  <TextInput
                    style={[
                      styles.multiInput,
                      { 
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text
                      }
                    ]}
                    value={multiItemInputs[index]?.qtyInput || item.qty?.toString() || ''}
                    onChangeText={(text) => {
                      if (text === '' || /^\d*\.?\d*$/.test(text)) {
                        updateMultiItemField(index, 'qty', text);
                      }
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={isDark ? '#777' : '#ccc'}
                    editable={!isLoading}
                  />
                </View>
                
                <View style={[styles.multiFieldColumn, { flex: 1.2 }]}>
                  <Text style={[styles.multiLabel, { color: colors.text }]}>Unit</Text>
                  <TextInput
                    style={[
                      styles.multiInput,
                      { 
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text
                      }
                    ]}
                    value={item.unit}
                    onChangeText={(text) => updateMultiItemField(index, 'unit', text)}
                    placeholder="unit"
                    placeholderTextColor={isDark ? '#777' : '#ccc'}
                    editable={!isLoading}
                  />
                </View>
                
                <View style={[styles.multiFieldColumn, { flex: 0.8 }]}>
                  <Text style={[styles.multiLabel, { color: colors.text }]}>Price</Text>
                  <TextInput
                    style={[
                      styles.multiInput,
                      { 
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: colors.text
                      }
                    ]}
                    value={multiItemInputs[index]?.priceInput || (item.price ? item.price.toFixed(2) : '')}
                    onChangeText={(text) => {
                      if (text === '' || /^\d*\.?\d{0,2}$/.test(text)) {
                        updateMultiItemField(index, 'price', text);
                      }
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={isDark ? '#777' : '#ccc'}
                    editable={!isLoading}
                  />
                </View>
              </View>
              
              {/* Total Price row */}
              <View style={styles.multiFieldRow}>
                <View style={[styles.multiFieldColumn, { flex: 1 }]}>
                  <Text style={[styles.multiLabel, { color: colors.text }]}>Total</Text>
                  <TextInput
                    style={[
                      styles.multiInput,
                      styles.multiTotalInput,
                      { 
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        color: item.total ? (item.type === 'cash-in' ? colors.success : colors.error) : colors.text,
                        textAlign: 'center',
                        fontWeight: 'bold'
                      }
                    ]}
                    value={multiItemInputs[index]?.totalInput || (item.total ? item.total.toFixed(2) : '')}
                    onChangeText={(text) => {
                      if (text === '' || /^\d*\.?\d{0,2}$/.test(text)) {
                        updateMultiItemField(index, 'total', text);
                      }
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={isDark ? '#777' : '#ccc'}
                    editable={!isLoading}
                  />
                </View>
                
                {/* Type selector for this item */}
                <View style={[styles.multiFieldColumn, { flex: editedEntries.length > 1 ? 1.5 : 1.2 }]}>
                  <Text style={[styles.multiLabel, { color: colors.text }]}>Type</Text>
                  <View style={styles.multiTypeSelector}>
                    <TouchableOpacity
                      style={[
                        styles.multiTypeButton,
                        item.type === 'cash-in' ? 
                          { backgroundColor: colors.primary, borderColor: colors.primary } : 
                          { backgroundColor: colors.inputBackground, borderColor: colors.border }
                      ]}
                      onPress={() => updateMultiItemField(index, 'type', 'cash-in')}
                      disabled={isLoading}
                    >
                      <Text style={[
                        styles.multiTypeText,
                        item.type === 'cash-in' ? 
                          { color: '#fff' } : 
                          { color: colors.text }
                      ]}>
                        Cash In
                      </Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={[
                        styles.multiTypeButton,
                        item.type === 'cash-out' ? 
                          { backgroundColor: colors.primary, borderColor: colors.primary } : 
                          { backgroundColor: colors.inputBackground, borderColor: colors.border }
                      ]}
                      onPress={() => updateMultiItemField(index, 'type', 'cash-out')}
                      disabled={isLoading}
                    >
                      <Text style={[
                        styles.multiTypeText,
                        item.type === 'cash-out' ? 
                          { color: '#fff' } : 
                          { color: colors.text }
                      ]}>
                        Cash Out
                      </Text>
                    </TouchableOpacity>
                    
                    {/* Delete button - positioned as third button in Type area */}
                    {editedEntries.length > 1 && (
                      <TouchableOpacity
                        style={[
                          styles.multiDeleteButtonInType, 
                          { 
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.border
                          }
                        ]}
                        onPress={() => deleteItem(index)}
                        disabled={isLoading}
                        accessibilityLabel={`Delete item ${index + 1}`}
                      >
                        <Text style={[styles.multiDeleteButtonText, { color: colors.error, fontSize: 14 }]}>🗑️</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      
      {/* Add New Item button - only show in multi-mode */}
      {isMultiMode && (
        <View style={styles.addNewItemContainer}>
          <TouchableOpacity
            style={styles.addNewItemButton}
            onPress={addNewItem}
            disabled={isLoading}
            accessibilityLabel="Add new item"
          >
            <Feather name="plus" size={16} color="#4A90E2" />
            <Text style={styles.addNewItemText}>Add New Item</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Single item fields - only show when not in multi-mode */}
      {!isMultiMode && (
        <>
      {/* Item field */}
      <View style={styles.fieldRow}>
        <Text style={[
          styles.label, 
          { color: colors.text }
        ]}>
          Item
        </Text>
        <View style={styles.inputContainer}>
        <TextInput
          style={[
            styles.input,
            { 
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text
            }
          ]}
          value={itemInput}
          onChangeText={(text) => {
            setItemInput(text);
            updateField('item', text);
          }}
          placeholder="Item name"
          placeholderTextColor={isDark ? '#777' : '#ccc'}
          editable={!isLoading}
        />
          <TouchableOpacity 
            style={styles.infoButton}
            onPress={async () => {
              if (!editedEntry.item || editedEntry.item.trim() === '') {
                return;
              }
              
              try {
                // First check if there are similar items
                const items = await lookupSimilarItems(editedEntry.item);
                
                // Only navigate if we found similar items
                if (items.length > 0) {
                  // If navigation is available, go to similar items screen
                  if (navigation) {
                    onNavigationStart?.();
                    
                    navigation.navigate('SimilarItemsScreen', {
                      entryData: editedEntry,
                      onSelect: (updatedEntry: Partial<Entry>) => {
                        onNavigationReturn?.();
                        
                        // Merge updated entry with existing entry to preserve all fields
                        const mergedEntry = {
                          ...latestEntryRef.current,
                          ...updatedEntry
                        };
                        
                        // Update the edited entry with the merged data
                        setEditedEntry(mergedEntry);
                        
                        // Parent modal re-rendering handles UI updates efficiently
                        // No need for additional force re-rendering here
                        
                        // Notify parent of the change
                        if (onEntryChange) {
                          onEntryChange(mergedEntry);
                        }
                        
                        // Update input fields to reflect the changes
                        if (updatedEntry.item !== undefined) {
                          setItemInput(updatedEntry.item);
                        }
                        
                        if (updatedEntry.price !== undefined) {
                          setPriceInput(updatedEntry.price.toFixed(2));
                        }
                        
                        if (updatedEntry.total !== undefined) {
                          setTotalInput(updatedEntry.total.toFixed(2));
                        }
                        
                        // Also update qty input if it changed
                        if (updatedEntry.qty !== undefined) {
                          setQtyInput(updatedEntry.qty.toString());
                        }
                        
                        // Clear any existing errors since we're updating with valid data
                        setErrors([]);
                      },
                      onCancel: () => {
                        onNavigationReturn?.();
                      }
                    });
                  }
                } else {
                  // Show feedback when no similar items found
                  showSnackbar(`No similar items found for "${editedEntry.item}"`, 'info');
                }
              } catch (error) {
                console.error('Error looking up similar items:', error);
                showSnackbar('Error searching for similar items');
              }
            }}
            disabled={isLoading}
          >
            <Feather 
              name="search" 
              size={18} 
              color={colors.primary} 
            />
            <Text style={[styles.infoButtonText, { color: colors.primary }]}>Find</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Quantity, Unit, Price fields in one row */}
      <View style={styles.fieldRow}>
        {/* Qty field */}
        <View style={[styles.fieldColumn, { flex: 0.6 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Qty
          </Text>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text
              }
            ]}
            value={qtyInput}
            onChangeText={(text) => {
              // Allow only numbers and a single decimal point
              if (text === '' || /^\d*\.?\d*$/.test(text)) {
                setQtyInput(text);
                if (text !== '' && !isNaN(parseFloat(text))) {
                  updateField('qty', text);
                }
              }
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={isDark ? '#777' : '#ccc'}
            editable={!isLoading}
          />
        </View>
        
        {/* Unit field */}
        <View style={[styles.fieldColumn, { flex: 1.8 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Unit
          </Text>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text
              }
            ]}
            value={editedEntry.unit}
            onChangeText={(text) => updateField('unit', text)}
            placeholder="unit"
            placeholderTextColor={isDark ? '#777' : '#ccc'}
            editable={!isLoading}
          />
      </View>
      
        {/* Price field */}
        <View style={[styles.fieldColumn, { flex: 0.8 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Price
          </Text>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text
              }
            ]}
            value={priceInput}
            onChangeText={(text) => {
              // Allow only numbers and up to 2 decimal places
              if (text === '' || /^\d*\.?\d{0,2}$/.test(text)) {
                setPriceInput(text);
                if (text !== '' && !isNaN(parseFloat(text))) {
                  updateField('price', text);
                }
              }
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={isDark ? '#777' : '#ccc'}
            editable={!isLoading}
          />
        </View>
      </View>
      
      {/* Date, Time and Total fields in one row */}
      <View style={styles.fieldRow}>
        {/* Date field */}
        <View style={[styles.fieldColumn, { flex: 0.85 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Date
          </Text>
          <TouchableOpacity
            style={[
              styles.input,
              styles.dateInput,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border
              }
            ]}
            onPress={() => setShowDatePicker(true)}
            disabled={isLoading}
          >
            <Text style={[
              styles.dateText,
              { color: colors.text }
            ]}>
              {formatDate(editedEntry.transaction_date || '')}
            </Text>
            <Text style={[
              styles.dateIcon,
              { color: colors.text }
            ]}>
              📅
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Time field */}
        <View style={[styles.fieldColumn, { flex: 0.65 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Time
          </Text>
          <TouchableOpacity
            style={[
              styles.input,
              styles.dateInput,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border
              }
            ]}
            onPress={() => setShowTimePicker(true)}
            disabled={isLoading}
          >
            <Text style={[
              styles.dateText,
              { color: colors.text }
            ]}>
              {formatTime(editedEntry.transaction_date || '')}
            </Text>
            <Text style={[
              styles.dateIcon,
              { color: colors.text }
            ]}>
              🕒
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Total field */}
        <View style={[styles.fieldColumn, { flex: 0.8 }]}>
          <Text style={[
            styles.label, 
            { color: colors.text }
          ]}>
            Total Price
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.totalInput,
              { 
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: editedEntry.total ? (editedEntry.type === 'cash-in' ? colors.success : colors.error) : colors.text,
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: 15
              }
            ]}
            value={totalInput}
            onChangeText={(text) => {
              // Allow only numbers and up to 2 decimal places
              if (text === '' || /^\d*\.?\d{0,2}$/.test(text)) {
                updateField('total', text);
              }
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={isDark ? '#777' : '#ccc'}
            editable={!isLoading}
          />
        </View>
      </View>
      
      {/* Type selection */}
      <View style={styles.fieldRow}>
        <Text style={[
          styles.label, 
          { color: colors.text }
        ]}>
          Type
          </Text>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                editedEntry.type === 'cash-in' ? 
                  { backgroundColor: colors.primary, borderColor: colors.primary } : 
                  { backgroundColor: colors.inputBackground, borderColor: colors.border }
              ]}
              onPress={() => updateField('type', 'cash-in')}
              disabled={isLoading}
            >
              <Text style={[
                styles.typeText,
                editedEntry.type === 'cash-in' ? 
                  { color: '#fff' } : 
                  { color: colors.text }
              ]}>
                Cash In
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.typeButton,
                editedEntry.type === 'cash-out' ? 
                  { backgroundColor: colors.primary, borderColor: colors.primary } : 
                  { backgroundColor: colors.inputBackground, borderColor: colors.border }
              ]}
              onPress={() => updateField('type', 'cash-out')}
              disabled={isLoading}
            >
              <Text style={[
                styles.typeText,
                editedEntry.type === 'cash-out' ? 
                  { color: '#fff' } : 
                  { color: colors.text }
              ]}>
                Cash Out
              </Text>
            </TouchableOpacity>
          </View>
      </View>
        </>
      )}
      
      {/* Date Picker */}
      {showDatePicker && (
                <DateTimePicker
                  value={dateTimeObject}
                  mode="date"
                  display="default"
          onChange={onDateChange}
                  textColor={isDark ? '#fff' : '#000'}
                />
      )}
      
      {/* Time Picker */}
      {showTimePicker && (
                <DateTimePicker
                  value={dateTimeObject}
                  mode="time"
          is24Hour={false}
                  display="default"
          onChange={onTimeChange}
                  textColor={isDark ? '#fff' : '#000'}
                />
      )}
      
      {/* Warning messages */}
      {warnings.length > 0 && (
        <View style={styles.warningsContainer}>
          {warnings.map((warning, index) => (
            <Text key={index} style={styles.warningText}>
              ⚠️ {warning}
            </Text>
          ))}
        </View>
      )}
      
      {/* Validation errors */}
      {errors.length > 0 && (
        <View style={styles.errorsContainer}>
          {errors.map((error, index) => (
            <Text key={index} style={styles.errorText}>
              ❌ {error}
            </Text>
          ))}
        </View>
      )}
      
      {/* Action buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.secondary }]}
          onPress={onCancel}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.button, 
            { backgroundColor: isLoading ? colors.disabled : colors.success }
          ]}
          onPress={validateAndConfirm}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {isInAddMode ? 'Add' : 'Confirm'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 5,
    paddingBottom: 2,
    borderRadius: 8,
    marginVertical: 0,
    width: '100%',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'center',
  },
  fieldColumn: {
    flex: 1,
    marginHorizontal: 2,
  },
  inputContainer: {
    flex: 1,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
    width: 65,
    marginLeft: 8,
  },
  input: {
    height: 36,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
  },
  typeSelector: {
    flexDirection: 'row',
    height: 36,
    flex: 1,
    marginLeft: 8,
  },
  typeButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    marginHorizontal: 2,
    height: 36,
  },
  typeText: {
    fontWeight: '600',
    fontSize: 14,
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    flex: 1,
    fontSize: 12,
  },
  dateIcon: {
    marginLeft: 4,
    fontSize: 14,
  },
  totalInput: {
    textAlign: 'center',
    fontWeight: 'bold',
  },
  warningsContainer: {
    marginTop: 4,
    paddingVertical: 2,
  },
  warningText: {
    color: '#FF9500',
    marginVertical: 1,
  },
  errorsContainer: {
    marginTop: 4,
    paddingVertical: 2,
  },
  errorText: {
    color: '#FF3B30',
    marginVertical: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 1,
  },
  button: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    zIndex: 10,
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 10,
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoButton: {
    position: 'absolute',
    right: 10,
    top: 8,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  infoButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  multiHeader: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  multiTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  multiSubtitle: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  multiItemsList: {
    maxHeight: 200,
    marginBottom: 12,
  },
  multiItemCard: {
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  multiItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  multiItemName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  multiItemTotal: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  multiItemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  multiItemDetail: {
    fontSize: 12,
    marginRight: 8,
  },
  multiFieldRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'center',
  },
  multiFieldColumn: {
    flex: 1,
    marginHorizontal: 2,
  },
  multiInputContainer: {
    flex: 1,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  multiLabel: {
    fontWeight: '600',
    fontSize: 11,
    width: 50,
    marginLeft: 4,
  },
  multiInput: {
    height: 32,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  multiTotalInput: {
    textAlign: 'center',
    fontWeight: 'bold',
  },
  multiTypeSelector: {
    flexDirection: 'row',
    height: 32,
    flex: 1,
    marginLeft: 8,
  },
  multiTypeButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    marginHorizontal: 1,
    height: 32,
  },
  multiTypeText: {
    fontWeight: '600',
    fontSize: 9,
  },
  multiInfoButton: {
    position: 'absolute',
    right: 8,
    top: 6,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  multiInfoButtonText: {
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  multiDateTimeRow: {
    flexDirection: 'row',
    marginTop: 12,
    alignItems: 'center',
  },
  multiDateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  multiDateText: {
    flex: 1,
    fontSize: 11,
  },
  multiDateIcon: {
    marginLeft: 4,
    fontSize: 12,
  },
  header: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  multiDeleteButtonInType: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    marginHorizontal: 1,
    height: 32,
  },
  multiDeleteButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  addNewItemContainer: {
    marginTop: 12,
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  addNewItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: 1,
    borderRadius: 4,
    backgroundColor: '#F0F8FF',
  },
  addNewItemText: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
    color: '#4A90E2',
  },
}); 