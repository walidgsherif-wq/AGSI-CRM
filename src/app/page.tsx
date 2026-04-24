import { redirect } from 'next/navigation';

export default function RootPage() {
  // M1: auth not yet wired (arrives in M3). Send everyone to the dashboard shell.
  // The sidebar's dev role switcher lets you preview each of the four roles.
  redirect('/dashboard');
}
