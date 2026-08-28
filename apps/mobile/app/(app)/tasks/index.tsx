import { Redirect } from 'expo-router';

export default function TasksIndexRedirect() {
  return <Redirect href="/(app)/(tabs)/work?mode=tasks" />;
}
