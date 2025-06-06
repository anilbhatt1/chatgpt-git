import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Platform, ScrollView, Modal, Alert } from 'react-native';
import { MainLayout } from '../components/layout/MainLayout';
import { Header } from '../components/Header';
import { ChatDisplay } from '../components/ChatDisplay';
import { useAppContext } from '../state/context';
import { useTheme } from '../theme/ThemeContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from 'react-native';
import { Entry } from '../state/types';
import { DatabaseViewerScreen } from './DatabaseViewerScreen';
import { DEV_MODE } from '../config';
import { parseSentence } from '../utils/parsing';
import { SpeechInputArea } from '../components/SpeechInputArea';
import { EditableTransactionCard } from '../components/EditableTransactionCard';
import { EditablePriceCard } from '../components/EditablePriceCard';
import { EditableMultiPriceCard } from '../components/EditableMultiPriceCard';
import { OrderReviewCard } from '../components/OrderReviewCard';
import { CreditReviewCard } from '../components/CreditReviewCard';
import { getStorage } from '../utils/storage';
import { addEntry, updateEntry, clearCurrentEntry, addEntriesBatch } from '../state/actions';
import { PricesScreen } from './PricesScreen';
import { upsertPrice, createOrder, lookupPrice, createCreditSale, createCreditPayment, createCreditSaleBatch, saveSinglePrice } from '../utils/sqliteStorage';
import { showSnackbar, Snackbar } from '../components/Snackbar';

