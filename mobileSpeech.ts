/**
 * Mobile Speech Recognition Implementation
 * 
 * Android-specific implementation of the speech recognition interface
 * using @react-native-voice/voice with intent-based fallback for Samsung/OneUI devices.
 */

import Voice, { 
  SpeechErrorEvent,
  SpeechResultsEvent, 
  SpeechRecognizedEvent,
  SpeechStartEvent,
  SpeechEndEvent,
  SpeechVolumeChangeEvent
} from '@react-native-voice/voice';
import { Platform } from 'react-native';
import { 
  SpeechRecognition, 
  SpeechRecognitionResult, 
  SpeechRecognitionError,
  SpeechStatus,
  SpeechRecognitionOptions,
  setImplementation
} from './speech';

// Default preferred locale for India-focused app
const DEFAULT_LOCALE = 'en-IN';
// Fallback locales in order of preference
const FALLBACK_LOCALES = ['en-US', 'en-UK', 'en'];

// Track whether a head-less recogniser is currently running
let isActive = false;

// Flag to track if preferred engine was found
export let preferredEngineFound: boolean = false;

// Built‑in module doesn't expose canHandle; assume true on GMS devices
export const canHandleIntent = true;

// Flag to indicate if speech is completely unavailable
export let speechUnavailable = true; // temp, will refresh when initialized

/**
 * Start headless speech recognition
 */
export async function startHeadless(locale: string): Promise<void> {
  try {
    if (isActive) {
      console.log('startHeadless: Already active, ignoring duplicate call');
      return; // already listening
    }
    
    const speechOptions: any = {
      EXTRA_LANGUAGE_MODEL: 'free_form', 
      EXTRA_MAX_RESULTS: 3,
      EXTRA_PARTIAL_RESULTS: true,
      EXTRA_LANGUAGE: locale,
      
      // More generous timeouts
      EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1500,
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
    };
    
    // Specify Google's speech recognition service as preferred
    if (Platform.OS === 'android') {
      speechOptions.EXTRA_CALLING_PACKAGE = 'com.google.android.googlequicksearchbox';
    }
    
    console.log('startHeadless: Starting Voice.start with locale:', locale);
    await Voice.start(locale, speechOptions);
    isActive = true;
    console.log('startHeadless: Successfully started');
  } catch (err) {
    console.error('startHeadless: Error starting headless recognition:', err instanceof Error ? err.message : err);
    isActive = false;
    throw err;
  }
}

/**
 * Stop headless speech recognition
 */
export async function stopHeadless(): Promise<void> {
  let stopErrorOccurred = false;
  
  try {
    if (!isActive) {
      console.log('stopHeadless: Not active, nothing to stop');
      return;
    }
    
    console.log('stopHeadless: Stopping headless recognition');
    
    try {
      await Voice.stop();
      console.log('stopHeadless: Voice.stop() completed successfully');
    } catch (stopError) {
      stopErrorOccurred = true;
      console.warn('stopHeadless: Error in Voice.stop():', stopError instanceof Error ? stopError.message : String(stopError));
      
      // Even if Voice.stop fails, we should try to cleanup
      try {
        Voice.destroy();
        console.log('stopHeadless: Voice.destroy() called after stop failure');
      } catch (destroyError) {
        console.error('stopHeadless: Failed to destroy after stop failure:', destroyError instanceof Error ? destroyError.message : String(destroyError));
      }
    }
    
    if (!stopErrorOccurred) {
      console.log('stopHeadless: Successfully stopped');
    }
  } catch (err) {
    console.error('stopHeadless: Unexpected error stopping headless recognition:', err instanceof Error ? err.message : String(err));
  } finally {
    // Always ensure the isActive flag is reset
    if (isActive) {
      console.log('stopHeadless: Resetting isActive flag to false');
      isActive = false;
    }
  }
}

