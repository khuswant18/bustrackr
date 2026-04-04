import { Text, View } from "react-native";

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-950 px-6">
      <View className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <Text className="text-center text-3xl font-bold text-white">
          NativeWind is ready
        </Text>
        <Text className="mt-3 text-center text-base text-slate-300">
          Use className on React Native components in this app.
        </Text>
      </View>
    </View>
  );
}
