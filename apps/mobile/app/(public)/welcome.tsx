import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>WELCOME EGA</Text>
      <Text style={styles.subtitle}>Execution workspace on mobile.</Text>
      <Link href="/(public)/login" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Login</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#111827',
    borderRadius: 12,
    marginTop: 28,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  title: {
    color: '#0f172a',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
});
