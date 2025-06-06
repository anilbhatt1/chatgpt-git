/**
 * Custom hook for speech recognition
 * 
 * Provides a simple interface for components to use speech recognition
 * with intent-based fallback for Samsung/OneUI devices.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform, ToastAndroid, Linking } from 'react-native';
import { getSpeechRecognition, SpeechRecognitionResult, SpeechStatus } from '../utils/speech';
import Voice from '@react-native-voice/voice';
import * as IntentLauncher from 'expo-intent-launcher';
import { startHeadless, stopHeadless, preferredEngineFound, speechUnavailable } from '../utils/mobileSpeech';
import uuid from 'react-native-uuid';
import { parseSentence, parseSingleSentence, parsePriceSentence, parseEnhanced, ParsedResult, parseSentenceWithPriceLookup, isCreditCommand, parseCreditCommand } from '../utils/parsing';
import { getStorage } from '../utils/storage';
import { showQuickToast } from '../components/QuickToast';
import { 
  deleteEntry, 
  deleteBatch, 
  lookupPrice, 
  upsertPrice,
  getDatabase,
  deletePrice,
  saveSinglePrice,
  createOrder
} from '../utils/sqliteStorage';
import { useSettings } from '../state/context';
import { Entry } from '../state/types';

// Import the mobileSpeech implementation to ensure it's initialized
import '../utils/mobileSpeech';

interface UseSpeechRecognitionOptions {
  autoStopAfterFinalResult?: boolean;
  autoRequestPermissions?: boolean;
  onPermissionDenied?: () => void;
  onTranscriptParsed?: (entry: any, warnings: string[]) => void;
}

interface UseSpeechRecognitionResult {
  isListening: boolean;
  transcript: string;
  status: SpeechStatus;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  resetTranscript: () => void;
  isAvailable: boolean;
}

// Show a toast message only on Android
function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    console.log('Toast message (non-Android):', message);
  }
}

async function requestMicrophonePermission(): Promise<boolean> {
  // Only Android requires explicit mic permission
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'ShopNotes needs access to your microphone to record transactions by voice.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      return false;
    }
  }
  
  // Other platforms don't need explicit permission in the same way
  return true;
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
  const { 
    autoStopAfterFinalResult = true,
    autoRequestPermissions = true,
    onPermissionDenied,
    onTranscriptParsed
  } = options;
  
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const isActive = useRef(false);
  const lastActionTimestamp = useRef(0);
  const watchdog = useRef<NodeJS.Timeout | null>(null);
  // cache to skip probe on devices that fail once
  const alwaysUseIntent = useRef(!preferredEngineFound);
  const hasResults = useRef(false);
  
  // Get settings for quick-capture mode
  const settings = useSettings();
  
  // Log the settings at initialization
  // console.log('📊 INITIAL QUICK-CAPTURE SETTINGS:', settings);
  
  // Check if speech recognition is available on mount
  useEffect(() => {
    // console.log('📊 SETTINGS ON MOUNT:', settings);
    const speechRecognition = getSpeechRecognition();
    
    const checkAvailability = async () => {
      try {
        const available = await speechRecognition.isAvailable();
        setIsAvailable(available);
        
        if (!available && !speechUnavailable) {
          setError('Speech recognition is not available on this device');
          Alert.alert(
            'Speech Recognition Unavailable',
            'Your device does not support speech recognition or the language packs are not installed.',
            [
              { 
                text: 'OK', 
                onPress: () => console.log('Speech recognition unavailable alert closed') 
              }
            ]
          );
        }
      } catch (err) {
        console.error('Error checking speech recognition availability:', err);
        setIsAvailable(false);
        setError('Failed to check speech recognition availability');
      }
    };
    
    checkAvailability();
  }, []);
  
  // Set up listeners for speech recognition events - ONLY ONCE
  useEffect(() => {
    const speechRecognition = getSpeechRecognition();
    
    // Status change listener
    speechRecognition.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'listening') {
        isActive.current = true;
        setIsListening(true);
        setError(null);
      } else if (newStatus === 'idle' || newStatus === 'error' || newStatus === 'not-available') {
        isActive.current = false;
        setIsListening(false);
      }
    });
    
    // Result listener
    speechRecognition.onResult((result: SpeechRecognitionResult) => {
      // Cancel any pending watchdog timer
      if (watchdog.current) {
        clearTimeout(watchdog.current);
        watchdog.current = null;
      }
      
      hasResults.current = true;
      // console.log('✅ Speech results:', result.value);
      // console.log('📊 QUICK-CAPTURE SETTINGS AT RESULT:', settings.quickCapture);
      setTranscript(result.value);
      
      // Process transcript for quick-capture if enabled
      if (result.isFinal && result.value) {
        // console.log('📊 Processing final result with quickCapture:', settings.quickCapture);
        processFinalTranscript(result.value);
      }
      
      // Automatically stop listening if this is a final result and autoStop is enabled
      if (result.isFinal && autoStopAfterFinalResult) {
        Voice.stop()
          .then(() => {
            // console.log('Speech recognition stopped after final result');
            isActive.current = false;
          })
          .catch((error: unknown) => {
            console.error('Error stopping speech recognition:', error);
          });
      }
    });
    
    // Error listener
    speechRecognition.onError((err) => {
      console.log('❌ Speech error:', err.error, err.message);
      
      // Show toast for 'no match' errors
      if (err.error === 'no-match' || err.error === '7') {
        showToast("Didn't catch that, please try again");
      }
      
      setError(err.message);
      setIsListening(false);
      isActive.current = false;
    });
    
    // Direct Voice event handlers for additional debugging
    Voice.onSpeechResults = (e) => {
      // console.log('✅ Direct Voice results:', e.value);
    };
    
    Voice.onSpeechError = (e) => {
      // console.log('❌ Direct Voice error:', e);
      
      // Show toast for 'no match' errors (code 7)
      if (e.error && e.error.code === '7') {
        showToast("Didn't catch that, please try again");
      }
    };
    
    Voice.onSpeechEnd = (e) => {
      // console.log('🔚 Direct Voice speech end:', e);
      // We're only using intent-based recognition now, so this handler
      // should rarely get called, but still reset state to be safe
      isActive.current = false;
      setIsListening(false);
      hasResults.current = false;
    };
    
    // Cleanup listeners when component unmounts - ONLY ONCE
    return () => {
      clearTimeout(watchdog.current!);
      stopHeadless().finally(() => {
        Voice.destroy().catch((error) => {
          console.error('Error during final Voice.destroy():', error);
        });
      });
    };
  }, []); // Empty deps so it runs once
  
  // Process the final transcript and handle quick-capture if enabled
  const processFinalTranscript = async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      resetTranscript(); // Reset even if transcript is empty/whitespace
      return;
    }
    
    try {
      // IMPORTANT: Check for credit commands FIRST to prevent conflicts
      // Credit commands can contain "Rs" which would be detected as price commands
      if (isCreditCommand(finalTranscript)) {
        const parsedResult = await parseCreditCommand(finalTranscript);
        if (parsedResult.type === 'credit' && onTranscriptParsed && parsedResult.credit) {
          onTranscriptParsed({
            type: 'credit',
            credit: parsedResult.credit,
            source_text: finalTranscript,
            forceReview: parsedResult.forceReview
          }, parsedResult.warnings);
        }
        resetTranscript();
        return;
      }
      
      // IMPORTANT: Always check for price commands AFTER credit commands
      // This ensures consistent behavior between quick mode ON and OFF
      const priceUpdates = parsePriceSentence(finalTranscript);
      if (priceUpdates.length > 0) {
        // Price command detected - ALWAYS route through review (safety requirement)
        if (onTranscriptParsed) {
          if (priceUpdates.length > 1) {
            // Multiple price items - use multi-item price editor
            onTranscriptParsed({
              type: 'multi-price',
              priceUpdates,
              source_text: finalTranscript
            }, []);
          } else if (priceUpdates.length === 1) {
            // Single price item - use single price editor
            const singlePrice = priceUpdates[0];
            onTranscriptParsed({
              type: 'price',
              item: singlePrice.item,
              price: singlePrice.price,
              source_text: finalTranscript
            }, []);
          }
        }
        resetTranscript();
        return;
      }
      
      // Use enhanced parsing to detect command type for non-price commands
      const parsedResult: ParsedResult = await parseEnhanced(finalTranscript);
      
      // Handle different types of commands
      if (parsedResult.type === 'price') {
        // This should not happen since we checked price commands above,
        // but keeping for safety - route through the same price logic
        const priceUpdates = parsedResult.priceUpdates || [];
          if (onTranscriptParsed) {
          if (priceUpdates.length > 1) {
            onTranscriptParsed({
              type: 'multi-price',
              priceUpdates,
              source_text: finalTranscript
            }, []);
          } else if (priceUpdates.length === 1) {
            const singlePrice = priceUpdates[0];
            onTranscriptParsed({
              type: 'price',
              item: singlePrice.item,
              price: singlePrice.price,
                source_text: finalTranscript
            }, []);
          }
        }
        resetTranscript();
        return;
      }
      
      if (parsedResult.type === 'order') {
        // Order command - new functionality
        
        // Handle quick mode for orders - create order immediately for ANY number of items
        if (settings.quickCapture && parsedResult.order) {
          try {
            // createOrder is already imported at the top
            
            // Auto-lookup prices for items that don't have them
            const itemsWithPrices = await Promise.all(
              parsedResult.order.items.map(async (item) => {
                let price = item.price;
                if (!price || price <= 0) {
                  const lookedUpPrice = await lookupPrice(item.item);
                  price = lookedUpPrice || 0;
                }
                return {
                  item: item.item,
                  qty: item.qty,
                  price,
                  delivery_date: item.delivery_date || null
                };
              })
            );
            
            const orderId = await createOrder(
              parsedResult.order.customer || 'Walk-in',
              itemsWithPrices
            );
            
            showQuickToast(
              `Order ${orderId} created with ${itemsWithPrices.length} item${itemsWithPrices.length > 1 ? 's' : ''}`,
              () => {} // No undo for orders yet
            );
            
            resetTranscript();
            return;
          } catch (error) {
            console.error('Error creating order in quick mode:', error);
            showToast('❌ Failed to create order');
          }
        }
        
        // For non-quick mode, show review dialog with auto-lookup
        if (onTranscriptParsed && parsedResult.order) {
          // Auto-lookup prices for the review dialog
          const itemsWithAutoLookup = await Promise.all(
            parsedResult.order.items.map(async (item) => {
              let price = item.price;
              if (!price || price <= 0) {
                const lookedUpPrice = await lookupPrice(item.item);
                price = lookedUpPrice || 0;
              }
              return {
                ...item,
                price
              };
            })
          );
          
          // Update the order with auto-looked up prices
          const updatedOrder = {
            ...parsedResult.order,
            items: itemsWithAutoLookup
          };
          
          // Filter out price warnings if all items now have prices
          const itemsWithPrices = itemsWithAutoLookup.filter(item => item.price && item.price > 0);
          let filteredWarnings = parsedResult.warnings;
          
          if (itemsWithPrices.length === itemsWithAutoLookup.length) {
            // All items have prices, remove price warnings
            filteredWarnings = parsedResult.warnings.filter(warning => 
              !warning.toLowerCase().includes('price') && 
              !warning.toLowerCase().includes("don't have prices")
            );
          }
          
          // Pass the order data to the UI for review/creation
          onTranscriptParsed({
            type: 'order',
            order: updatedOrder,
            source_text: finalTranscript
          }, filteredWarnings);
        } else {
          console.warn('No handler for order command');
          showToast('📋 Order detected but no handler available');
        }
        
        resetTranscript();
        return;
      }
      
      if (parsedResult.type === 'credit') {
        // Credit command - already handled above in the dedicated credit section
        // This shouldn't happen since we check isCreditCommand first, but keeping for safety
        console.warn('Credit command detected in secondary parsing - this should not happen');
        resetTranscript();
        return;
      }
      
      // Transaction command - use enhanced parsing result or fallback to legacy
      let entry, warnings;
      if (parsedResult.type === 'transaction' && parsedResult.entry) {
        entry = parsedResult.entry;
        warnings = parsedResult.warnings;
      } else {
        // Fallback to legacy parser for compatibility
        const legacyResult = parseSingleSentence(finalTranscript);
        entry = legacyResult.entry;
        warnings = legacyResult.warnings;
      }
      
      // If quick-capture mode is enabled, save the entry directly
      if (settings.quickCapture) {
        const storage = await getStorage();
        const batchId = uuid.v4().toString();
        
        try {
          // Use enhanced parsing with price lookup
          const { entries: enhancedItems, warnings: enhancedWarnings } = await parseSentenceWithPriceLookup(finalTranscript);
          
          if (enhancedItems.length === 0) {
            // If no items could be parsed, use the single entry from enhanced parsing
            const entryToSave = entry || {
              item: finalTranscript.trim(),
              qty: 1,
              unit: '',
              price: 0,
              total: 0,
              type: 'cash-in',
              source_text: finalTranscript,
              transaction_date: new Date().toISOString(),
            };
            
            await storage.saveEntry({
              ...entryToSave,
              confirmed: false,
              batch_id: batchId
            });
            
            showQuickToast(
              `Saved: ${entryToSave.item}`,
              () => deleteBatch(batchId)
            );
          } else {
            // Use the enhanced items which already have price lookup applied
            const entriesToSave = enhancedItems.map(item => ({
              ...item,
                confirmed: false,
                batch_id: batchId,
                source_text: finalTranscript,
            }));
            
            // Use batch save instead of individual saves
            await storage.saveEntriesBatch(entriesToSave);
            
            // Show enhanced warnings in the toast if any auto-lookup happened
            const autoLookupWarnings = enhancedWarnings.filter(w => w.includes('Auto-populated'));
            const toastMessage = autoLookupWarnings.length > 0 
              ? `Saved ${enhancedItems.length} item${enhancedItems.length > 1 ? 's' : ''} (prices auto-filled)`
              : `Saved ${enhancedItems.length} item${enhancedItems.length > 1 ? 's' : ''}`;
            
            showQuickToast(
              toastMessage,
              () => deleteBatch(batchId)
            );
          }
        } catch (error) {
          console.error('Error in quick capture mode:', error);
          
          // Create a basic entry as fallback
          try {
            const fallbackEntry = entry || {
              item: finalTranscript.trim(),
              qty: 1,
              unit: '',
              price: 0,
              total: 0,
              type: 'cash-in',
              source_text: finalTranscript,
              transaction_date: new Date().toISOString(),
            };
            
            await storage.saveEntry({
              ...fallbackEntry,
              confirmed: false,
              batch_id: batchId
            });
            
            showQuickToast(
              `Saved: ${fallbackEntry.item}`,
              () => deleteBatch(batchId)
            );
          } catch (fallbackError) {
            console.error('Error saving fallback entry:', fallbackError);
            showToast('❌ Failed to save entry - please try again');
          }
        }
        
        resetTranscript();
        return;
      } else {
        // For non-quick-capture mode, show review dialog with enhanced price lookup
        if (onTranscriptParsed) {
          // Use enhanced parsing with price lookup for review dialog too
          const { entries: enhancedItems, warnings: enhancedWarnings } = await parseSentenceWithPriceLookup(finalTranscript);
          
          if (enhancedItems.length > 1) {
            // Multiple items detected - ensure all items have the full transcript as source_text
            const itemsWithFullSourceText = enhancedItems.map(item => ({
              ...item,
              source_text: finalTranscript
            }));
            
            // Pass them as an array with enhanced warnings
            onTranscriptParsed({ type: 'multiple-transactions', entries: itemsWithFullSourceText }, enhancedWarnings);
          } else if (enhancedItems.length === 1) {
            // Single item with enhanced price lookup
            const itemWithFullSourceText = {
              ...enhancedItems[0],
              source_text: finalTranscript
            };
            onTranscriptParsed(itemWithFullSourceText, enhancedWarnings);
        } else {
            // Fallback to original entry if enhanced parsing failed
            const itemWithFullSourceText = {
              ...entry,
              source_text: finalTranscript
            };
            onTranscriptParsed(itemWithFullSourceText, warnings);
          }
        }
        resetTranscript();
      }
    } catch (error) {
      console.error('Error parsing transcript:', error);
      resetTranscript(); // Reset transcript even on error
    }
  };
  
  // Apply debounce to prevent rapid start/stop
  const isActionAllowed = () => {
    const now = Date.now();
    // Check if 300ms has passed since last action
    if (now - lastActionTimestamp.current < 300) {
      // console.log('Debouncing speech action, too soon after last action');
      return false;
    }
    lastActionTimestamp.current = now;
    return true;
  };

  // Intent-based fallback function for Samsung/OneUI devices
  const fallbackToIntent = async (locale: string) => {
    // console.log('Starting intent fallback for Samsung/OneUI device');
    
    try {
      // Stop any active Voice session first
      if (isActive.current) {
        await Voice.stop().catch(err => console.warn('Error stopping Voice before intent:', err));
      }
      
      // Launch the speech recognition intent using expo-intent-launcher
      const result = await IntentLauncher.startActivityAsync('android.speech.action.RECOGNIZE_SPEECH', {
        extra: {
          'android.speech.extra.LANGUAGE_MODEL': 'free_form',
          'android.speech.extra.LANGUAGE': locale,
          'android.speech.extra.PROMPT': 'Speak your transaction…',
          'android.speech.extra.MAX_RESULTS': 1
        }
      });
      
      // console.log('Intent recognition complete:', result); 
      
      if (result.resultCode === IntentLauncher.ResultCode.Success) {
        let transcriptText = '';
        
        // Extract the transcript from the result
        if (result.extra && typeof result.extra === 'object') {
          const results = (result.extra as Record<string, any>)['android.speech.extra.RESULTS'];
          if (Array.isArray(results) && results.length > 0) {
            transcriptText = results[0] || '';
          }
        }
        
        // Fallback to alternative format if needed
        if (!transcriptText && result.data && Array.isArray(result.data) && result.data.length > 0) {
          transcriptText = result.data[0] || '';
        }
        
        if (transcriptText) {
          // console.log('Intent recognition result:', transcriptText);
          setTranscript(transcriptText);
          
          // Process the transcript if we got a result
          if (transcriptText.trim()) {
            processFinalTranscript(transcriptText);
          }
        } else {
          console.warn('Intent recognition succeeded but no text was returned');
          setError('No speech recognised');
        }
      } else if (result.resultCode === IntentLauncher.ResultCode.Canceled) {
        // User cancelled the speech input UI (e.g., by tapping outside or pressing back)
        console.log('Intent recognition cancelled by user with result code:', result.resultCode);
        // Do NOT set an error message here, as it's an intentional user action.
        // The 'finally' block will reset isListening.
      } else {
        // Other failure
        console.warn('Intent recognition failed with result code:', result.resultCode);
        setError('Speech recognition failed');
      }
    } catch (err) {
      console.error('Intent fallback error:', err instanceof Error ? err.message : String(err));
      setError('Failed to start speech recognition');
    } finally {
      // Always reset state
      isActive.current = false;
      setIsListening(false);
    }
  };
  
  // Start/restart listening function with graceful stop if needed
  const startListening = useCallback(async () => {
    // Debug log latest settings
    // console.log('📊 STARTING LISTENING with settings:', JSON.stringify(settings));
    
    // Debounce to prevent rapid start/stop
    if (!isActionAllowed()) return;
    
    try {
      if (!isAvailable && !speechUnavailable) {
        setError('Speech recognition is not available on this device');
        return;
      }
      
      // Request microphone permission if needed
      if (autoRequestPermissions) {
        const permissionGranted = await requestMicrophonePermission();
        if (!permissionGranted) {
          setError('Microphone permission denied');
          if (onPermissionDenied) {
            onPermissionDenied();
          }
          return;
        }
      }

      // If already active, stop gracefully first
      if (isActive.current) {
        // console.log('Recognition already active, stopping first...');
        try {
          await Voice.stop();
          // console.log('Stopped previous recognition session');
          // Short delay to ensure cleanup completes
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn('Error stopping previous recognition:', err);
        }
      }

      // Use the locale for Indian English
      const locale = 'en-IN';
      
      // Clear any previous errors
      setError(null);
      
      // Use intent-based approach for ALL devices
      // console.log('Using intent-based approach for all devices for maximum stability');
      return fallbackToIntent(locale);
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setError(`Failed to start speech recognition: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsListening(false);
      isActive.current = false;
    }
  }, [isAvailable, autoRequestPermissions, onPermissionDenied, onTranscriptParsed, settings]);
  
  // Stop listening function
  const stopListening = useCallback(async () => {
    // Debounce to prevent rapid start/stop
    if (!isActionAllowed()) return;
    
    try {
      console.log('Stopping speech recognition');
      if (isActive.current) {
        await Voice.stop();
        // console.log('Voice recognition stopped successfully');
      }
    } catch (err) {
      console.error('Error stopping speech recognition:', err);
    } finally {
      // Always reset state variables
      isActive.current = false;
      setIsListening(false);
      // Clear any pending watchdog timer
      if (watchdog.current) {
        clearTimeout(watchdog.current);
        watchdog.current = null;
      }
    }
  }, []);
  
  // Reset transcript function
  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);
  
  return {
    isListening,
    transcript,
    status,
    error,
    startListening,
    stopListening,
    resetTranscript,
    isAvailable: isAvailable || speechUnavailable === false
  };
} 