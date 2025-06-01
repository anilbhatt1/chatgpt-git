import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { getCustomerCreditHistory, getCustomerBalance, createCreditPayment } from '../utils/sqliteStorage';
import { Entry } from '../state/types';
import { Ionicons } from '@expo/vector-icons';

interface CustomerCreditHistoryScreenProps {
  navigation: any;
  route: {
    params: {
      customerName: string;
    };
  };
}

export default function CustomerCreditHistoryScreen({ navigation, route }: CustomerCreditHistoryScreenProps) {
  const { colors } = useTheme();
  const { customerName } = route.params;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [creditHistory, customerBalance] = await Promise.all([
        getCustomerCreditHistory(customerName),
        getCustomerBalance(customerName)
      ]);
      
      setEntries(creditHistory);
      setBalance(customerBalance);
    } catch (error) {
      console.error('Error loading customer data:', error);
      Alert.alert('Error', 'Failed to load customer data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [customerName]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const formatCurrency = (amount: number) => {
    return `₹${amount.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const handleAddPayment = () => {
    Alert.prompt(
      'Add Payment',
      `Enter payment amount for ${customerName}:`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: async (amount) => {
            if (!amount || isNaN(parseFloat(amount))) {
              Alert.alert('Error', 'Please enter a valid amount');
              return;
            }
            
            try {
              await createCreditPayment(
                customerName,
                parseFloat(amount),
                `Manual payment entry`
              );
              loadData(); // Refresh the data
              Alert.alert('Success', `Payment of ${formatCurrency(parseFloat(amount))} recorded`);
            } catch (error) {
              console.error('Error adding payment:', error);
              Alert.alert('Error', 'Failed to record payment');
            }
          }
        }
      ],
      'plain-text',
      '',
      'numeric'
    );
  };

  const renderTransactionItem = ({ item }: { item: Entry }) => {
    const isCredit = item.txn_type === 'credit';
    const isPayment = item.txn_type === 'credit_paid';
    
    return (
      <View style={[styles.transactionCard, { backgroundColor: colors.card }]}>
        <View style={styles.transactionHeader}>
          <View style={styles.transactionInfo}>
            <Text style={[styles.transactionType, { color: isCredit ? colors.error : colors.success }]}>
              {isCredit ? 'Credit Sale' : 'Payment'}
            </Text>
            <Text style={[styles.transactionDate, { color: colors.secondary }]}>
              {formatDate(item.transaction_date)}
            </Text>
          </View>
          <Text style={[styles.transactionAmount, { color: isCredit ? colors.error : colors.success }]}>
            {isCredit ? '+' : '-'}{formatCurrency(item.total)}
          </Text>
        </View>
        
        {isCredit && (
          <View style={styles.transactionDetails}>
            <Text style={[styles.itemText, { color: colors.text }]}>
              {item.qty} {item.unit} {item.item} @ {formatCurrency(item.price)}
            </Text>
          </View>
        )}
        
        {item.source_text && (
          <Text style={[styles.sourceText, { color: colors.secondary }]}>
            "{item.source_text}"
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {customerName}
        </Text>
        <TouchableOpacity 
          onPress={handleAddPayment}
          style={styles.addButton}
        >
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.balanceCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.balanceLabel, { color: colors.text }]}>
          Outstanding Balance
        </Text>
        <Text style={[styles.balanceAmount, { color: balance > 0 ? colors.error : colors.success }]}>
          {formatCurrency(balance)}
        </Text>
        {balance > 0 && (
          <TouchableOpacity
            style={[styles.settleButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Alert.alert(
                'Settle Full Amount',
                `Record payment of ${formatCurrency(balance)} for ${customerName}?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Settle',
                    onPress: async () => {
                      try {
                        await createCreditPayment(
                          customerName,
                          balance,
                          `Full settlement`
                        );
                        loadData();
                        Alert.alert('Success', 'Full settlement recorded');
                      } catch (error) {
                        console.error('Error settling:', error);
                        Alert.alert('Error', 'Failed to record settlement');
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Text style={[styles.settleButtonText, { color: colors.background }]}>
              Settle Full Amount
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={entries}
        renderItem={renderTransactionItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.secondary }]}>
              No credit transactions found for {customerName}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  addButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  settleButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  settleButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
    paddingTop: 0,
  },
  transactionCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
  },
  transactionAmount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  transactionDetails: {
    marginBottom: 8,
  },
  itemText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sourceText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
}); 