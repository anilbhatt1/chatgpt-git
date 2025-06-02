import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Entry } from '../state/types';
import { useTheme } from '../theme/ThemeContext';
import { getEntriesByClusterWithOrderInfo } from '../utils/sqliteStorage';

interface TransactionBatchCardProps {
  batchId: string;
  rows: number;
  time: string;
  onDeleteAll: () => void;
  handleDeleteEntry: (entryData: { id: string, description: string }) => void;
  onEdit: (entry: Entry) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  source_text?: string;
}

export const TransactionBatchCard: React.FC<TransactionBatchCardProps> = ({ 
  batchId, 
  rows, 
  time, 
  onDeleteAll,
  handleDeleteEntry,
  onEdit,
  isExpanded,
  onToggleExpand,
  source_text
}) => {
  const { colors } = useTheme();
  const [entries, setEntries] = useState<Array<Entry & { customer?: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [orderInfo, setOrderInfo] = useState<{ order_id?: string; customer?: string }>({});

  // Load batch entries when expanded
  useEffect(() => {
    const loadEntries = async () => {
      if (!isExpanded && rows > 1) {
        setEntries([]);
        return;
      }
      if (!isExpanded && rows === 1) return;
      
      try {
        setIsLoading(true);
        const batchEntries = await getEntriesByClusterWithOrderInfo(batchId, true); // true for confirmed entries
        
        const formattedEntries: Array<Entry & { customer?: string }> = batchEntries.map((row: any) => ({
          id: row.id,
          item: row.item,
          qty: row.qty,
          unit: row.unit,
          price: row.price,
          total: row.total,
          type: row.type === 'cash-in' ? 'cash-in' as const : 'cash-out' as const,
          created_at: row.created_at,
          transaction_date: row.transaction_date,
          source_text: row.source_text || '',
          is_final: Boolean(row.is_final),
          user_id: row.user_id,
          version: row.version || 1,
          confirmed: true,
          batch_id: row.batch_id,
          order_id: row.order_id,
          customer: row.customer !== null ? row.customer : undefined
        }));
        
        setEntries(formattedEntries);
        
        // Set order info for batch header (use first entry's order info)
        if (formattedEntries.length > 0) {
          const firstEntry = formattedEntries[0];
          setOrderInfo({
            order_id: firstEntry.order_id || undefined,
            customer: firstEntry.customer
          });
        }
      } catch (error) {
        console.error('Error loading batch entries:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (isExpanded || rows === 1) {
        loadEntries();
    } else {
        setEntries([]);
    }
  }, [batchId, isExpanded, rows]);

  const currentIsExpanded = rows === 1 || isExpanded;

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      {/* Header */}
      <TouchableOpacity 
        style={styles.header} 
        onPress={rows > 1 ? onToggleExpand : undefined}
        activeOpacity={rows > 1 ? 0.7 : 1}
      >
        <View style={styles.headerLeft}>
          <Text style={[styles.icon, { color: colors.text }]}>🛒</Text>
          <Text style={[styles.headerText, { color: colors.text }]}>
            {rows} item{rows !== 1 ? 's' : ''} • {time}
          </Text>
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.deleteAllButton, { backgroundColor: colors.error }]}
            onPress={onDeleteAll}
          >
            <Text style={styles.deleteAllText}>🗑️ All</Text>
          </TouchableOpacity>
          
          <Text style={[styles.expandIcon, { color: colors.text }]}>
            {rows > 1 ? (currentIsExpanded ? '▲' : '▼') : ''}
          </Text>
        </View>
      </TouchableOpacity>
      
      {/* Source Text Display */}
      {source_text && currentIsExpanded && (
        <View style={styles.sourceTextContainer}>
          <Text style={[styles.sourceText, { color: colors.text }]}>
            {source_text}
          </Text>
        </View>
      )}

      {/* Order Information Display */}
      {currentIsExpanded && orderInfo.order_id && (
        <View style={styles.orderInfoContainer}>
          <Text style={[styles.orderInfoText, { color: colors.text }]}>
            Order: {orderInfo.order_id} • Customer: {orderInfo.customer || 'N/A'}
          </Text>
        </View>
      )}

      {/* Expanded content */}
      {currentIsExpanded && (
        <View style={styles.content}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
          ) : (
            entries.map((entry) => (
              <View
                key={entry.id}
                style={[styles.entryItem, { backgroundColor: colors.card }]}
              >
                <View style={styles.entryContent}>
                  <Text style={[styles.entryMainText, { color: colors.text }]}>
                    {entry.item} ({entry.qty} {entry.unit}) - ₹{entry.price} each
                  </Text>
                  <Text style={[
                    styles.totalText,
                    { color: entry.type === 'cash-in' ? colors.success : colors.error }
                  ]}>
                    {entry.type === 'cash-in' ? '+' : '-'}₹{entry.total}
                  </Text>
                </View>
                
                <View style={styles.iconActions}>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => onEdit(entry)}
                    accessibilityLabel="Edit entry"
                  >
                    <Text style={styles.icon}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleDeleteEntry({ 
                      id: entry.id, 
                      description: `${entry.item} (${entry.qty} ${entry.unit}) - ₹${entry.price} each` 
                    })}
                    accessibilityLabel="Delete entry"
                  >
                    <Text style={styles.icon}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
    borderWidth: 0.5,
    borderColor: '#DDD',
    borderStyle: 'solid',
  },
  header: {
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    fontSize: 18,
    marginRight: 8,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expandIcon: {
    fontSize: 12,
    marginLeft: 8,
    fontWeight: 'bold',
  },
  content: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  loader: {
    padding: 16,
  },
  deleteAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  deleteAllText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  sourceTextContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 0,
  },
  sourceText: {
    fontSize: 13,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  orderInfoContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 0,
  },
  orderInfoText: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.8,
  },
  // Individual transaction entry styles
  entryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#E3F2FD',
    marginHorizontal: 4,
    marginVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(74, 144, 226, 0.05)',
  },
  entryContent: {
    flex: 1,
  },
  entryMainText: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  totalText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  iconActions: {
    flexDirection: 'row',
    marginLeft: 8,
  },
  iconButton: {
    padding: 8,
    marginLeft: 4,
  },
}); 