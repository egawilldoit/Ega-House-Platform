import { StyleSheet, Text, View } from 'react-native';

export default function TimerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Timer</Text>
      <Text style={styles.subtitle}>Focus session placeholder.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
});
