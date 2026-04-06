import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const simulationTimerRef = useRef(null);
  const didStartSimulationRef = useRef(false);
  const busId = "bus-123"; 
  const targetLat = 28.962138;
  const targetLng = 77.092041;
  const simulationIntervalMs = 3000;
  const busSpeedKmh = 50;
  const metersPerTick = (busSpeedKmh * 1000 * simulationIntervalMs) / (60 * 60 * 1000);

  const stopSimulation = useCallback(() => {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    didStartSimulationRef.current = false;
  }, []);

  const movePointByMeters = useCallback((lat, lng, bearingDeg, distanceMeters) => {
    const earthRadiusMeters = 6371000;
    const bearing = (bearingDeg * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180;
    const angularDistance = distanceMeters / earthRadiusMeters;

    const nextLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance)
        + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    );

    const nextLngRad =
      lngRad
      + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLatRad),
      );

    return {
      lat: (nextLatRad * 180) / Math.PI,
      lng: (nextLngRad * 180) / Math.PI,
    };
  }, []);

  const calculateDistanceMeters = useCallback((fromLat, fromLng, toLat, toLng) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const dLat = toRad(toLat - fromLat);
    const dLng = toRad(toLng - fromLng);
    const lat1 = toRad(fromLat);
    const lat2 = toRad(toLat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
  }, []);

  const calculateBearing = useCallback((fromLat, fromLng, toLat, toLng) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;

    const lat1 = toRad(fromLat);
    const lat2 = toRad(toLat);
    const dLng = toRad(toLng - fromLng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }, []);

  const startSimulation = useCallback((startPoint) => {
    stopSimulation();
    let currentPoint = { ...startPoint };

    simulationTimerRef.current = setInterval(() => {
      const remainingDistance = calculateDistanceMeters(
        currentPoint.lat,
        currentPoint.lng,
        targetLat,
        targetLng,
      );

      if (remainingDistance <= metersPerTick) {
        currentPoint = { lat: targetLat, lng: targetLng };
      } else {
        const bearing = calculateBearing(
          currentPoint.lat,
          currentPoint.lng,
          targetLat,
          targetLng,
        );
        currentPoint = movePointByMeters(currentPoint.lat, currentPoint.lng, bearing, metersPerTick);
      }

      socket.emit('send-location', {
        busId,
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        capturedAt: new Date().toISOString(),
      });

      if (currentPoint.lat === targetLat && currentPoint.lng === targetLng) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
        didStartSimulationRef.current = false;
      }
    }, simulationIntervalMs);

    didStartSimulationRef.current = true;
  }, [
    busId,
    calculateBearing,
    calculateDistanceMeters,
    metersPerTick,
    movePointByMeters,
    simulationIntervalMs,
    stopSimulation,
    targetLat,
    targetLng,
  ]);

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

    return () => {
      stopSimulation();
      socket.disconnect();
    };
  }, [stopSimulation]);

  const toggleShift = () => {
    if (!BackgroundGeolocation) {
      return;
    }

    if (isTracking) { 
      BackgroundGeolocation.stop();
      stopSimulation();
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
        const startPoint = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        };

        socket.emit('send-location', {
          busId,
          lat: startPoint.lat,
          lng: startPoint.lng,
          capturedAt: location.timestamp || new Date().toISOString(),
        });

        startSimulation(startPoint);
      }).catch((error) => {
        console.warn('[GPS] Initial position unavailable:', error?.message || error);
        const fallbackPoint = { lat: targetLat, lng: targetLng };

        socket.emit('send-location', {
          busId,
          lat: fallbackPoint.lat,
          lng: fallbackPoint.lng,
          capturedAt: new Date().toISOString(),
        });
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
  warning: { fontSize: 14, color: '#b45309', marginBottom: 16, textAlign: 'center', paddingHorizontal: 20,backgroundColor:'#000000' },
  status: { fontSize: 18, marginBottom: 40 } 
});