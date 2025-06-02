import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  ActivityIndicator,
  Modal,
  Pressable,
  Alert
} from 'react-native';
import { Entry } from '../../state/types';
import { useTheme } from '../../theme/ThemeContext';
import { PendingEntryCard } from '../../components/PendingEntryCard';
import { BatchCard } from '../../components/BatchCard';
import { FloatingActionButton } from '../../components/FloatingActionButton';
import { getPendingEntries, confirmAllPending, updateEntryConfirmed, getDatabase } from '../../utils/sqliteStorage';
import { showSnackbar } from '../../components/Snackbar';
import { useAppContext } from '../../state/context';
import { updateEntry, setEntries } from '../../state/actions';
import { getStorage } from '../../utils/storage';
import { EditableTransactionCard } from '../../components/EditableTransactionCard';
import { DeleteConfirmationModal } from '../../components/DeleteConfirmationModal';

interface PendingTabProps {
  selectedDate: Date;
  startTime: Date;
  endTime: Date;
  onPendingCountChanged?: (count: number) => void;
  handleDeleteEntry: (entry: Entry | { id: string, description: string }) => void;
  navigation?: any; // Add navigation prop for Find button
  parentRefreshTrigger?: number; // Add parent refresh trigger for external deletions
}

interface BatchInfo {
  batch_id: string;
  t0: string;
  rows: number;
  source_text?: string;
}