// Add navigation type
interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const { state, dispatch } = useAppContext();
  const { entries, currentEntry, settings } = state;
  const [showDatabaseViewer, setShowDatabaseViewer] = useState(false);
  
  // Order success modal state
  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState<{
    orderId: string;
    customer: string;
    itemCount: number;
    total: number;
  } | null>(null);
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCurrentEntry, setLocalCurrentEntry] = useState<Partial<Entry> | null>(null);
  const [localCurrentEntries, setLocalCurrentEntries] = useState<Partial<Entry>[] | null>(null);
  const [currentPriceEntry, setCurrentPriceEntry] = useState<any>(null);
  const [currentMultiPriceEntry, setCurrentMultiPriceEntry] = useState<any>(null);
  const [currentOrderEntry, setCurrentOrderEntry] = useState<any>(null);
  const [currentCreditEntry, setCurrentCreditEntry] = useState<any>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  
  // State for summary modal
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState('');

  // Effect to update localCurrentEntry when currentEntry in global state changes
  useEffect(() => {
    if (currentEntry) {
      if ((currentEntry as any).type === 'price') {
        setCurrentPriceEntry(currentEntry as any);
      } else if ((currentEntry as any).type === 'order') {
        setCurrentOrderEntry(currentEntry as any);
      } else {
        setLocalCurrentEntry(currentEntry);
      }
      dispatch(clearCurrentEntry());
    }
  }, [currentEntry, dispatch]);

  // Sort entries by date and take the latest 3 for display
  const latestEntries = [...entries]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 2);

  // Convert latest Entry objects to strings for display
  const displayMessages = latestEntries.map(entry => {
    // Format: "Sold 2 Biscuits (packet) at ₹20 each" - removing the Total part
    return `${entry.type === 'cash-in' ? 'Sold' : 'Bought'} ${entry.qty} ${entry.item}${entry.unit ? ` (${entry.unit})` : ''} at ₹${entry.price} each.`;
  });

  // Navigation handlers
  const handleEodReviewPress = () => {
    navigation.navigate('EodReviewScreen');
  };

  const handlePricesPress = () => {
    navigation.navigate('PricesScreen');
  };

  const handleOrdersPress = () => {
    navigation.navigate('OrdersScreen');
  };

  const handleDeliveriesPress = () => {
    navigation.navigate('DeliveriesScreen');
  };

  const handleCreditPress = () => {
    navigation.navigate('CreditScreen');
  };

  const handleSettingsPress = () => {
    navigation.navigate('Settings');
  };

  // Show database viewer screen
  const handleShowDatabaseViewer = () => {
    setShowDatabaseViewer(true);
  };

  // Handle going back to main screen (for DatabaseViewer only now)
  const handleBackToHome = () => {
    setShowDatabaseViewer(false);
  };
  
  // Handle voice or text input
  const handleTextInput = (text: string) => {
    if (!text.trim()) return;
    
    try {
      const parsedItems = parseSentence(text);
      // Use the first item as the entry
      if (parsedItems.length > 0) {
        setLocalCurrentEntry(parsedItems[0]);
        setWarnings([]);
      } else {
        setWarnings(['Could not parse input']);
      }
    } catch (error) {
      console.error('Error parsing input:', error);
      setWarnings(['Error parsing input']);
    }
  };

  // Handle parsed transcript directly from speech recognition
  const handleTranscriptParsed = (entry: any, warnings: string[]) => {
    if (entry.type === 'price') {
      // Handle single price update - ALWAYS show review (no quick mode for pricing)
        setCurrentPriceEntry(entry);
      return;
      }
    
    if (entry.type === 'multi-price') {
      // Handle multiple price updates - ALWAYS show review (no quick mode for pricing)
      setCurrentMultiPriceEntry(entry);
      setWarnings(warnings);
      return;
    }
    
    if (entry.type === 'order') {
      // Handle order creation
      // Only show OrderReviewCard in non-quick mode
      if (!settings.quickCapture) {
        setCurrentOrderEntry(entry);
        setWarnings(warnings);
      }
      return;
    }
    
    if (entry.type === 'credit') {
      // Handle credit transactions - check forceReview flag for credit payments
      if (!settings.quickCapture || entry.forceReview) {
        setCurrentCreditEntry(entry);
        setWarnings(warnings);
      } else {
        // Quick mode ON and no forceReview - save credit transaction directly
        saveQuickCreditEntry(entry.credit, entry.source_text);
      }
      return;
    }
    
    if (entry.type === 'multiple-transactions') {
      // Handle multiple transactions
      if (!settings.quickCapture) {
        setLocalCurrentEntries(entry.entries);
        setWarnings(warnings);
      }
      return;
    }
    
    // Handle regular transaction
    if (!settings.quickCapture) {
      setLocalCurrentEntry(entry);
      setWarnings(warnings);
    }
  };

  // Save multiple entries
  const saveMultipleEntries = async (entries: Partial<Entry>[]) => {
    setWarnings([]); // Clear previous warnings
    setIsLoading(true); // Show loading immediately
    
    try {
      const storage = await getStorage();
      
      // Use optimized batch save instead of individual saves
      const savedEntries = await storage.saveEntriesBatch(entries.map(entry => ({
            ...entry,
            source_text: entry.source_text || ''
      })));
          
      // Single batch dispatch instead of multiple individual dispatches
      dispatch(addEntriesBatch(savedEntries));
      
      // Calculate total value for success message
        const totalValue = savedEntries.reduce((sum, entry) => sum + (entry.total || 0), 0);
        showSnackbar(`✅ ${savedEntries.length} items saved (₹${totalValue.toFixed(2)})`, 'normal');
      
        setLocalCurrentEntries(null);
        setIsLoading(false);
    } catch (error: any) {
      console.error('Error in saveMultipleEntries:', error);
      setWarnings([
        `Error: ${error.message || 'Unknown error occurred'}`
      ]);
      setIsLoading(false);
    }
  };

  // Save entry
  const saveEntry = async (entry: Partial<Entry>) => {
    setWarnings([]); // Clear previous warnings
    setIsLoading(true); // Show loading immediately
    
    try {
      const storage = await getStorage();
      
      if (entry.id) {
        // This is an edit of an existing entry
        try {
          const updatedEntry = await storage.updateEntry(entry.id, entry);
          
          // Update the global state
          dispatch(updateEntry(entry.id, entry));
          
          // Show success notification
          showSnackbar(`✅ Transaction updated: ${entry.item} - ₹${entry.total?.toFixed(2)}`, 'normal');
          
          // Clear current entry and warnings
          setLocalCurrentEntry(null);
          setIsLoading(false);
        } catch (updateError: any) {
          console.error('Error updating entry:', updateError);
          setWarnings([`Error updating entry: ${updateError.message || 'Unknown error'}`]);
          setIsLoading(false);
          return; // Early return on error
        }
      } else {
        // This is a new entry
        try {
          const savedEntry = await storage.saveEntry({
            ...entry,
            source_text: entry.source_text || ''
          });
          
          // Add to global state through AppContext
          dispatch(addEntry(savedEntry));
          
          // Show success notification
          showSnackbar(`✅ Transaction saved: ${savedEntry.item} - ₹${savedEntry.total?.toFixed(2)}`, 'normal');
          
          // Clear current entry and warnings
          setLocalCurrentEntry(null);
          setIsLoading(false);
        } catch (saveError: any) {
          console.error('Error saving new entry:', saveError);
          setWarnings([`Error saving entry: ${saveError.message || 'Unknown error'}`]);
          setIsLoading(false);
          return; // Early return on error
        }
      }
    } catch (error: any) {
      console.error('General error in saveEntry:', error);
      setWarnings([
        `Error: ${error.message || 'Unknown error occurred'}`
      ]);
      setIsLoading(false);
    }
  };
  
  // Save price entry (typically for a new price confirmed via EditablePriceCard in Quick Mode OFF)
  const savePriceEntry = async (data: { item: string; price: number; date: Date; summary?: string }) => {
    try {
      // If the enhanced EditablePriceCard already handled the database operations and provided a summary,
      // just show the summary modal
      if (data.summary) {
        setCurrentPriceEntry(null);
        setWarnings([]);
        
        // Show the enhanced summary modal (same as multi-price)
        setSummaryMessage(data.summary);
        setShowSummaryModal(true);
        return;
      }
      
      // Legacy path - for backward compatibility with older usage
      // Look up if this item already exists to determine if it's initial or update
      const existingPrice = await lookupPrice(data.item);
      const comment = existingPrice === null ? 'Initial' : 'User Update';
      
      await upsertPrice(data.item, data.price, comment);
      
      // Handling for otherPrices (less common in this specific flow, more for batch voice)
      if (currentPriceEntry?.otherPrices && currentPriceEntry.otherPrices.length > 0) {
        await Promise.all(
          currentPriceEntry.otherPrices.map((p: any) => upsertPrice(p.item, p.price))
        );
      }
      
      // Generate proper feedback message
      let feedbackMessage = 'Price Update Summary:\n\n';
      
      if (existingPrice === null) {
        // New item
        feedbackMessage += `${data.item}: ₹${data.price.toFixed(2)} (New)\n\n`;
        feedbackMessage += 'Total: 1 added\n\n';
      } else if (Math.abs(data.price - existingPrice) > 0.01) {
        // Price changed
        feedbackMessage += `${data.item}: ₹${existingPrice.toFixed(2)} → ₹${data.price.toFixed(2)}\n\n`;
        feedbackMessage += 'Total: 1 updated\n\n';
      } else {
        // Price unchanged
        feedbackMessage += `${data.item}: ₹${data.price.toFixed(2)} (No change)\n\n`;
        feedbackMessage += 'Total: 1 unchanged\n\n';
      }
      
      feedbackMessage += 'You can further edit these items from the Prices screen.';
      
      setCurrentPriceEntry(null);
      
      // Use the dark-themed summary modal instead of basic alert
      setSummaryMessage(feedbackMessage);
      setShowSummaryModal(true);
    } catch (error) {
      console.error('Error saving price:', error);
      setWarnings([`Error saving price: ${error instanceof Error ? error.message : String(error)}`]);
    }
  };
  
  // Save order entry
  const saveOrderEntry = async (orderData: {
    customer: string;
    items: Array<{
      item: string;
      qty: number;
      price?: number | null;
      delivery_date?: string | null;
    }>;
    sourceText: string;
  }) => {
    try {
      const mappedItems = orderData.items.map(item => ({
        item: item.item,
        qty: item.qty,
        price: item.price || null,
        delivery_date: item.delivery_date || null
      }));
      
      const orderId = await createOrder(
        orderData.customer,
        mappedItems
      );
      
      setCurrentOrderEntry(null);
      setWarnings([]);
      
      // Show success message with custom modal
      const totalValue = orderData.items.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
      setOrderSuccessData({
        orderId,
        customer: orderData.customer,
        itemCount: orderData.items.length,
        total: totalValue
      });
      setShowOrderSuccessModal(true);
      
    } catch (error) {
      console.error('Error creating order:', error);
      setWarnings([`Error creating order: ${error instanceof Error ? error.message : String(error)}`]);
    }
  };
  
  // Save multiple price entries
  const saveMultiPriceEntry = async (summaryMessage: string) => {
    try {
      setCurrentMultiPriceEntry(null);
      setWarnings([]);
      
      // Show custom summary modal with scrollable content
      setSummaryMessage(summaryMessage);
      setShowSummaryModal(true);
    } catch (error) {
      console.error('Error in saveMultiPriceEntry:', error);
      setWarnings([`Error: ${error instanceof Error ? error.message : String(error)}`]);
    }
  };

  // Save credit entry
  const saveCreditEntry = async (creditData: any) => {
    setWarnings([]); // Clear previous warnings
    setIsLoading(true);
    
    try {
      if (creditData.type === 'sale') {
        // Handle multi-item credit sales
        if (creditData.items && creditData.items.length > 0) {
          // Multi-item credit sale - use batch function to assign batch_id
          await createCreditSaleBatch(
              creditData.customer,
            creditData.items,
              currentCreditEntry.source_text || ''
            );
          showSnackbar(`✅ Credit sale recorded: ${creditData.items.length} items for ${creditData.customer}`, 'normal');
        } else {
          // Single item credit sale (backward compatibility)
          await createCreditSale(
            creditData.customer,
            creditData.item || '',
            creditData.qty || 1,
            creditData.unit || '',
            creditData.price || 0,
            currentCreditEntry.source_text || ''
          );
          showSnackbar(`✅ Credit sale recorded for ${creditData.customer}`, 'normal');
        }
      } else if (creditData.type === 'payment') {
        // Create credit payment entry
        await createCreditPayment(
          creditData.customer,
          creditData.amount || 0,
          currentCreditEntry.source_text || ''
        );
        showSnackbar(`✅ Payment recorded for ${creditData.customer}`, 'normal');
      }
      
      setCurrentCreditEntry(null);
      setIsLoading(false);
    } catch (error: any) {
      console.error('Error in saveCreditEntry:', error);
      setWarnings([
        `Error: ${error.message || 'Unknown error occurred'}`
      ]);
      setIsLoading(false);
    }
  };

  // Save credit entry in quick mode (no review card)
  const saveQuickCreditEntry = async (creditData: any, sourceText: string) => {
    try {
      if (creditData.type === 'sale') {
        // Handle multi-item credit sales
        if (creditData.items && creditData.items.length > 0) {
          // Multi-item credit sale - use batch function to assign batch_id
          await createCreditSaleBatch(
              creditData.customer,
            creditData.items,
              sourceText || ''
            );
          showSnackbar(`✅ Credit sale: ${creditData.items.length} items for ${creditData.customer}`, 'normal');
        } else {
          // Single item credit sale (backward compatibility)
          await createCreditSale(
            creditData.customer,
            creditData.item || '',
            creditData.qty || 1,
            creditData.unit || '',
            creditData.price || 0,
            sourceText || ''
          );
          showSnackbar(`✅ Credit sale: ${creditData.qty} ${creditData.unit} ${creditData.item} for ${creditData.customer}`, 'normal');
        }
      } else if (creditData.type === 'payment') {
        // Create credit payment entry
        await createCreditPayment(
          creditData.customer,
          creditData.amount || 0,
          sourceText || ''
        );
        showSnackbar(`✅ Payment received: ₹${creditData.amount} from ${creditData.customer}`, 'normal');
      }
    } catch (error: any) {
      console.error('Error in saveQuickCreditEntry:', error);
      showSnackbar(`❌ Failed to save credit transaction: ${error.message || 'Unknown error'}`, 'error');
    }
  };

  // Cancel edit
  const cancelEdit = () => {
    setLocalCurrentEntry(null);
    setLocalCurrentEntries(null);
    setCurrentPriceEntry(null);
    setCurrentMultiPriceEntry(null);
    setCurrentOrderEntry(null);
    setCurrentCreditEntry(null);
    setWarnings([]);
  };

  // Render Database Viewer screen if it's active
  if (showDatabaseViewer) {
    return <DatabaseViewerScreen onBack={handleBackToHome} />;
  }

  // Render the main screen
  return (
    <MainLayout>
      <View style={styles.container}>
        {/* Custom title header with theme toggle */}
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: colors.primary }]}>
              Shop<Text style={[styles.titleHighlight, { color: colors.accent }]}>Notes</Text>
            </Text>
          </View>
          
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: colors.card }]}
              onPress={handleSettingsPress}
            >
              <Text style={styles.iconButtonText}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Navigation buttons */}
        <View style={styles.navigationContainer}>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.primary }]}
            onPress={handleEodReviewPress}
          >
            <Text style={styles.navButtonText}>📅 Cash</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.accent }]}
            onPress={handlePricesPress}
          >
            <Text style={styles.navButtonText}>💰 Prices</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.success }]}
            onPress={handleOrdersPress}
          >
            <Text style={styles.navButtonText}>📋 Orders</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.secondary }]}
            onPress={handleDeliveriesPress}
          >
            <Text style={styles.navButtonText}>📦 Delivery</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.secondary }]}
            onPress={handleCreditPress}
          >
            <Text style={styles.navButtonText}>💳 Credit</Text>
          </TouchableOpacity>
          
          {DEV_MODE && (
            <TouchableOpacity
              style={[styles.navButton, { backgroundColor: colors.secondary }]}
              onPress={handleShowDatabaseViewer}
            >
              <Text style={styles.navButtonText}>📊 DB</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {/* Speech input area */}
        <View style={styles.inputContainer}>
          <SpeechInputArea
            onSend={handleTextInput}
            onTranscriptParsed={handleTranscriptParsed}
          />
        </View>
        
        {/* Show appropriate editor based on the current entry type */}
        {localCurrentEntries ? (
          <View style={styles.editOverlay}>
            <EditableTransactionCard
              entries={localCurrentEntries}
              onConfirmMultiple={saveMultipleEntries}
              onCancel={cancelEdit}
              warnings={warnings}
              navigation={navigation}
              isLoading={isLoading}
            />
          </View>
        ) : localCurrentEntry ? (
          <View style={styles.editOverlay}>
            <EditableTransactionCard
              entry={localCurrentEntry}
              onConfirm={saveEntry}
              onCancel={cancelEdit}
              warnings={warnings}
              navigation={navigation}
              isLoading={isLoading}
            />
          </View>
        ) : currentPriceEntry ? (
          <View style={styles.editOverlay}>
            <EditablePriceCard
              item={currentPriceEntry.item}
              price={currentPriceEntry.price}
              updated_at={currentPriceEntry.updated_at}
              onConfirm={savePriceEntry}
              onCancel={cancelEdit}
            />
          </View>
        ) : currentMultiPriceEntry ? (
          <View style={styles.editOverlay}>
            <EditableMultiPriceCard
              priceItems={currentMultiPriceEntry.priceUpdates || []}
              sourceText={currentMultiPriceEntry.source_text || ''}
              onConfirm={saveMultiPriceEntry}
              onCancel={cancelEdit}
              navigation={navigation}
            />
          </View>
        ) : currentOrderEntry ? (
          <View style={styles.editOverlay}>
            <OrderReviewCard
              customer={currentOrderEntry.order.customer}
              items={currentOrderEntry.order.items}
              sourceText={currentOrderEntry.source_text}
              warnings={warnings}
              onConfirm={saveOrderEntry}
              onCancel={cancelEdit}
              navigation={navigation}
            />
          </View>
        ) : currentCreditEntry ? (
          <View style={styles.editOverlay}>
            <CreditReviewCard
              creditData={currentCreditEntry.credit}
              sourceText={currentCreditEntry.source_text}
              warnings={warnings}
              onConfirm={saveCreditEntry}
              onCancel={cancelEdit}
              navigation={navigation}
            />
          </View>
        ) : null}
        
        {/* Order Success Modal */}
        <Modal
          visible={showOrderSuccessModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowOrderSuccessModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
              <Text style={[styles.modalTitle, { color: colors.primary }]}>
                Order Created Successfully! 🎉
              </Text>
              
              {orderSuccessData && (
                <>
                  <Text style={[styles.modalMessage, { color: colors.text }]}>
                    Order {orderSuccessData.orderId} created for {orderSuccessData.customer}!
                  </Text>
                  
                  <View style={styles.modalDetails}>
                    <Text style={[styles.modalDetailText, { color: colors.text }]}>
                      Items: {orderSuccessData.itemCount}
                    </Text>
                    <Text style={[styles.modalDetailText, { color: colors.text }]}>
                      Total: ₹{orderSuccessData.total.toFixed(2)}
                    </Text>
                  </View>
                </>
              )}
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowOrderSuccessModal(false)}
              >
                <Text style={styles.modalButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        
        {/* Price Summary Modal */}
        <Modal
          visible={showSummaryModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowSummaryModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: colors.card, maxHeight: '80%', width: '90%' }]}>
              <Text style={[styles.modalTitle, { color: colors.primary }]}>
                Prices Updated Successfully! 💰
              </Text>
              
              <ScrollView style={styles.summaryScrollView} showsVerticalScrollIndicator={true}>
                <Text style={[styles.summaryText, { color: colors.text }]}>
                  {summaryMessage}
                </Text>
              </ScrollView>
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary, marginTop: 16 }]}
                onPress={() => setShowSummaryModal(false)}
              >
                <Text style={styles.modalButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        
        {/* Snackbar for notifications */}
        <Snackbar message="" />
      </View>
    </MainLayout>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  titleHighlight: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
  },
  iconButtonText: {
    fontSize: 20,
  },
  navigationContainer: {
    flexDirection: 'row',
    padding: 8,
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  navButton: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    marginHorizontal: 2,
    minWidth: 65,
    maxWidth: 85,
  },
  navButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  inputContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  editOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingVertical: 20,
    paddingHorizontal: 15,
    borderTopLeftRadius: 15, 
    borderTopRightRadius: 15,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 60,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    borderRadius: 12,
    padding: 24,
    margin: 20,
    minWidth: 280,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  modalDetails: {
    marginBottom: 20,
    alignItems: 'center',
  },
  modalDetailText: {
    fontSize: 14,
    marginBottom: 4,
    fontWeight: '500',
  },
  modalButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  summaryScrollView: {
    maxHeight: '60%',
    width: '100%',
    marginVertical: 8,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
}); 