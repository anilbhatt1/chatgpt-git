import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { AppProvider } from './src/state/context';
import { HomeScreen } from './src/screens/HomeScreen';
import { View, Text, ActivityIndicator, Button, LogBox } from 'react-native';
import { getStorage } from './src/utils/storage';
import { initializeServices } from './src/services';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator, StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import SettingsScreen from './src/components/SettingsScreen';
import { QuickToast } from './src/components/QuickToast';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { PricesScreen } from './src/screens/PricesScreen';
import { EodReviewScreen } from './src/screens/EodReview/EodReviewScreen';
import { SimilarItemsScreen } from './src/screens/SimilarItemsScreen';
import { SyncNewItemsScreen } from './src/screens/SyncNewItemsScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { DeliveriesScreen } from './src/screens/DeliveriesScreen';
import CreditScreen from './src/screens/CreditScreen';
import CustomerCreditHistoryScreen from './src/screens/CustomerCreditHistoryScreen';
import { HomeButton } from './src/components/navigation/HomeButton';

// Ignore specific warnings in LogBox
LogBox.ignoreLogs([
  'Open debugger to view warnings.',
  'Debugger and device times have drifted',
  'Remote debugger is connected',
  'PanGestureHandler must be used as a descendant of GestureHandlerRootView'
]);

// Define navigation types
export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  PricesScreen: undefined;
  EodReviewScreen: undefined;
  OrdersScreen: undefined;
  DeliveriesScreen: undefined;
  SimilarItemsScreen: {
    entryData: any;
    onSelect: (updatedEntry: any) => void;
    onCancel?: () => void;
  };
  SyncNewItemsScreen: {
    discoveredItems: Array<{
      item: string;
      price: number;
      unit: string;
      last_sold_date: string;
      source_text: string;
      total_sales: number;
    }>;
    onItemsAdded: () => void;
  };
  CreditScreen: undefined;
  CustomerCreditHistoryScreen: {
    customerName: string;
  };
};

export type NavigationProp = StackNavigationProp<RootStackParamList>;
export type SimilarItemsScreenRouteProp = RouteProp<RootStackParamList, 'SimilarItemsScreen'>;
export type SyncNewItemsScreenRouteProp = RouteProp<RootStackParamList, 'SyncNewItemsScreen'>;

// Create a stack navigator
const Stack = createStackNavigator<RootStackParamList>();