export const PendingTab: React.FC<PendingTabProps> = ({ 
  selectedDate,
  startTime,
  endTime,
  onPendingCountChanged,
  handleDeleteEntry,
  navigation,
  parentRefreshTrigger
}) => {
  const { colors } = useTheme();
  const { state, dispatch } = useAppContext();
  const [pendingEntries, setPendingEntries] = useState<Entry[]>([]);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConfirmingAll, setIsConfirmingAll] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  
  // Totals state
  const [totals, setTotals] = useState({
    cashIn: 0,
    cashOut: 0,
    net: 0
  });
  
  // Edit state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<Entry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Add navigation state tracking to prevent modal touch blocking
  const [isNavigatingFromModal, setIsNavigatingFromModal] = useState(false);
  
  // Add modal key to force re-render when needed
  const [modalKey, setModalKey] = useState(3000);
  
  // Add refresh trigger to reload data after local changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Batch deletion state
  const [batchDeleteModalVisible, setBatchDeleteModalVisible] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState<{id: string, description: string} | null>(null);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  
  // Prepare date string for SQLite queries
  const getFormattedDate = useCallback(() => {
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [selectedDate]);
  
  // Calculate totals based on entries
  const calculateTotals = useCallback((entriesList: Entry[]) => {
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
  }, []);

  // Load pending entries and batches
  const loadPendingData = useCallback(async () => {
    try {
      setIsLoading(true);
      const dateString = getFormattedDate();
      
      // Get pending entries with database-level time filtering
      const pendingResults = await getPendingEntries(dateString, startTime, endTime);
      
      // Convert to Entry objects
      const entries: Entry[] = pendingResults.map((row: any) => ({
        id: row.id,
        item: row.item,
        qty: row.qty,
        unit: row.unit,
        price: row.price,
        total: row.total,
        type: row.type === 'cash-in' ? 'cash-in' : 'cash-out',
        created_at: row.created_at,
        transaction_date: row.transaction_date,
        source_text: row.source_text || '',
        is_final: Boolean(row.is_final),
        user_id: row.user_id,
        version: row.version || 1,
        confirmed: false,
        batch_id: row.batch_id
      }));
      
      // No need for client-side time filtering - already done at database level
      setPendingEntries(entries);
      calculateTotals(entries);
      
      // Notify parent component about pending count
      if (onPendingCountChanged) {
        onPendingCountChanged(entries.length);
      }
      
      // Now process clusters (both batch_id and order_id based)
      const clustersMap = new Map<string, { entries: Entry[], earliestTime: string, type: 'batch' | 'order' }>();
      
      // First pass - collect batch_id based clusters
      entries.forEach(entry => {
        if (entry.batch_id && entry.batch_id !== 'single' && entry.batch_id !== '') {
          const key = `batch_${entry.batch_id}`;
          if (!clustersMap.has(key)) {
            clustersMap.set(key, {
              entries: [entry],
              earliestTime: entry.transaction_date,
              type: 'batch'
            });
          } else {
            const cluster = clustersMap.get(key)!;
            cluster.entries.push(entry);
            if (new Date(entry.transaction_date) < new Date(cluster.earliestTime)) {
              cluster.earliestTime = entry.transaction_date;
            }
          }
        }
      });
      
      // Second pass - collect order_id based clusters (for entries not already in batch clusters)
      entries.forEach(entry => {
        // Skip if already in a batch cluster
        if (entry.batch_id && entry.batch_id !== 'single' && entry.batch_id !== '') {
          return;
        }
        
        // Group by order_id if it exists
        if (entry.order_id && entry.order_id !== '') {
          const key = `order_${entry.order_id}`;
          if (!clustersMap.has(key)) {
            clustersMap.set(key, {
              entries: [entry],
              earliestTime: entry.transaction_date,
              type: 'order'
            });
          } else {
            const cluster = clustersMap.get(key)!;
            cluster.entries.push(entry);
            if (new Date(entry.transaction_date) < new Date(cluster.earliestTime)) {
              cluster.earliestTime = entry.transaction_date;
            }
          }
        }
      });
      
      // Convert clusters to BatchInfo objects
      const batchesInfo: BatchInfo[] = [];
      clustersMap.forEach((data, key) => {
        const sourceText = data.entries[0]?.source_text || '';
        batchesInfo.push({
          batch_id: key, // Use the full key to maintain uniqueness
          t0: data.earliestTime,
          rows: data.entries.length,
          source_text: sourceText
        });
      });
      
      // Sort by earliest time (newest first)
      batchesInfo.sort((a, b) => new Date(b.t0).getTime() - new Date(a.t0).getTime());
      
      setBatches(batchesInfo);

    } catch (error) {
      console.error('Error loading pending data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getFormattedDate, onPendingCountChanged, startTime, endTime, calculateTotals]);

  // Create a helper function to reload ALL entries to global state
  const reloadAllEntries = useCallback(async () => {
    try {
      const storage = await getStorage();
      const allEntriesFromDB = await storage.getAllEntries();
      dispatch(setEntries(allEntriesFromDB));      
    } catch (error) {
      console.error('Error reloading entries:', error);
    }
  }, [dispatch]);

  // Helper function to reload data while preserving expanded batch state
  const reloadDataPreservingExpandedState = useCallback(() => {
    loadPendingData();
  }, [loadPendingData]);

  // Initial load and reload when date changes
  useEffect(() => {
    loadPendingData();
  }, [loadPendingData, refreshTrigger, parentRefreshTrigger]);

  // Handle refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    loadPendingData();
  };

  // Format time for display
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${minutes} ${ampm}`;
  };

  // Handle confirm all
  const handleConfirmAll = async () => {
    if (pendingEntries.length === 0 || isConfirmingAll) return;
    
    try {
      setIsConfirmingAll(true);
      const dateString = getFormattedDate();
      
      // Use the built-in confirmAllPending function
      await confirmAllPending(dateString);
      
      // THEN, fully resync global state from DB
      await reloadAllEntries(); 
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      showSnackbar(`✅ Confirmed ${pendingEntries.length} entries`);
    } catch (error) {
      console.error('Error confirming entries:', error);
    } finally {
      setIsConfirmingAll(false);
    }
  };

  // Handle confirm batch/cluster
  const handleConfirmBatch = async (clusterId: string) => {
    try {
      const db = getDatabase();
      
      if (clusterId.startsWith('batch_')) {
        const actualBatchId = clusterId.substring(6);
      // Update all entries in the batch
      await db.runAsync(
        `UPDATE entries
           SET confirmed = 1, version = version + 1
         WHERE batch_id = ? AND confirmed = 0`,
          [actualBatchId]
      );
      } else if (clusterId.startsWith('order_')) {
        const actualOrderId = clusterId.substring(6);
        // Update all entries with the same order_id
        await db.runAsync(
          `UPDATE entries
             SET confirmed = 1, version = version + 1
           WHERE order_id = ? AND confirmed = 0`,
          [actualOrderId]
        );
      }
      
      // Reload data
      await reloadAllEntries();
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      showSnackbar('✅ Cluster confirmed');
    } catch (error) {
      console.error('Error confirming cluster:', error);
    }
  };

  // Handle single entry update
  const handleEntryUpdated = () => {
    reloadDataPreservingExpandedState();
    // Also trigger refresh to ensure immediate UI updates for deletions
    setRefreshTrigger(prev => prev + 1);
  };
  
  // Handle edit entry
  const handleEditEntry = (entry: Entry) => {
    setEntryToEdit(entry);
    setEditModalVisible(true);
  };
  
  // Handle edit confirmation
  const handleEditConfirm = async (updatedEntry: Partial<Entry>) => {
    if (!entryToEdit) return;
    
    try {
      setIsEditing(true);
      
      // Ensure ID is set
      const entryWithId = {
        ...updatedEntry,
        id: entryToEdit.id
      };
      
      // Update in database
      const storage = await getStorage();
      await storage.updateEntry(entryToEdit.id, updatedEntry);
      
      // Update state
      await reloadAllEntries();
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      // Show success message
      showSnackbar('✅ Entry updated');
      
      // Close modal
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

  // Handle delete batch/cluster with confirmation dialog
  const handleDeleteBatch = async (clusterId: string) => {
    // Find the cluster to get item count for the confirmation message
    const cluster = batches.find(b => b.batch_id === clusterId);
    if (!cluster) return;
    
    // Show custom delete confirmation modal
    setBatchToDelete({
      id: clusterId,
      description: `${cluster.rows} items`
    });
    setBatchDeleteModalVisible(true);
  };

  // Confirm cluster deletion
  const confirmBatchDelete = async () => {
    if (!batchToDelete) return;
    
    try {
      setIsDeletingBatch(true);
      const db = getDatabase();
      
      if (batchToDelete.id.startsWith('batch_')) {
        const actualBatchId = batchToDelete.id.substring(6);
      
      // Get all entries in this batch for logging purposes
      const entriesToDelete = await db.getAllAsync(
        'SELECT id, item FROM entries WHERE batch_id = ? AND confirmed = 0',
          [actualBatchId]
      );
      
      // Delete all entries in the batch
      await db.runAsync(
        'DELETE FROM entries WHERE batch_id = ? AND confirmed = 0',
          [actualBatchId]
        );
      } else if (batchToDelete.id.startsWith('order_')) {
        const actualOrderId = batchToDelete.id.substring(6);
        
        // Get all entries with this order_id for logging purposes
        const entriesToDelete = await db.getAllAsync(
          'SELECT id, item FROM entries WHERE order_id = ? AND confirmed = 0',
          [actualOrderId]
        );
        
        // Delete all entries with the same order_id
        await db.runAsync(
          'DELETE FROM entries WHERE order_id = ? AND confirmed = 0',
          [actualOrderId]
      );
      }
      
      // Reload data
      await reloadAllEntries();
      
      // Trigger local data refresh to update UI immediately
      setRefreshTrigger(prev => prev + 1);
      
      showSnackbar(`🗑️ Deleted items from cluster`);
    } catch (error) {
      console.error('Error deleting cluster:', error);
      showSnackbar('❌ Failed to delete cluster');
    } finally {
      setIsDeletingBatch(false);
      setBatchDeleteModalVisible(false);
      setBatchToDelete(null);
    }
  };

  // Cancel batch deletion
  const cancelBatchDelete = () => {
    setBatchDeleteModalVisible(false);
    setBatchToDelete(null);
  };

  if (isLoading && !isRefreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>
          Loading pending entries...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {pendingEntries.length > 0 ? (
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
                <Text style={[styles.summaryLabel, { color: colors.text }]}>Net Pending</Text>
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

          {/* Batches List */}
          <FlatList
            data={batches}
            renderItem={({ item }) => {
              // For single items, render a PendingEntryCard directly
              if (item.rows === 1) {
                // Find the corresponding entry for this single-item cluster
                let entry: Entry | undefined;
                
                if (item.batch_id.startsWith('batch_')) {
                  const actualBatchId = item.batch_id.substring(6);
                  entry = pendingEntries.find(e => e.batch_id === actualBatchId);
                } else if (item.batch_id.startsWith('order_')) {
                  const actualOrderId = item.batch_id.substring(6);
                  entry = pendingEntries.find(e => e.order_id === actualOrderId);
                }
                
                if (entry) {
                  return (
                    <PendingEntryCard
                      key={entry.id}
                      entry={entry}
                      onEntryUpdated={handleEntryUpdated}
                      handleDeleteEntry={handleDeleteEntry}
                      onEdit={handleEditEntry}
                      showSourceText={true} // Show source text for individual items
                    />
                  );
                }
                
                // Fallback in case entry isn't found (shouldn't happen in normal circumstances)
                return null;
              }
              
              // For multi-item clusters, use BatchCard
              return (
                <BatchCard 
                  batchId={item.batch_id}
                  rows={item.rows}
                  time={formatTime(item.t0)}
                  onConfirmAll={() => handleConfirmBatch(item.batch_id)}
                  onDeleteAll={() => handleDeleteBatch(item.batch_id)}
                  handleDeleteEntry={handleDeleteEntry}
                  onEntryUpdated={handleEntryUpdated}
                  onEdit={handleEditEntry}
                  isExpanded={expandedBatches.has(item.batch_id)}
                  onToggleExpand={() => toggleBatchExpand(item.batch_id)}
                  source_text={item.source_text}
                />
              );
            }}
            keyExtractor={item => `batch-${item.batch_id}`}
            contentContainerStyle={styles.listContent}
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
        </>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No pending entries for this date
          </Text>
        </View>
      )}
      
      {pendingEntries.length > 0 && (
        <FloatingActionButton
          onPress={handleConfirmAll}
          label={`Confirm All (${pendingEntries.length})`}
          icon="✓"
          isLoading={isConfirmingAll}
          disabled={isConfirmingAll}
        />
      )}
      
      {/* Edit Entry Modal */}
      <Modal
        key={modalKey}
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
          <Pressable 
            style={styles.modalContainer}
            onPress={e => e.stopPropagation()}
            pointerEvents={isNavigatingFromModal ? 'none' : 'auto'}
          >
            {entryToEdit && (
              <EditableTransactionCard
                entry={entryToEdit}
                onConfirm={handleEditConfirm}
                onCancel={handleEditCancel}
                isLoading={isEditing}
                navigation={navigation}
                onNavigationStart={() => {
                  setIsNavigatingFromModal(true);
                }}
                onNavigationReturn={() => {
                  setIsNavigatingFromModal(false);
                  setModalKey(prev => prev + 1);
                }}
                onEntryChange={(updatedEntry) => {
                  setEntryToEdit(updatedEntry as Entry);
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
      
      {/* Batch Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={batchDeleteModalVisible}
        itemDescription={batchToDelete?.description || ''}
        isLoading={isDeletingBatch}
        onConfirm={confirmBatchDelete}
        onCancel={cancelBatchDelete}
        title="Confirm Delete"
        message="Are you sure you want to delete this batch?"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  listContent: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 80,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: 'transparent',
    borderRadius: 8,
    padding: 0,
  },
  // Summary card styles
  summaryCard: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    marginHorizontal: 8,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryColumn: {
    flex: 1,
    alignItems: 'center',
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
}); 