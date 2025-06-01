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
import { getAllCustomersWithBalances, getCustomerCreditHistory, createCreditPayment } from '../utils/sqliteStorage';
import { CustomerBalance } from '../state/types';
import { Ionicons } from '@expo/vector-icons';

interface CreditScreenProps {
  navigation: any;
}

export default function CreditScreen({ navigation }: CreditScreenProps) {
  const { colors } = useTheme();
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCustomers = async () => {
    try {
      const customerData = await getAllCustomersWithBalances();
      // Filter out customers with zero balance
      const customersWithBalance = customerData.filter(c => c.totalOutstanding > 0);
      setCustomers(customersWithBalance);
    } catch (error) {
      console.error('Error loading customers:', error);
      Alert.alert('Error', 'Failed to load customer data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadCustomers();
  };

  const getAgingColor = (days: number) => {
    if (days <= 30) return colors.success;
    if (days <= 60) return colors.warning;
    if (days <= 90) return colors.error;
    return colors.error;
  };

  const formatCurrency = (amount: number) => {
    return `₹${amount.toFixed(2)}`;
  };

  const handleCustomerPress = (customer: CustomerBalance) => {
    navigation.navigate('CustomerCreditHistoryScreen', { customerName: customer.name });
  };

  const handleQuickSettle = (customer: CustomerBalance) => {
    Alert.alert(
      'Settle Outstanding',
      `Settle full amount of ${formatCurrency(customer.totalOutstanding)} for ${customer.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Settle',
          style: 'default',
          onPress: async () => {
            try {
              await createCreditPayment(
                customer.name,
                customer.totalOutstanding,
                `Full settlement via quick settle`
              );
              loadCustomers(); // Refresh the list
              Alert.alert('Success', `Settlement recorded for ${customer.name}`);
            } catch (error) {
              console.error('Error settling customer:', error);
              Alert.alert('Error', 'Failed to record settlement');
            }
          }
        }
      ]
    );
  };

  const renderAgingBar = (aging: CustomerBalance['aging'], total: number) => {
    if (total === 0) return null;

    const currentPercent = (aging.current / total) * 100;
    const days30Percent = (aging.days30 / total) * 100;
    const days60Percent = (aging.days60 / total) * 100;
    const days90Percent = (aging.days90Plus / total) * 100;

    return (
      <View style={styles.agingBar}>
        {aging.current > 0 && (
          <View style={[styles.agingSegment, { flex: currentPercent, backgroundColor: colors.success }]} />
        )}
        {aging.days30 > 0 && (
          <View style={[styles.agingSegment, { flex: days30Percent, backgroundColor: colors.warning }]} />
        )}
        {aging.days60 > 0 && (
          <View style={[styles.agingSegment, { flex: days60Percent, backgroundColor: colors.error }]} />
        )}
        {aging.days90Plus > 0 && (
          <View style={[styles.agingSegment, { flex: days90Percent, backgroundColor: '#8B0000' }]} />
        )}
      </View>
    );
  };

  const renderCustomerItem = ({ item }: { item: CustomerBalance }) => (
    <TouchableOpacity
      style={[styles.customerCard, { backgroundColor: colors.card }]}
      onPress={() => handleCustomerPress(item)}
    >
      <View style={styles.customerHeader}>
        <Text style={[styles.customerName, { color: colors.text }]}>
          {item.name}
        </Text>
        <Text style={[styles.outstandingAmount, { color: colors.error }]}>
          {formatCurrency(item.totalOutstanding)}
        </Text>
      </View>

      {renderAgingBar(item.aging, item.totalOutstanding)}

      <View style={styles.agingDetails}>
        <Text style={[styles.agingText, { color: colors.secondary }]}>
          Current: {formatCurrency(item.aging.current)} • 
          30d: {formatCurrency(item.aging.days30)} • 
          60d: {formatCurrency(item.aging.days60)} • 
          90d+: {formatCurrency(item.aging.days90Plus)}
        </Text>
      </View>

      <View style={styles.customerFooter}>
        <Text style={[styles.lastPayment, { color: colors.secondary }]}>
          {item.lastPaymentDate ? 
            `Last payment: ${new Date(item.lastPaymentDate).toLocaleDateString()}` : 
            'No payments yet'
          }
        </Text>
        <TouchableOpacity
          style={[styles.settleButton, { backgroundColor: colors.primary }]}
          onPress={() => handleQuickSettle(item)}
        >
          <Text style={[styles.settleButtonText, { color: colors.background }]}>
            Settle
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const totalOutstanding = customers.reduce((sum, customer) => sum + customer.totalOutstanding, 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          Credit
        </Text>
        <View style={styles.headerRight} />
      </View>

      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.summaryTitle, { color: colors.text }]}>
          Total Outstanding
        </Text>
        <Text style={[styles.summaryAmount, { color: colors.error }]}>
          {formatCurrency(totalOutstanding)}
        </Text>
        <Text style={[styles.summarySubtext, { color: colors.secondary }]}>
          {customers.length} customers with outstanding balance
        </Text>
      </View>

      <FlatList
        data={customers}
        renderItem={renderCustomerItem}
        keyExtractor={(item) => item.name}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
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
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerRight: {
    width: 40,
  },
  summaryCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: 14,
  },
  listContainer: {
    padding: 16,
    paddingTop: 0,
  },
  customerCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  customerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  customerName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  outstandingAmount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  agingBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  agingSegment: {
    height: '100%',
  },
  agingDetails: {
    marginBottom: 12,
  },
  agingText: {
    fontSize: 12,
    lineHeight: 16,
  },
  customerFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastPayment: {
    fontSize: 12,
    flex: 1,
  },
  settleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  settleButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
}); 