// Async scan – refresh the flags once services are known
(async () => {
  try {
    const pkgs = await Voice.getSpeechRecognitionServices();
    if (pkgs && Array.isArray(pkgs)) {
      preferredEngineFound = pkgs.includes(
        'com.google.android.googlequicksearchbox'
      );
      // refresh the public flag now that we know the real engine state
      speechUnavailable = !preferredEngineFound && !canHandleIntent;
      console.log('Speech services:', pkgs,
                  'preferred =', preferredEngineFound,
                  'unavailable =', speechUnavailable);
    }
  } catch (e) {
    console.warn('Could not list speech services', e);
  }
})();

class MobileSpeechRecognition implements SpeechRecognition {
  private status: SpeechStatus = 'idle';
  private resultCallback: ((result: SpeechRecognitionResult) => void) | null = null;
  private errorCallback: ((error: SpeechRecognitionError) => void) | null = null;
  private statusCallback: ((status: SpeechStatus) => void) | null = null;
  private preferredLocale: string = DEFAULT_LOCALE;
  
  constructor() {
    // Set up event listeners with proper binding
    this.handleSpeechStart = this.handleSpeechStart.bind(this);
    this.handleSpeechRecognized = this.handleSpeechRecognized.bind(this);
    this.handleSpeechEnd = this.handleSpeechEnd.bind(this);
    this.handleSpeechError = this.handleSpeechError.bind(this);
    this.handleSpeechResults = this.handleSpeechResults.bind(this);
    this.handleSpeechVolumeChanged = this.handleSpeechVolumeChanged.bind(this);
    
    // Register the event handlers
    Voice.onSpeechStart = this.handleSpeechStart;
    Voice.onSpeechRecognized = this.handleSpeechRecognized;
    Voice.onSpeechEnd = this.handleSpeechEnd;
    Voice.onSpeechError = this.handleSpeechError;
    Voice.onSpeechResults = this.handleSpeechResults;
    Voice.onSpeechVolumeChanged = this.handleSpeechVolumeChanged;
    
    // Check for available speech services
    this.initialize();
  }
  