// Create custom dark theme for navigation
const customDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#BB86FC',
    background: '#121212',
    card: '#1E1E1E',
    text: '#FFFFFF',
    border: '#272727',
    notification: '#FF0266',
  },
};

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [navigationKey, setNavigationKey] = useState(0);

  // Initialize storage and services during app startup
  useEffect(() => {
    let isMounted = true;
    
    const initialize = async () => {
      if (!isMounted) return;
      
      try {
        console.log('Initializing app...');
        setInitError(null);
        
        // Initialize storage with retry
        console.log('Initializing storage...');
        try {
          await getStorage();
          console.log('Storage initialized successfully');
        } catch (storageError) {
          console.error('Failed to initialize storage:', storageError);
          if (isMounted) {
            setInitError(`Storage initialization failed: ${storageError instanceof Error ? storageError.message : String(storageError)}`);
            return; // Exit early on storage error
          }
        }
        
        // Initialize services (including speech recognition) with better error handling
        console.log('Initializing services...');
        try {
          await initializeServices();
          console.log('Services initialized successfully');
        } catch (serviceError) {
          console.error('Failed to initialize services:', serviceError);
          if (isMounted) {
            // We'll still continue even with service errors, just log them
            console.warn('Continuing despite service initialization errors');
          }
        }
        
        // Successfully initialized
        if (isMounted) {
          setIsInitializing(false);
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        if (isMounted) {
          setInitError(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    initialize();
    
    // Cleanup
    return () => {
      isMounted = false;
    };
  }, [retryCount]);

  // Handle retry action
  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };

  // Loading screen while storage is initializing
  if (isInitializing) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: customDarkTheme.colors.background, padding: 20 }}>
            {initError ? (
              // Error state
              <>
                <Text style={{ color: '#ff6b6b', marginBottom: 20, textAlign: 'center' }}>
                  {initError}
                </Text>
                <Button 
                  title="Retry" 
                  onPress={handleRetry}
                  color={customDarkTheme.colors.primary}
                />
              </>
            ) : (
              // Loading state
              <>
                <ActivityIndicator size="large" color={customDarkTheme.colors.primary} />
                <Text style={{ marginTop: 20, color: customDarkTheme.colors.text }}>Initializing app...</Text>
              </>
            )}
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Main app with navigation
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppProvider>
            <BottomSheetModalProvider>
            <StatusBar 
              style="light"
              backgroundColor={customDarkTheme.colors.card}
              translucent={false}
            />
            <NavigationContainer 
              theme={customDarkTheme}
              key={`nav-container-${navigationKey}`}
            >
              <Stack.Navigator>
                <Stack.Screen 
                  name="Home" 
                  component={HomeScreen} 
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="Settings" 
                  component={SettingsScreen} 
                  options={{
                    title: 'Settings',
                    headerStyle: { backgroundColor: customDarkTheme.colors.card },
                    headerTintColor: customDarkTheme.colors.text,
                    headerBackTitle: 'Back',
                  }}
                />
                <Stack.Screen 
                  name="PricesScreen" 
                  component={PricesScreen} 
                  options={{
                    title: 'Prices',
                    headerStyle: { backgroundColor: customDarkTheme.colors.card },
                    headerTintColor: customDarkTheme.colors.text,
                    headerTitleStyle: { fontWeight: 'bold' },
                    headerLeft: () => <HomeButton />,
                  }}
                />
                <Stack.Screen 
                  name="EodReviewScreen" 
                  component={EodReviewScreen} 
                  options={{
                      title: 'Cash Review',
                      headerStyle: { backgroundColor: customDarkTheme.colors.card },
                      headerTintColor: customDarkTheme.colors.text,
                      headerTitleStyle: { fontWeight: 'bold' },
                      headerLeft: () => <HomeButton />,
                    }}
                  />
                  <Stack.Screen 
                    name="OrdersScreen" 
                    component={OrdersScreen} 
                    options={{
                      title: 'Orders',
                      headerStyle: { backgroundColor: customDarkTheme.colors.card },
                      headerTintColor: customDarkTheme.colors.text,
                      headerTitleStyle: { fontWeight: 'bold' },
                      headerLeft: () => <HomeButton />,
                    }}
                  />
                  <Stack.Screen 
                    name="SimilarItemsScreen" 
                    component={SimilarItemsScreen as any} 
                    options={{
                      title: 'Similar Items',
                    headerStyle: { backgroundColor: customDarkTheme.colors.card },
                    headerTintColor: customDarkTheme.colors.text,
                    headerTitleStyle: { fontWeight: 'bold' },
                    headerLeft: () => <HomeButton />,
                  }}
                />
                  <Stack.Screen 
                    name="SyncNewItemsScreen" 
                    component={SyncNewItemsScreen as any} 
                    options={{
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen 
                    name="DeliveriesScreen" 
                    component={DeliveriesScreen} 
                    options={{
                      title: 'Deliveries',
                      headerStyle: { backgroundColor: customDarkTheme.colors.card },
                      headerTintColor: customDarkTheme.colors.text,
                      headerTitleStyle: { fontWeight: 'bold' },
                      headerLeft: () => <HomeButton />,
                    }}
                  />
                  <Stack.Screen 
                    name="CreditScreen" 
                    component={CreditScreen} 
                    options={{
                      title: 'Credit',
                      headerStyle: { backgroundColor: customDarkTheme.colors.card },
                      headerTintColor: customDarkTheme.colors.text,
                      headerTitleStyle: { fontWeight: 'bold' },
                      headerLeft: () => <HomeButton />,
                    }}
                  />
                  <Stack.Screen 
                    name="CustomerCreditHistoryScreen" 
                    component={CustomerCreditHistoryScreen} 
                    options={{
                      title: 'Customer Credit History',
                      headerStyle: { backgroundColor: customDarkTheme.colors.card },
                      headerTintColor: customDarkTheme.colors.text,
                      headerTitleStyle: { fontWeight: 'bold' },
                      headerLeft: () => <HomeButton />,
                    }}
                  />
              </Stack.Navigator>
            </NavigationContainer>
            <QuickToast message="" onUndo={() => {}} />
            </BottomSheetModalProvider>
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
