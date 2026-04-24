import { redirect } from 'next/navigation';

export default function AdminIndex() {
  // /admin has no dashboard of its own — default to Users.
  redirect('/admin/users');
}
