import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Platform } from 'react-native';
import { socket } from '../../services/socketClient.js';

let BackgroundGeolocation = null;
if (Platform.OS !== 'web') {
  try {
    BackgroundGeolocation = require('react-native-background-geolocation').default;
  } catch {
    BackgroundGeolocation = null;
  }
}

export default function TrackingDashboard() {
  const [isTracking, setIsTracking] = useState(false);
  const [moduleReady, setModuleReady] = useState(!!BackgroundGeolocation);
  const busId = "bus-123"; 

  useEffect(() => {
    if (!BackgroundGeolocation) {
      setModuleReady(false);
      return;
    }

    BackgroundGeolocation.ready({
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: 20, // 20 meter
      stopTimeout: 5,     
      debug: true,        
      logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
      startOnBoot: false,
    }).then((state) => {
      setIsTracking(state.enabled);
    });

    const locationSubscription = BackgroundGeolocation.onLocation((location) => {
      console.log('[GPS] Location recorded:', location.coords.latitude);
      
      socket.emit('send-location', {
        busId: busId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        capturedAt: location.timestamp, 
      });
    });

    return () => {
      locationSubscription.remove();
      socket.disconnect();
    };
  }, []);

  const toggleShift = () => {
    if (!BackgroundGeolocation) {
      return;
    }

    if (isTracking) { 
      BackgroundGeolocation.stop();
      socket.disconnect();
      setIsTracking(false);
    } else { 
      socket.connect();
      BackgroundGeolocation.start();
      BackgroundGeolocation.getCurrentPosition({
        desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
        timeout: 30,
        samples: 1,
      }).then((location) => {
        console.log('[GPS] Initial position:', location.coords.latitude);
        socket.emit('send-location', {
          busId,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          capturedAt: location.timestamp,
        });
      }).catch((error) => {
        console.warn('[GPS] Initial position unavailable:', error?.message || error);
      });
      setIsTracking(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bus: {busId}</Text>
      {!moduleReady ? (
        <Text style={styles.warning}>
          Background tracking native module is unavailable. Run this screen in an Android/iOS development build (not Expo Go/web) after rebuilding the app.
        </Text>
      ) : null}
      <Text style={styles.status}>
        Status: {isTracking ? "🟢 Transmitting live" : "🔴 Offline"}
      </Text>
      <Button 
        title={isTracking ? "End Shift" : "Start Shift"} 
        onPress={toggleShift} 
        disabled={!moduleReady}
        color={isTracking ? "red" : "green"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  warning: { fontSize: 14, color: '#b45309', marginBottom: 16, textAlign: 'center', paddingHorizontal: 20 },
  status: { fontSize: 18, marginBottom: 40 }
});