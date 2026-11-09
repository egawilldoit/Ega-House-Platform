import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchMobileDailyCheckin,
  saveMobileDailyCheckin,
} from '@/lib/api/checkins';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';
import { todayQueryKeys } from '@/features/today/query';
import type { ExpenseCategory } from '@ega/domain/expenses';

/**
 * Mobile quick actions (PO-15, issue #360): quick expense + evening check-in
 * over the canonical Hono/api-client contracts. Expense creates use one
 * stable idempotency key per logical purchase (rotated only after success),
 * so double taps and retries can never duplicate a record.
 */

const QUICK_CATEGORIES: ExpenseCategory[] = ['coffee', 'groceries', 'eating_out', 'transport', 'other'];

function createIdempotencyKey(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `quick-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function useTodayQuickActions(localDate: string, timezone: string) {
  const queryClient = useQueryClient();
  // One stable key per logical purchase; rotated only after a successful
  // save so retries/timeouts deduplicate instead of duplicating, and the
  // next purchase gets a fresh key.
  const [expenseKey, setExpenseKey] = useState(createIdempotencyKey);
  const [report, setReport] = useState<string | null>(null);

  const checkinQuery = useQuery({
    queryKey: ['checkins', localDate, timezone],
    queryFn: () => fetchMobileDailyCheckin(localDate, timezone),
  });

  const expenseMutation = useMutation({
    mutationFn: async (input: { amountMinor: number; category: ExpenseCategory }) => {
      const response = await getMobileEgaApiClient().expenses.create({
        occurredAt: new Date().toISOString(),
        amountMinor: input.amountMinor,
        category: input.category,
        needVsWant: 'want',
        idempotencyKey: expenseKey,
      });
      return unwrapApiResult(response);
    },
    onSuccess: (response) => {
      setReport(
        response.replayed
          ? 'Expense already recorded (retry deduplicated) — the next save is a new purchase.'
          : 'Expense recorded.',
      );
      // Rotate only after success: a second purchase must never replay the
      // first record, while failures keep the key for safe retries.
      setExpenseKey(createIdempotencyKey());
      queryClient.invalidateQueries({ queryKey: todayQueryKeys.all }).catch(() => undefined);
    },
    onError: (error) => {
      setReport(error instanceof Error ? error.message : 'Expense failed — retry keeps the same purchase.');
    },
  });

  const checkinMutation = useMutation({
    mutationFn: (patch: { outcomes: string }) =>
      saveMobileDailyCheckin(localDate, timezone, { outcomes: patch.outcomes }),
    onSuccess: () => {
      setReport('Check-in saved for today.');
      queryClient.invalidateQueries({ queryKey: ['checkins', localDate, timezone] }).catch(() => undefined);
    },
    onError: (error) => {
      setReport(error instanceof Error ? error.message : 'Check-in failed — your text is still here.');
    },
  });

  return useMemo(
    () => ({ checkinQuery, expenseMutation, checkinMutation, report }),
    [checkinQuery, expenseMutation, checkinMutation, report],
  );
}

const styles = {
  section: { gap: 8, paddingVertical: 12 },
  label: { fontSize: 14, fontWeight: '600' as const },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  chipText: { fontSize: 14 },
  button: {
    minHeight: 44,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' as const },
  report: { fontSize: 13, opacity: 0.85 },
};

export function TodayQuickActions({
  localDate,
  timezone,
}: {
  localDate: string;
  timezone: string;
}) {
  const { checkinQuery, expenseMutation, checkinMutation, report } = useTodayQuickActions(localDate, timezone);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('coffee');
  const [outcomes, setOutcomes] = useState('');

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Quick expense</Text>
      <TextInput
        accessibilityLabel="Expense amount in MAD"
        keyboardType="decimal-pad"
        placeholder="22"
        value={amount}
        onChangeText={setAmount}
        style={styles.input}
      />
      <View style={styles.chipRow}>
        {QUICK_CATEGORIES.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: category === value }}
            onPress={() => setCategory(value)}
            style={[styles.chip, category === value ? { backgroundColor: '#e2e8f0' } : undefined]}
          >
            <Text style={styles.chipText}>{value.replaceAll('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        disabled={expenseMutation.isPending}
        onPress={() => {
          const minor = Math.round(Number(String(amount).replace(',', '.')) * 100);
          if (!Number.isInteger(minor) || minor <= 0) return;
          expenseMutation.mutate({ amountMinor: minor, category });
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save expense</Text>
      </Pressable>

      <Text style={styles.label}>Evening check-in</Text>
      <TextInput
        accessibilityLabel="Check-in outcomes"
        placeholder={
          checkinQuery.data?.outcomes ?? 'What closed out today?'
        }
        value={outcomes}
        onChangeText={setOutcomes}
        style={styles.input}
      />
      <Pressable
        disabled={checkinMutation.isPending || !outcomes.trim()}
        onPress={() => checkinMutation.mutate({ outcomes: outcomes.trim() })}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save check-in</Text>
      </Pressable>

      {report ? <Text style={styles.report}>{report}</Text> : null}
    </View>
  );
}
