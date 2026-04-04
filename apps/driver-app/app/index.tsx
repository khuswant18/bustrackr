import { Text, View } from "react-native";
import { Link } from "expo-router";
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-950 px-6">
      <View className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <Text className="text-center text-3xl font-bold text-white">
          Driver bsdk
        </Text>
        <Link href="/screens/TrackingDashboard" className="mt-5 rounded bg-blue-500 px-4 py-2">
          <Text className="text-white">Go to Tracking Dashboard</Text>
        </Link>
      </View>
    </View>
  );
}
