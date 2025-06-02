import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { lookupSimilarItems } from '../utils/sqliteStorage';
import { Entry } from '../state/types';
import { showSnackbar } from '../components/Snackbar';
import { MainLayout } from '../components/layout/MainLayout';
import { Feather } from '@expo/vector-icons';

type SimilarItemsScreenProps = {
  navigation: any;
  route: {
    params: {
      entryData: Partial<Entry>;
      onSelect: (updatedEntry: Partial<Entry>) => void;
      onCancel?: () => void; // Optional cancel callback
    };
  };
};

export const SimilarItemsScreen: React.FC<SimilarItemsScreenProps> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { entryData, onSelect, onCancel } = route.params;
  
  const [loading, setLoading] = useState(true);
  const [similarItems, setSimilarItems] = useState<Array<{ item: string; price: number }>>([]);
  
  // Modified entry that will be sent back
  const [modifiedEntry, setModifiedEntry] = useState<Partial<Entry>>(entryData);
  
  useEffect(() => {
    const searchForItems = async () => {
      if (!entryData.item) {
        setLoading(false);
        return;
      }
      
      try {
        const items = await lookupSimilarItems(entryData.item);
        setSimilarItems(items);
      } catch (error) {
        console.error('Error finding similar items:', error);
        showSnackbar('Error searching for similar items', 'error');
      } finally {
        setLoading(false);
      }
    };
    
    searchForItems();
  }, [entryData.item]);
  
  // Calculate total when price or qty changes
  useEffect(() => {
    if (modifiedEntry.price !== undefined && modifiedEntry.qty !== undefined) {
      const newTotal = Math.round((modifiedEntry.price * modifiedEntry.qty) * 100) / 100;
      setModifiedEntry(prev => ({
        ...prev,
        total: newTotal
      }));
    }
  }, [modifiedEntry.price, modifiedEntry.qty]);
  
  const handleSelectItem = (item: string, price: number) => {
    // Update the modified entry with the selected item and price
    setModifiedEntry(prev => ({
      ...prev,
      item,
      price,
      total: prev.qty ? Math.round((price * prev.qty) * 100) / 100 : price
    }));
    
    // Note: Removed snackbar here to prevent rapid succession
    // EditableTransactionCard will show "Updated to..." message
  };
  
  const handleConfirm = () => {
    // Send the modified entry back to the previous screen
    onSelect(modifiedEntry);
    navigation.goBack();
  };
  
  const handleCancel = () => {
    // Just go back without making changes
    if (onCancel) {
      onCancel();
    }
    navigation.goBack();
  };
  
  // Check if there are any changes to apply
  const hasChanges = () => {
    return modifiedEntry.item !== entryData.item || modifiedEntry.price !== entryData.price;
  };
  
  return (
    <MainLayout>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.headerText, { color: colors.text }]}>Similar Items</Text>
        </View>
        
        {/* Current Entry Preview */}
        <View style={[styles.previewCard, { backgroundColor: colors.card }]}>
          <View style={styles.previewRow}>
            <Text style={[styles.previewLabel, { color: colors.text }]}>Item:</Text>
            <Text style={[styles.previewValue, { color: colors.text }]}>{modifiedEntry.item}</Text>
          </View>
          
          <View style={styles.previewRow}>
            <Text style={[styles.previewLabel, { color: colors.text }]}>Quantity:</Text>
            <Text style={[styles.previewValue, { color: colors.text }]}>
              {modifiedEntry.qty} {modifiedEntry.unit}
            </Text>
          </View>
          
          <View style={styles.previewRow}>
            <Text style={[styles.previewLabel, { color: colors.text }]}>Price:</Text>
            <Text style={[styles.previewValue, { color: colors.primary }]}>
              ₹{modifiedEntry.price?.toFixed(2)}
            </Text>
          </View>
          
          <View style={styles.previewRow}>
            <Text style={[styles.previewLabel, { color: colors.text }]}>Total:</Text>
            <Text 
              style={[
                styles.previewValue, 
                { 
                  color: modifiedEntry.type === 'cash-in' ? colors.success : colors.error,
                  fontWeight: 'bold'
                }
              ]}
            >
              ₹{modifiedEntry.total?.toFixed(2)}
            </Text>
          </View>
        </View>
        
        {/* Similar Items List */}
        <View style={styles.listContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {loading ? 'Searching...' : similarItems.length > 0 ? 'Choose an item:' : 'No similar items found'}
          </Text>
          
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
          ) : similarItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="search" size={24} color={colors.text} style={styles.emptyIcon} />
              <Text style={[styles.emptyText, { color: colors.text }]}>
                No similar items found for "{entryData.item}"
              </Text>
            </View>
          ) : (
            <FlatList
              data={similarItems}
              keyExtractor={(item, index) => `${item.item}-${index}`}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[
                    styles.itemRow,
                    { 
                      backgroundColor: modifiedEntry.item === item.item ? colors.card : 'transparent',
                      borderColor: colors.border
                    }
                  ]}
                  onPress={() => handleSelectItem(item.item, item.price)}
                >
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, { color: colors.text }]}>{item.item}</Text>
                  </View>
                  <Text style={[styles.itemPrice, { color: colors.primary }]}>
                    ₹{item.price.toFixed(2)}
                  </Text>
                  {modifiedEntry.item === item.item && (
                    <View style={styles.selectedIndicator}>
                      <Feather name="check" size={18} color={colors.success} />
                    </View>
                  )}
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
        
        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: colors.secondary }]}
            onPress={handleCancel}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[
              styles.button, 
              { 
                backgroundColor: colors.success,
                opacity: hasChanges() ? 1 : 0.7
              }
            ]}
            onPress={handleConfirm}
            disabled={!hasChanges()}
          >
            <Text style={styles.buttonText}>
              {hasChanges() ? 'Apply Changes' : 'No Changes'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </MainLayout>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  previewCard: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  previewValue: {
    fontSize: 16,
  },
  listContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  loader: {
    marginTop: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  itemRow: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: 1,
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  selectedIndicator: {
    marginLeft: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
}); 