import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * PostGIS Test Suite
 * Tests geographic queries and spatial operations on Route and RouteStop models
 */

async function runPostGISTests() {
  console.log("🌍 Starting PostGIS Tests...\n");

  try {
    // Test 1: Create a test school
    console.log("Test 1: Creating test data...");
    const school = await prisma.school.create({
      data: {
        name: "Test School for PostGIS",
        address: "123 Main St",
        city: "New York",
        state: "NY",
        country: "US",
        timezone: "America/New_York",
      },
    });
    console.log("✅ School created:", school.name);

    // Test 2: Create a route
    console.log("\nTest 2: Creating route...");
    const route = await prisma.route.create({
      data: {
        schoolId: school.id,
        name: "Morning Route A",
        type: "MORNING",
      },
    });
    console.log("✅ Route created:", route.name);

    // Test 3: Create multiple route stops with coordinates
    console.log("\nTest 3: Creating route stops with coordinates...");
    const stops = await Promise.all([
      prisma.routeStop.create({
        data: {
          routeId: route.id,
          name: "Stop 1 - School",
          lat: 40.7128,
          lng: -74.006,
          sequence: 1,
        },
      }),
      prisma.routeStop.create({
        data: {
          routeId: route.id,
          name: "Stop 2 - Central Park",
          lat: 40.7829,
          lng: -73.9654,
          sequence: 2,
        },
      }),
      prisma.routeStop.create({
        data: {
          routeId: route.id,
          name: "Stop 3 - Times Square",
          lat: 40.758,
          lng: -73.9855,
          sequence: 3,
        },
      }),
      prisma.routeStop.create({
        data: {
          routeId: route.id,
          name: "Stop 4 - Far Park",
          lat: 40.6501,
          lng: -73.949,
          sequence: 4,
        },
      }),
    ]);
    console.log(`✅ Created ${stops.length} route stops`);

    // Test 4: Calculate distances using raw SQL with PostGIS
    console.log("\nTest 4: Testing PostGIS distance calculations...");
    
    // Distance from Stop 1 to Stop 2
    const distanceResult = await prisma.$queryRaw<
      Array<{ distance_km: string }>
    >`
      SELECT 
        ST_DistanceSphere(
          ST_Point(${stops[0].lng}, ${stops[0].lat}),
          ST_Point(${stops[1].lng}, ${stops[1].lat})
        ) / 1000 as distance_km
    `;
    
    const distanceKm = parseFloat(distanceResult[0].distance_km);
    console.log(
      `✅ Distance from ${stops[0].name} to ${stops[1].name}: ${distanceKm.toFixed(
        2
      )} km`
    );

    // Test 5: Find stops within a radius
    console.log("\nTest 5: Finding stops within a radius...");
    
    const originLat = 40.7128;
    const originLng = -74.006;
    const radiusMeters = 5000; // 5 km

    const nearbyStops = await prisma.$queryRaw<
      Array<{ id: string; name: string; distance_m: string }>
    >`
      SELECT 
        rs.id,
        rs.name,
        ST_DistanceSphere(
          ST_Point(${originLng}, ${originLat}),
          ST_Point(rs.lng, rs.lat)
        ) as distance_m
      FROM "RouteStop" rs
      WHERE rs."routeId" = ${route.id}
      AND ST_DistanceSphere(
        ST_Point(${originLng}, ${originLat}),
        ST_Point(rs.lng, rs.lat)
      ) <= ${radiusMeters}
      ORDER BY distance_m ASC
    `;

    console.log(`✅ Found ${nearbyStops.length} stops within ${radiusMeters}m:`);
    nearbyStops.forEach((stop) => {
      console.log(
        `   - ${stop.name}: ${(parseFloat(stop.distance_m)).toFixed(2)}m away`
      );
    });

    // Test 6: Calculate total route distance by summing consecutive segments
    console.log("\nTest 6: Calculating route distance...");
    
    let totalDistance = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const dist = await prisma.$queryRaw<Array<{ distance: string }>>`
        SELECT 
          ST_DistanceSphere(
            ST_Point(${stops[i].lng}, ${stops[i].lat}),
            ST_Point(${stops[i + 1].lng}, ${stops[i + 1].lat})
          ) / 1000 as distance
      `;
      totalDistance += parseFloat(dist[0].distance);
    }

    console.log(`✅ Total route distance: ${totalDistance.toFixed(2)} km`);

    // Test 7: Check if a point is near the route
    console.log("\nTest 7: Checking if coordinates are near route...");
    
    const testLat = 40.7829; // Near Stop 2
    const testLng = -73.9654;
    const toleranceMeters = 1000; // 1 km

    const isNearRoute = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM "RouteStop" rs
      WHERE rs."routeId" = ${route.id}
      AND ST_DistanceSphere(
        ST_Point(${testLng}, ${testLat}),
        ST_Point(rs.lng, rs.lat)
      ) <= ${toleranceMeters}
    `;

    console.log(
      `✅ Point (${testLat}, ${testLng}) is near ${
        isNearRoute[0].count
      } route stop(s) within ${toleranceMeters}m`
    );

    // Test 8: Test with LocationPing data if exists
    console.log("\nTest 8: Testing with LocationPing proximity...");
    
    // First create a test trip
    const user = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `driver-postgis-test@${school.id}.local`,
        name: "Test Driver",
        role: "DRIVER",
      },
    });

    const bus = await prisma.bus.create({
      data: {
        schoolId: school.id,
        plateNumber: `TEST-${Date.now()}`,
        capacity: 40,
      },
    });

    const trip = await prisma.trip.create({
      data: {
        routeId: route.id,
        busId: bus.id,
        driverId: user.id,
        scheduledAt: new Date(),
      },
    });

    // Create location pings
    const pings = await Promise.all([
      prisma.locationPing.create({
        data: {
          tripId: trip.id,
          lat: 40.7128,
          lng: -74.006,
          accuracy: 10,
          speed: 15.5,
          capturedAt: new Date(),
        },
      }),
      prisma.locationPing.create({
        data: {
          tripId: trip.id,
          lat: 40.7829,
          lng: -73.9654,
          accuracy: 12,
          speed: 20.3,
          capturedAt: new Date(Date.now() + 300000), // 5 mins later
        },
      }),
    ]);

    // Check proximity between location pings and route stops
    const proximityCheck = await prisma.$queryRaw<
      Array<{
        ping_id: string;
        stop_id: string;
        stop_name: string;
        distance_m: string;
      }>
    >`
      SELECT 
        lp.id as ping_id,
        rs.id as stop_id,
        rs.name as stop_name,
        ST_DistanceSphere(
          ST_Point(lp.lng, lp.lat),
          ST_Point(rs.lng, rs.lat)
        ) as distance_m
      FROM "LocationPing" lp
      CROSS JOIN "RouteStop" rs
      WHERE lp."tripId" = ${trip.id}
      AND rs."routeId" = ${route.id}
      AND ST_DistanceSphere(
        ST_Point(lp.lng, lp.lat),
        ST_Point(rs.lng, rs.lat)
      ) <= 2000
      ORDER BY lp.id, distance_m ASC
    `;

    console.log(
      `✅ Found ${proximityCheck.length} ping-to-stop proximity matches within 2km:`
    );
    proximityCheck.forEach((match) => {
      console.log(
        `   - Ping near ${match.stop_name}: ${(
          parseFloat(match.distance_m) / 1000
        ).toFixed(3)} km`
      );
    });

    console.log("\n✅ All PostGIS tests completed successfully!\n");

    // Cleanup
    console.log("Cleaning up test data...");
    await prisma.trip.delete({ where: { id: trip.id } });
    await prisma.bus.delete({ where: { id: bus.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.route.delete({ where: { id: route.id } });
    await prisma.school.delete({ where: { id: school.id } });
    console.log("✅ Cleanup completed");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
runPostGISTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