  /**
   * Initialize preferred locale and verify availability of STT services.
   */
  public async initialize(): Promise<void> {
    try {
      // Check if any voice services are available on the device
      const isDeviceGenerallyAvailable = await Voice.isAvailable(); 
      if (!isDeviceGenerallyAvailable) {
        console.warn('Voice.isAvailable() returned false. No voice services detected on device.');
        this.setStatus('not-available');
        this.handleError({
          error: 'device-not-available',
          message: 'No voice recognition services found on this device.',
        });
        return;
      }

      // Get available speech recognition services
      const availablePackages = await Voice.getSpeechRecognitionServices() as string[];
      console.log('Available speech services:', availablePackages);
      
      // Check if Google's speech recognition is available
      if (availablePackages && Array.isArray(availablePackages)) {
        preferredEngineFound = availablePackages.includes(
          'com.google.android.googlequicksearchbox'
        );
        
        if (availablePackages.length === 0) {
          console.warn('No STT service packages found.');
          this.setStatus('not-available');
          this.handleError({
            error: 'no-stt-package',
            message: 'No suitable Speech-To-Text service package found on this device.',
          });
          return;
        }
      }
      
      this.preferredLocale = DEFAULT_LOCALE;
      this.setStatus('idle');
    } catch (error) {
      console.error('Failed to initialize speech recognition logic:', error);
      this.setStatus('not-available');
      this.handleError({
        error: 'init-logic-failed',
        message: `Failed to initialize STT: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  
  /**
   * Start listening for speech
   */
  public async startListening(options?: SpeechRecognitionOptions): Promise<void> {
    try {
      const deviceIsAvailable = await Voice.isAvailable();
      if (!deviceIsAvailable) {
        console.warn('Voice.isAvailable() returned false. Cannot start listening.');
        this.setStatus('not-available');
        this.handleError({
          error: 'not-available',
          message: 'No voice services found on this device. Cannot start listening.',
        });
        return;
      }

      if (this.status === 'not-available') {
        console.warn('Attempted to start listening, but current status is not-available.');
        this.handleError({
          error: 'not-available',
          message: 'Speech recognition service is not properly initialized or available.',
        });
        return;
      }

      this.setStatus('listening');
      
      const locale = options?.locale || this.preferredLocale;
      await startHeadless(locale);
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      this.setStatus('error');
      this.handleError({
        error: 'start-failed',
        message: `Failed to start listening: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  
  /**
   * Stop listening for speech
   */
  public async stopListening(): Promise<void> {
    try {
      this.setStatus('processing');
      await stopHeadless();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
    }
  }
  
  /**
   * Check if speech recognition is available on this device
   */
  public async isAvailable(): Promise<boolean> {
    try {
      // isAvailable() not directly exposed in the library, so we check if we can get locales
      const locales = await Voice.getSpeechRecognitionServices() as string[];
      return Array.isArray(locales) && locales.length > 0;
    } catch (error) {
      console.error('Failed to check if speech recognition is available:', error);
      return false;
    }
  }
  
  /**
   * Check if the preferred locale is available
   */
  public async isLocaleAvailable(locale: string): Promise<boolean> {
    try {
      const locales = await this.getAvailableLocales();
      return locales.includes(locale);
    } catch (error) {
      console.error('Failed to check if locale is available:', error);
      return false;
    }
  }
  
  /**
   * Get a list of available STT locales, filtering out TTS services
   */
  public async getAvailableLocales(): Promise<string[]> {
    try {
      const services = await Voice.getSpeechRecognitionServices() as string[];
      if (!Array.isArray(services)) {
        console.warn('Voice.getSpeechRecognitionServices() did not return an array.');
        return [];
      }
      
      // Filter out known TTS services or services that don't look like STT
      const sttServices = services.filter(service => 
        service && typeof service === 'string' && !service.toLowerCase().includes('tts')
      );
      
      // Filter out Samsung Bixby - we don't want to use it as it has issues
      const preferredServices = sttServices.filter(service => 
        !service.includes('com.samsung.android.bixby.agent')
      );
      
      return preferredServices;
    } catch (error) {
      console.error('Failed to get available locales:', error);
      return [];
    }
  }
  
  /**
   * Get the current status of speech recognition
   */
  public getStatus(): SpeechStatus {
    return this.status;
  }
  
  /**
   * Register for result events
   */
  public onResult(callback: (result: SpeechRecognitionResult) => void): void {
    this.resultCallback = callback;
  }
  
  /**
   * Register for error events
   */
  public onError(callback: (error: SpeechRecognitionError) => void): void {
    this.errorCallback = callback;
  }
  
  /**
   * Register for status change events
   */
  public onStatusChange(callback: (status: SpeechStatus) => void): void {
    this.statusCallback = callback;
  }
  
  /**
   * Cleanup and remove all listeners
   */
  public async destroy(): Promise<void> {
    try {
      await stopHeadless();
      
      // Remove event handlers by setting them to dummy functions
      Voice.onSpeechStart = () => {};
      Voice.onSpeechRecognized = () => {};
      Voice.onSpeechEnd = () => {};
      Voice.onSpeechError = () => {};
      Voice.onSpeechResults = () => {};
      Voice.onSpeechVolumeChanged = () => {};
      
      // Clear callbacks
      this.resultCallback = null;
      this.errorCallback = null;
      this.statusCallback = null;
      
      // Reset status
      this.setStatus('idle');
    } catch (error) {
      console.error('Error during speech recognition destroy:', error);
    }
  }
  
  private handleSpeechStart(event: SpeechStartEvent): void {
    console.log('Speech start event:', event);
    this.setStatus('listening');
  }
  
  private handleSpeechRecognized(event: SpeechRecognizedEvent): void {
    console.log('Speech recognized event:', event);
  }
  
  private handleSpeechEnd(event: SpeechEndEvent): void {
    try {
      console.log('Speech end event:', event);
      
      // Important: On some devices, the Speech end event can cause crashes
      // Set to idle immediately rather than processing to avoid potential issues
      this.setStatus('idle');
      
      // Don't wait for results that might never come - they'll update status if they do arrive
      console.log('Speech end: Setting status to idle immediately for stability');
    } catch (err) {
      console.error('Error handling speech end event:', err instanceof Error ? err.message : String(err));
      // Make sure we still reset to idle
      try {
        this.setStatus('idle');
      } catch (statusError) {
        console.error('Failed to reset status after speech end error:', statusError);
      }
    }
  }
  
  private handleSpeechError(event: SpeechErrorEvent): void {
    console.error('Speech error event:', event);
    
    // Format the error message
    const errorCode = event.error?.code || event.error;
    let errorMessage = 'An unknown error occurred during speech recognition';
    
    // Error codes from Voice library
    switch (errorCode) {
      case '1':
        errorMessage = 'Network error or service unavailable';
        break;
      case '2':
        errorMessage = 'Network operation timed out';
        break;
      case '3':
        errorMessage = 'Audio recording error';
        break;
      case '4':
        errorMessage = 'Server error';
        break;
      case '5':
        errorMessage = 'Client side error';
        break;
      case '6':
        errorMessage = 'Speech timeout';
        break;
      case '7':
        errorMessage = 'No match found for your speech';
        break;
      case '8':
        errorMessage = 'Recognition service busy';
        break;
      case '9':
        errorMessage = 'Insufficient permissions';
        break;
      default:
        // Try to get a more specific error message if available
        if (event.error && typeof event.error === 'object' && 'message' in event.error) {
          errorMessage = String(event.error.message);
        } else if (typeof event.error === 'string') {
          errorMessage = event.error;
        }
    }
    
    // Set status and trigger error callback
    this.setStatus('error');
    this.handleError({
      error: errorCode ? String(errorCode) : 'unknown',
      message: errorMessage,
    });
  }
  
  private handleSpeechResults(event: SpeechResultsEvent): void {
    try {
      console.log('Speech results event:', event);
      
      if (!event.value || !Array.isArray(event.value) || event.value.length === 0) {
        console.warn('Received speech results but no valid value array');
        return;
      }
      
      // Get the best result (first in the array)
      const bestResult = event.value[0];
      
      if (this.resultCallback) {
        try {
          this.resultCallback({
            value: bestResult,
            isFinal: true // All results from the Voice library are final
          });
          console.log('Successfully delivered speech result to callback');
        } catch (callbackError) {
          console.error('Error in result callback:', callbackError instanceof Error ? callbackError.message : String(callbackError));
        }
      } else {
        console.warn('No result callback registered to receive results');
      }
      
      // After delivering final result, set status back to idle
      this.setStatus('idle');
    } catch (err) {
      console.error('Error handling speech results:', err instanceof Error ? err.message : String(err));
      // Make sure we reset the status regardless of errors
      try {
        this.setStatus('idle');
      } catch (statusError) {
        console.error('Failed to reset status in results handler:', statusError);
      }
    }
  }
  
  private handleSpeechVolumeChanged(event: SpeechVolumeChangeEvent): void {
    // Optional: could be used to show volume level in UI
    // console.log('Speech volume changed:', event.value);
  }
  
  private handleError(error: SpeechRecognitionError): void {
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
  
  private setStatus(status: SpeechStatus): void {
    if (this.status !== status) {
      this.status = status;
      if (this.statusCallback) {
        this.statusCallback(status);
      }
    }
  }
}

// Create and register the implementation
const mobileSpeechRecognition = new MobileSpeechRecognition();
setImplementation(mobileSpeechRecognition);

export default mobileSpeechRecognition; 