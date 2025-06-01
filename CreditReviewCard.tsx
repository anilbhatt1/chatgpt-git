import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

interface CreditItem {
  item: string;
  qty: number;
  unit: string;
  price: number;
  total: number;
}

interface CreditData {
  type: 'sale' | 'payment';
  customer: string;
  amount?: number;
  // Single item fields (for backward compatibility)
  item?: string;
  qty?: number;
  unit?: string;
  price?: number;
  // Multi-item fields (for new functionality)
  items?: CreditItem[];
}

interface CreditReviewCardProps {
  creditData: CreditData;
  sourceText: string;
  warnings: string[];
  onConfirm: (creditData: CreditData) => Promise<void>;
  onCancel: () => void;
  navigation?: any; // For Find Similar Items functionality
}

export function CreditReviewCard({
  creditData,
  sourceText,
  warnings,
  onConfirm,
  onCancel,
  navigation
}: CreditReviewCardProps) {
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [editingData, setEditingData] = useState<CreditData>(creditData);

  // Determine if this is a multi-item transaction
  const isMultiItem = editingData.items && editingData.items.length > 0;
  const hasItems = isMultiItem || editingData.item;

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm(editingData);
    } catch (error) {
      console.error('Error confirming credit:', error);
      Alert.alert('Error', 'Failed to save credit transaction');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₹${amount.toFixed(2)}`;
  };

  const getTransactionTitle = () => {
    if (editingData.type === 'sale') {
      return 'Credit Sale';
    } else {
      return 'Credit Payment';
    }
  };

  const getTransactionIcon = () => {
    if (editingData.type === 'sale') {
      return 'card-outline';
    } else {
      return 'cash-outline';
    }
  };

  const getTransactionColor = () => {
    if (editingData.type === 'sale') {
      return colors.error; // Red for credit (money owed)
    } else {
      return colors.success; // Green for payment (money received)
    }
  };

  // Update customer name
  const updateCustomer = (customer: string) => {
    setEditingData({ ...editingData, customer });
  };

  // Update payment amount
  const updateAmount = (amountText: string) => {
    const amount = parseFloat(amountText) || 0;
    setEditingData({ ...editingData, amount });
  };

  // Update single item data
  const updateSingleItem = (field: string, value: any) => {
    const updatedData = { ...editingData, [field]: value };
    
    // Recalculate total for single item
    if (field === 'qty' || field === 'price') {
      const qty = field === 'qty' ? value : (updatedData.qty || 1);
      const price = field === 'price' ? value : (updatedData.price || 0);
      updatedData.amount = qty * price;
    }
    
    setEditingData(updatedData);
  };

  // Update multi-item data
  const updateMultiItem = (index: number, field: string, value: any) => {
    if (!editingData.items) return;
    
    const updatedItems = [...editingData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    
    // Recalculate total for this item
    if (field === 'qty' || field === 'price') {
      const qty = field === 'qty' ? value : updatedItems[index].qty;
      const price = field === 'price' ? value : updatedItems[index].price;
      updatedItems[index].total = qty * price;
    }
    
    // Recalculate overall amount
    const totalAmount = updatedItems.reduce((sum, item) => sum + item.total, 0);
    
    setEditingData({
      ...editingData,
      items: updatedItems,
      amount: totalAmount
    });
  };

  // Remove item from multi-item transaction
  const removeItem = (index: number) => {
    if (!editingData.items || editingData.items.length <= 1) return;
    
    const updatedItems = editingData.items.filter((_, i) => i !== index);
    const totalAmount = updatedItems.reduce((sum, item) => sum + item.total, 0);
    
    setEditingData({
      ...editingData,
      items: updatedItems,
      amount: totalAmount
    });
  };

  // Find Similar Items functionality
  const handleFindSimilar = (itemName: string, itemIndex?: number) => {
    if (!navigation) return;
    
    const entryData = isMultiItem && typeof itemIndex === 'number' 
      ? { item: editingData.items![itemIndex].item }
      : { item: editingData.item };
    
    navigation.navigate('SimilarItemsScreen', {
      entryData,
      onSelect: (updatedEntry: any) => {
        if (isMultiItem && typeof itemIndex === 'number') {
          // Update specific item in multi-item transaction
          updateMultiItem(itemIndex, 'item', updatedEntry.item);
          if (updatedEntry.price) {
            updateMultiItem(itemIndex, 'price', updatedEntry.price);
          }
        } else {
          // Update single item transaction
          updateSingleItem('item', updatedEntry.item);
          if (updatedEntry.price) {
            updateSingleItem('price', updatedEntry.price);
          }
        }
      },
      onCancel: () => {} // Do nothing on cancel
    });
  };

  // Render single item editor
  const renderSingleItemEditor = () => (
    <View style={styles.itemEditor}>
      <Text style={[styles.label, { color: colors.text }]}>Item Details:</Text>
      
      <View style={styles.itemRow}>
        <View style={styles.itemNameContainer}>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            value={editingData.item || ''}
            onChangeText={(value) => updateSingleItem('item', value)}
            placeholder="Item name"
            placeholderTextColor={colors.secondary}
          />
          {navigation && (
            <TouchableOpacity
              style={[styles.findButton, { backgroundColor: colors.primary }]}
              onPress={() => handleFindSimilar(editingData.item || '')}
            >
              <Text style={styles.findButtonText}>Find</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      <View style={styles.quantityPriceRow}>
        <View style={styles.qtyContainer}>
          <Text style={[styles.inputLabel, { color: colors.secondary }]}>Qty</Text>
          <TextInput
            style={[styles.input, styles.numberInput, { color: colors.text, borderColor: colors.border }]}
            value={String(editingData.qty || 1)}
            onChangeText={(value) => updateSingleItem('qty', parseFloat(value) || 0)}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.secondary}
          />
        </View>
        
        <View style={styles.unitContainer}>
          <Text style={[styles.inputLabel, { color: colors.secondary }]}>Unit</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            value={editingData.unit || ''}
            onChangeText={(value) => updateSingleItem('unit', value)}
            placeholder="kg"
            placeholderTextColor={colors.secondary}
          />
        </View>
        
        <View style={styles.priceContainer}>
          <Text style={[styles.inputLabel, { color: colors.secondary }]}>Price</Text>
          <TextInput
            style={[styles.input, styles.numberInput, { color: colors.text, borderColor: colors.border }]}
            value={String(editingData.price || 0)}
            onChangeText={(value) => updateSingleItem('price', parseFloat(value) || 0)}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={colors.secondary}
          />
        </View>
      </View>
    </View>
  );

  // Render multi-item editor
  const renderMultiItemEditor = () => (
    <View style={styles.multiItemEditor}>
      <Text style={[styles.label, { color: colors.text }]}>Items ({editingData.items?.length || 0}):</Text>
      
      <ScrollView style={styles.itemsList} showsVerticalScrollIndicator={false}>
        {editingData.items?.map((item, index) => (
          <View key={index} style={[styles.multiItemRow, { borderColor: colors.border }]}>
            <View style={styles.itemRowHeader}>
              <Text style={[styles.itemNumber, { color: colors.secondary }]}>
                #{index + 1}
              </Text>
              {editingData.items!.length > 1 && (
                <TouchableOpacity
                  onPress={() => removeItem(index)}
                  style={styles.removeButton}
                >
                  <Ionicons name="close-circle" size={20} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
            
            <View style={styles.itemNameContainer}>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                value={item.item}
                onChangeText={(value) => updateMultiItem(index, 'item', value)}
                placeholder="Item name"
                placeholderTextColor={colors.secondary}
              />
              {navigation && (
                <TouchableOpacity
                  style={[styles.findButton, { backgroundColor: colors.primary }]}
                  onPress={() => handleFindSimilar(item.item, index)}
                >
                  <Text style={styles.findButtonText}>Find</Text>
                </TouchableOpacity>
              )}
            </View>
            
            <View style={styles.quantityPriceRow}>
              <View style={styles.qtyContainer}>
                <Text style={[styles.inputLabel, { color: colors.secondary }]}>Qty</Text>
                <TextInput
                  style={[styles.input, styles.numberInput, { color: colors.text, borderColor: colors.border }]}
                  value={String(item.qty)}
                  onChangeText={(value) => updateMultiItem(index, 'qty', parseFloat(value) || 0)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.secondary}
                />
              </View>
              
              <View style={styles.unitContainer}>
                <Text style={[styles.inputLabel, { color: colors.secondary }]}>Unit</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={item.unit}
                  onChangeText={(value) => updateMultiItem(index, 'unit', value)}
                  placeholder="kg"
                  placeholderTextColor={colors.secondary}
                />
              </View>
              
              <View style={styles.priceContainer}>
                <Text style={[styles.inputLabel, { color: colors.secondary }]}>Price</Text>
                <TextInput
                  style={[styles.input, styles.numberInput, { color: colors.text, borderColor: colors.border }]}
                  value={String(item.price)}
                  onChangeText={(value) => updateMultiItem(index, 'price', parseFloat(value) || 0)}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor={colors.secondary}
                />
              </View>
            </View>
            
            <Text style={[styles.itemTotal, { color: colors.secondary }]}>
              Total: {formatCurrency(item.total)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons 
            name={getTransactionIcon()} 
            size={24} 
            color={getTransactionColor()} 
          />
          <Text style={[styles.title, { color: colors.text }]}>
            {getTransactionTitle()}
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.customerRow}>
          <Text style={[styles.label, { color: colors.text }]}>Customer:</Text>
          <TextInput
            style={[styles.input, styles.customerInput, { color: colors.text, borderColor: colors.border }]}
            value={editingData.customer}
            onChangeText={updateCustomer}
            placeholder="Customer name"
            placeholderTextColor={colors.secondary}
          />
        </View>

        {editingData.type === 'sale' && hasItems && (
          <>
            {isMultiItem ? renderMultiItemEditor() : renderSingleItemEditor()}
          </>
        )}

        {editingData.type === 'payment' && (
          <View style={styles.paymentAmountRow}>
            <Text style={[styles.label, { color: colors.text }]}>Payment Amount:</Text>
            <TextInput
              style={[styles.input, styles.amountInput, { color: colors.text, borderColor: colors.border }]}
              value={String(editingData.amount || 0)}
              onChangeText={updateAmount}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={colors.secondary}
            />
          </View>
        )}

        <View style={styles.totalAmountRow}>
          <Text style={[styles.label, { color: colors.text }]}>Total Amount:</Text>
          <Text style={[styles.amount, { color: getTransactionColor() }]}>
            {editingData.type === 'sale' ? '+' : '-'}{formatCurrency(editingData.amount || 0)}
          </Text>
        </View>

        {sourceText && (
          <View style={styles.sourceTextContainer}>
            <Text style={[styles.sourceLabel, { color: colors.secondary }]}>
              Voice Input:
            </Text>
            <Text style={[styles.sourceText, { color: colors.secondary }]}>
              "{sourceText}"
            </Text>
          </View>
        )}

        {warnings.length > 0 && (
          <View style={styles.warningsContainer}>
            {warnings.map((warning, index) => (
              <View key={index} style={styles.warningRow}>
                <Ionicons name="warning" size={16} color={colors.warning} />
                <Text style={[styles.warningText, { color: colors.warning }]}>
                  {warning}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.cancelButton, { borderColor: colors.border }]}
          onPress={onCancel}
          disabled={isLoading}
        >
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>
            Cancel
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.confirmButton, { backgroundColor: getTransactionColor() }]}
          onPress={handleConfirm}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[styles.confirmButtonText, { color: colors.background }]}>
              Confirm {editingData.type === 'sale' ? 'Sale' : 'Payment'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    padding: 16,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginRight: 8,
  },
  customerName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  itemDetails: {
    marginBottom: 12,
  },
  itemText: {
    fontSize: 16,
    marginTop: 4,
  },
  priceText: {
    fontSize: 14,
    marginTop: 2,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  amount: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  sourceTextContainer: {
    marginBottom: 12,
  },
  sourceLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  sourceText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  warningsContainer: {
    marginTop: 8,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    marginLeft: 4,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  confirmButton: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  itemEditor: {
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 8,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginRight: 8,
  },
  quantityPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  qtyContainer: {
    flex: 1,
    marginRight: 8,
  },
  unitContainer: {
    flex: 1,
    marginRight: 8,
  },
  priceContainer: {
    flex: 1,
  },
  findButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  findButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  multiItemEditor: {
    marginBottom: 16,
  },
  itemsList: {
    maxHeight: 200,
  },
  multiItemRow: {
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    marginBottom: 8,
  },
  itemRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemNumber: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    padding: 4,
  },
  paymentAmountRow: {
    marginBottom: 16,
  },
  amountInput: {
    padding: 12,
  },
  totalAmountRow: {
    marginBottom: 16,
  },
  customerInput: {
    padding: 12,
  },
  numberInput: {
    textAlign: 'right',
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
    marginTop: 4,
  },
}); 