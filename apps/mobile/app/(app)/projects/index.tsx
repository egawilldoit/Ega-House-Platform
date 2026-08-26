import { Redirect } from 'expo-router';

export default function ProjectsIndexRedirect() {
  return <Redirect href="/(app)/(tabs)/work?mode=projects" />;
}
